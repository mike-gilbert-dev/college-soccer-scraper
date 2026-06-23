import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase-admin';

// Admin-only (enforced in hooks.server.ts for all /admin paths). Lists pending
// roster_entry_queue items for human review and resolves them via the Phase 5 RPCs.

export type QueueEntry = {
	id: number;
	first_name: string | null;
	last_name: string | null;
	jersey_number: number | null;
	position: string | null;
	class_year: string | null;
	height: string | null;
	hometown: string | null;
	headshot_url: string | null;
	match_status: string;
	suggestion_reason: string | null;
	suggested_player_season_id: number | null;
	team_season_id: number;
	team_name: string;
};
export type Candidate = { id: number; team_season_id: number; name: string; jersey_number: number | null };

export const load: PageServerLoad = async () => {
	const { data: rawQueue } = await supabaseAdmin
		.from('roster_entry_queue')
		.select(
			'id, first_name, last_name, jersey_number, position, class_year, height, hometown, headshot_url, match_status, suggestion_reason, suggested_player_season_id, team_season_id, roster_sources!inner(teams!inner(name))'
		)
		.eq('review_status', 'pending')
		.order('team_season_id', { ascending: true })
		.order('last_name', { ascending: true });

	// deno not involved here; flatten the nested join for the UI.
	const queue: QueueEntry[] = (rawQueue ?? []).map((r) => {
		const rs = Array.isArray(r.roster_sources) ? r.roster_sources[0] : r.roster_sources;
		const team = rs && (Array.isArray(rs.teams) ? rs.teams[0] : rs.teams);
		return {
			id: r.id,
			first_name: r.first_name,
			last_name: r.last_name,
			jersey_number: r.jersey_number,
			position: r.position,
			class_year: r.class_year,
			height: r.height,
			hometown: r.hometown,
			headshot_url: r.headshot_url,
			match_status: r.match_status,
			suggestion_reason: r.suggestion_reason,
			suggested_player_season_id: r.suggested_player_season_id,
			team_season_id: r.team_season_id,
			team_name: team?.name ?? `team_season ${r.team_season_id}`
		};
	});

	// Candidate player_seasons for linking, for the team-seasons present in the queue.
	const teamSeasonIds = [...new Set(queue.map((q) => q.team_season_id))];
	let candidates: Candidate[] = [];
	if (teamSeasonIds.length) {
		const { data: rawCand } = await supabaseAdmin
			.from('player_seasons')
			.select('id, team_season_id, jersey_number, players!inner(name)')
			.in('team_season_id', teamSeasonIds);
		candidates = (rawCand ?? []).map((r) => {
			const pl = Array.isArray(r.players) ? r.players[0] : r.players;
			return { id: r.id, team_season_id: r.team_season_id, name: pl?.name ?? '(unknown)', jersey_number: r.jersey_number };
		});
		candidates.sort((a, b) => a.name.localeCompare(b.name));
	}

	const { data: logRows } = await supabaseAdmin
		.from('roster_scrape_log')
		.select('id, status, entries_seen, matched, enriched, queued, error_message, created_at, roster_sources(teams(name))')
		.order('created_at', { ascending: false })
		.limit(50);
	const log = (logRows ?? []).map((r) => {
		const rs = Array.isArray(r.roster_sources) ? r.roster_sources[0] : r.roster_sources;
		const team = rs && (Array.isArray(rs.teams) ? rs.teams[0] : rs.teams);
		return { ...r, team_name: team?.name ?? '—' };
	});

	const [{ count: enrichedCount }, { count: headshotCount }] = await Promise.all([
		supabaseAdmin.from('player_seasons').select('*', { count: 'exact', head: true }).not('roster_source_id', 'is', null),
		supabaseAdmin.from('player_seasons').select('*', { count: 'exact', head: true }).not('headshot_path', 'is', null)
	]);

	return {
		queue,
		candidates,
		log,
		coverage: { pending: queue.length, enriched: enrichedCount ?? 0, withHeadshot: headshotCount ?? 0 }
	};
};

export const actions: Actions = {
	reject: async ({ request }) => {
		const fd = await request.formData();
		const id = Number(fd.get('queue_id'));
		if (!id) return fail(400, { error: 'missing queue_id' });
		const { error } = await supabaseAdmin.rpc('roster_queue_reject', { p_queue_id: id });
		if (error) return fail(400, { error: error.message });
		return { success: `Rejected entry ${id}` };
	},
	approve_link: async ({ request }) => {
		const fd = await request.formData();
		const id = Number(fd.get('queue_id'));
		const psId = Number(fd.get('player_season_id'));
		if (!id || !psId) return fail(400, { error: 'pick a player to link to' });
		const { error } = await supabaseAdmin.rpc('roster_queue_approve_link', { p_queue_id: id, p_player_season_id: psId });
		if (error) return fail(400, { error: error.message });
		return { success: `Linked entry ${id} to player_season ${psId}` };
	},
	approve_create: async ({ request }) => {
		const fd = await request.formData();
		const id = Number(fd.get('queue_id'));
		if (!id) return fail(400, { error: 'missing queue_id' });
		const { error } = await supabaseAdmin.rpc('roster_queue_approve_create', { p_queue_id: id });
		if (error) return fail(400, { error: error.message });
		return { success: `Created player from entry ${id}` };
	}
};
