// Shared form-action logic for the article editor (new + edit pages).
// Parses the editor's form fields, validates, resolves a unique slug, and
// upserts via the Phase 2 data layer. Returns the saved article's id + slug.

import { fail } from '@sveltejs/kit';
import {
	createArticle,
	updateArticle,
	uniqueSlug,
	type ArticleInput,
	type ArticleStatus
} from '$lib/server/articles';

function parseIds(raw: FormDataEntryValue | null): number[] {
	if (typeof raw !== 'string' || !raw) return [];
	try {
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isFinite(n)) : [];
	} catch {
		return [];
	}
}

export type SaveResult =
	| { ok: true; id: number; slug: string }
	| { ok: false; status: number; error: string };

export async function saveArticleFromForm(
	request: Request,
	editingId: number | null
): Promise<SaveResult> {
	const fd = await request.formData();

	const title = (fd.get('title') ?? '').toString().trim();
	if (!title) return { ok: false, status: 400, error: 'Title is required.' };
	if (title.length > 200) return { ok: false, status: 400, error: 'Title must be 200 characters or fewer.' };

	const subtitle = (fd.get('subtitle') ?? '').toString().trim();
	if (subtitle.length > 500) return { ok: false, status: 400, error: 'Subtitle must be 500 characters or fewer.' };

	const category = (fd.get('category') ?? '').toString().trim();
	if (category.length > 60) return { ok: false, status: 400, error: 'Category must be 60 characters or fewer.' };

	const status: ArticleStatus = fd.get('status') === 'published' ? 'published' : 'draft';
	const heroPath = (fd.get('hero_path') ?? '').toString().trim() || null;
	const heroUrl = (fd.get('hero_url') ?? '').toString().trim() || null;

	if (status === 'published' && !heroUrl) {
		return { ok: false, status: 400, error: 'A hero image is required to publish.' };
	}

	// datetime-local (local time, no tz) → ISO; blank → null (stamped on publish).
	const publishedRaw = (fd.get('published_at') ?? '').toString().trim();
	let publishedAt: string | null = null;
	if (publishedRaw) {
		const d = new Date(publishedRaw);
		if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
	}

	const slugInput = (fd.get('slug') ?? '').toString().trim();
	const slug = await uniqueSlug(slugInput || title, editingId ?? undefined);

	const input: ArticleInput = {
		slug,
		title,
		subtitle: subtitle || null,
		category: category || null,
		body_markdown: (fd.get('body_markdown') ?? '').toString(),
		hero_image_path: heroPath,
		hero_image_url: heroUrl,
		status,
		published_at: publishedAt,
		team_ids: parseIds(fd.get('team_ids')),
		player_ids: parseIds(fd.get('player_ids'))
	};

	try {
		const saved = editingId != null ? await updateArticle(editingId, input) : await createArticle(input);
		return { ok: true, id: saved.id, slug: saved.slug };
	} catch (e) {
		return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
	}
}

/** Convenience wrapper returning a SvelteKit `fail` on error, else the result. */
export function toFail(result: Extract<SaveResult, { ok: false }>) {
	return fail(result.status, { error: result.error });
}
