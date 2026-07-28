// Server-side data layer for the news/articles feature.
//
// Reads for the PUBLIC site take a caller-supplied client (event.locals.supabase,
// publishable key + RLS → only published rows return). Admin reads/writes use
// supabaseAdmin (service_role, RLS-bypassing) and must only be reached through
// the /admin + /api/admin hooks gate.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '$lib/server/supabase-admin';

// ── Types ───────────────────────────────────────────────────
export type ArticleStatus = 'draft' | 'published';
/** Gender/sport an article belongs to. null = "general" (not gender-specific). */
export type ArticleSport = 'MSO' | 'WSO';

export interface RelatedTeam {
	id: number;
	ncaa_team_id: string;
	name: string;
	short_name: string;
	logo_url_dark: string | null;
	logo_url_light: string | null;
}
export interface RelatedPlayer {
	id: number;
	ncaa_player_id: string;
	name: string;
}

/** Card-shaped row for lists (no body_markdown — avoid over-fetch). */
export interface ArticleCard {
	id: number;
	slug: string;
	title: string;
	subtitle: string | null;
	category: string | null;
	sport_code: ArticleSport | null;
	hero_image_url: string | null;
	published_at: string | null;
}

/** Full article incl. body + related entities. */
export interface ArticleFull extends ArticleCard {
	body_markdown: string;
	hero_image_path: string | null;
	status: ArticleStatus;
	created_at: string;
	updated_at: string;
	teams: RelatedTeam[];
	players: RelatedPlayer[];
}

/** Admin list row (needs status + timestamps). */
export interface ArticleAdminRow extends ArticleCard {
	status: ArticleStatus;
	updated_at: string;
}

export interface ArticleInput {
	slug: string;
	title: string;
	subtitle: string | null;
	category: string | null;
	body_markdown: string;
	hero_image_path: string | null;
	hero_image_url: string | null;
	status: ArticleStatus;
	sport_code: ArticleSport | null;
	published_at: string | null;
	team_ids: number[];
	player_ids: number[];
}

const CARD_COLS = 'id, slug, title, subtitle, category, sport_code, hero_image_url, published_at';
const RELATED_SELECT =
	'article_teams(team:teams(id, ncaa_team_id, name, short_name, logo_url_dark, logo_url_light)),' +
	'article_players(player:players(id, ncaa_player_id, name))';

// ── Slug helpers ────────────────────────────────────────────
/** Slugify a title. Mirrors deriveSlug() in src/routes/admin/+page.svelte. */
export function deriveSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/['’`]/g, '')
		.replace(/\s*&\s*/g, '-and-')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Return a slug unique against articles.slug, appending -2, -3, … if needed.
 *  `excludeId` skips the article being edited so it doesn't collide with itself. */
export async function uniqueSlug(base: string, excludeId?: number): Promise<string> {
	const root = deriveSlug(base) || 'article';
	let candidate = root;
	let n = 1;
	// Loop until no other row owns the candidate.
	// eslint-disable-next-line no-constant-condition
	while (true) {
		let q = supabaseAdmin.from('articles').select('id').eq('slug', candidate).limit(1);
		if (excludeId != null) q = q.neq('id', excludeId);
		const { data, error } = await q;
		if (error) throw new Error(`uniqueSlug lookup failed: ${error.message}`);
		if (!data || data.length === 0) return candidate;
		n += 1;
		candidate = `${root}-${n}`;
	}
}

// ── Public reads (RLS-gated) ────────────────────────────────
/** Published articles, newest first, paginated. Fetches limit+1 to detect more. */
export async function listPublishedArticles(
	client: SupabaseClient,
	{ offset, limit, sport }: { offset: number; limit: number; sport?: ArticleSport }
): Promise<{ rows: ArticleCard[]; hasMore: boolean }> {
	let query = client
		.from('articles')
		.select(CARD_COLS)
		.eq('status', 'published');
	// Gender tabs are strict: MSO/WSO only. "General" (null) articles show
	// only when no sport is requested (the "All" view).
	if (sport) query = query.eq('sport_code', sport);
	const { data, error } = await query
		.order('published_at', { ascending: false })
		.range(offset, offset + limit); // inclusive → fetches limit+1
	if (error) throw new Error(`listPublishedArticles failed: ${error.message}`);
	const rows = (data ?? []) as ArticleCard[];
	const hasMore = rows.length > limit;
	return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/** Published articles tagged to a given team, newest first, paginated.
 *  A team page is gender-specific, so this includes the page's sport plus
 *  "general" (null) articles and hides the opposite gender. Fetches limit+1
 *  to detect more (same convention as listPublishedArticles). */
export async function listPublishedArticlesForTeam(
	client: SupabaseClient,
	{ teamId, offset, limit, sport }: { teamId: number; offset: number; limit: number; sport?: ArticleSport }
): Promise<{ rows: ArticleCard[]; hasMore: boolean }> {
	// !inner restricts to articles that have a matching article_teams row; the
	// embedded eq filters that join to this team.
	let query = client
		.from('articles')
		.select(`${CARD_COLS}, article_teams!inner(team_id)`)
		.eq('status', 'published')
		.eq('article_teams.team_id', teamId);
	if (sport) query = query.or(`sport_code.eq.${sport},sport_code.is.null`);
	const { data, error } = await query
		.order('published_at', { ascending: false })
		.range(offset, offset + limit); // inclusive → fetches limit+1
	if (error) throw new Error(`listPublishedArticlesForTeam failed: ${error.message}`);
	// Strip the join helper column; keep only card fields.
	const rows = ((data ?? []) as (ArticleCard & { article_teams?: unknown })[]).map((r) => {
		const { article_teams: _omit, ...card } = r;
		return card as ArticleCard;
	});
	const hasMore = rows.length > limit;
	return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

type RelatedJoin = {
	article_teams?: { team: RelatedTeam | null }[] | null;
	article_players?: { player: RelatedPlayer | null }[] | null;
};

function flattenRelated(row: RelatedJoin): { teams: RelatedTeam[]; players: RelatedPlayer[] } {
	const teams = (row.article_teams ?? [])
		.map((t) => t.team)
		.filter((t): t is RelatedTeam => t !== null);
	const players = (row.article_players ?? [])
		.map((p) => p.player)
		.filter((p): p is RelatedPlayer => p !== null);
	return { teams, players };
}

/** A single published article by slug, incl. related entities. Null if not found. */
export async function getPublishedArticleBySlug(
	client: SupabaseClient,
	slug: string
): Promise<ArticleFull | null> {
	const { data, error } = await client
		.from('articles')
		.select(`*, ${RELATED_SELECT}`)
		.eq('slug', slug)
		.eq('status', 'published')
		.maybeSingle();
	if (error) throw new Error(`getPublishedArticleBySlug failed: ${error.message}`);
	if (!data) return null;
	const { teams, players } = flattenRelated(data as RelatedJoin);
	return { ...(data as unknown as ArticleFull), teams, players };
}

// ── Admin reads (RLS-bypassing) ─────────────────────────────
/** Any-status article by slug OR numeric id, incl. related entities. */
export async function getArticleForAdmin(slugOrId: string | number): Promise<ArticleFull | null> {
	const col = typeof slugOrId === 'number' || /^\d+$/.test(String(slugOrId)) ? 'id' : 'slug';
	const { data, error } = await supabaseAdmin
		.from('articles')
		.select(`*, ${RELATED_SELECT}`)
		.eq(col, slugOrId)
		.maybeSingle();
	if (error) throw new Error(`getArticleForAdmin failed: ${error.message}`);
	if (!data) return null;
	const { teams, players } = flattenRelated(data as RelatedJoin);
	return { ...(data as unknown as ArticleFull), teams, players };
}

/** All articles (any status), newest-updated first, for the admin index. */
export async function listArticlesForAdmin(opts?: { status?: ArticleStatus }): Promise<ArticleAdminRow[]> {
	let q = supabaseAdmin
		.from('articles')
		.select(`${CARD_COLS}, status, updated_at`)
		.order('updated_at', { ascending: false });
	if (opts?.status) q = q.eq('status', opts.status);
	const { data, error } = await q;
	if (error) throw new Error(`listArticlesForAdmin failed: ${error.message}`);
	return (data ?? []) as ArticleAdminRow[];
}

// ── Admin writes (RLS-bypassing) ────────────────────────────
async function reconcileRelated(articleId: number, teamIds: number[], playerIds: number[]) {
	// Delete-then-insert. Edits are admin-only and infrequent.
	const delT = await supabaseAdmin.from('article_teams').delete().eq('article_id', articleId);
	if (delT.error) throw new Error(`reconcile teams (delete) failed: ${delT.error.message}`);
	const delP = await supabaseAdmin.from('article_players').delete().eq('article_id', articleId);
	if (delP.error) throw new Error(`reconcile players (delete) failed: ${delP.error.message}`);

	if (teamIds.length) {
		const rows = [...new Set(teamIds)].map((team_id) => ({ article_id: articleId, team_id }));
		const { error } = await supabaseAdmin.from('article_teams').insert(rows);
		if (error) throw new Error(`reconcile teams (insert) failed: ${error.message}`);
	}
	if (playerIds.length) {
		const rows = [...new Set(playerIds)].map((player_id) => ({ article_id: articleId, player_id }));
		const { error } = await supabaseAdmin.from('article_players').insert(rows);
		if (error) throw new Error(`reconcile players (insert) failed: ${error.message}`);
	}
}

function coreFields(input: ArticleInput) {
	return {
		slug: input.slug,
		title: input.title,
		subtitle: input.subtitle,
		category: input.category,
		body_markdown: input.body_markdown,
		hero_image_path: input.hero_image_path,
		hero_image_url: input.hero_image_url,
		status: input.status,
		sport_code: input.sport_code,
		published_at: input.published_at
	};
}

/** Insert a new article + related tags. Returns the created id + slug. */
export async function createArticle(input: ArticleInput): Promise<{ id: number; slug: string }> {
	const fields = coreFields(input);
	// First publish with no explicit date → stamp now.
	if (fields.status === 'published' && !fields.published_at) {
		fields.published_at = new Date().toISOString();
	}
	const { data, error } = await supabaseAdmin
		.from('articles')
		.insert(fields)
		.select('id, slug')
		.single();
	if (error) throw new Error(`createArticle failed: ${error.message}`);
	await reconcileRelated(data.id, input.team_ids, input.player_ids);
	return data as { id: number; slug: string };
}

/** Update an existing article + related tags. */
export async function updateArticle(id: number, input: ArticleInput): Promise<{ id: number; slug: string }> {
	const fields = coreFields(input);

	// Read prior state once: published_at (for stamping) + hero path (for cleanup).
	const { data: existing } = await supabaseAdmin
		.from('articles')
		.select('published_at, hero_image_path')
		.eq('id', id)
		.single();

	// Stamp published_at on the first transition to published if none supplied.
	if (fields.status === 'published' && !fields.published_at) {
		fields.published_at = existing?.published_at ?? new Date().toISOString();
	}

	const { data, error } = await supabaseAdmin
		.from('articles')
		.update(fields)
		.eq('id', id)
		.select('id, slug')
		.single();
	if (error) throw new Error(`updateArticle failed: ${error.message}`);
	await reconcileRelated(id, input.team_ids, input.player_ids);

	// Best-effort: if the hero image was replaced/removed, delete the old object
	// so it doesn't orphan in Storage. Failures are non-fatal.
	const oldPath = existing?.hero_image_path;
	if (oldPath && oldPath !== fields.hero_image_path) {
		await supabaseAdmin.storage.from('article-images').remove([oldPath]).catch(() => {});
	}

	return data as { id: number; slug: string };
}

/** Delete an article (cascade removes join rows). */
export async function deleteArticle(id: number): Promise<void> {
	const { error } = await supabaseAdmin.from('articles').delete().eq('id', id);
	if (error) throw new Error(`deleteArticle failed: ${error.message}`);
}
