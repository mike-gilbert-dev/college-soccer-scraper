import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';

// Admin-only (hooks-gated). Manage roster_sources: view discovery status, manually
// correct the tail (domain / roster id / status), and re-run discovery per row.

export const load: PageServerLoad = async () => {
	const { data: rows } = await supabaseAdmin
		.from('roster_sources')
		.select('id, domain, platform, sidearm_roster_id, status, last_verified_at, notes, season_id, teams!inner(name, ncaa_team_id)')
		.order('status', { ascending: true })
		.order('domain', { ascending: true });

	const { data: cov } = await supabaseAdmin
		.from('roster_coverage')
		.select('roster_source_id, player_seasons, roster_linked, with_class, with_hometown, with_headshot, pending_review');
	const covById = new Map((cov ?? []).map((c) => [c.roster_source_id, c]));

	const sources = (rows ?? []).map((r) => {
		const t = Array.isArray(r.teams) ? r.teams[0] : r.teams;
		const c = covById.get(r.id);
		return {
			id: r.id,
			team_name: t?.name ?? '—',
			ncaa_team_id: t?.ncaa_team_id ?? '',
			domain: r.domain,
			platform: r.platform,
			sidearm_roster_id: r.sidearm_roster_id,
			status: r.status,
			last_verified_at: r.last_verified_at,
			notes: r.notes,
			roster_linked: c?.roster_linked ?? 0,
			with_headshot: c?.with_headshot ?? 0,
			with_class: c?.with_class ?? 0,
			pending_review: c?.pending_review ?? 0
		};
	});

	// Overall fill rates across all sources.
	const overall = (cov ?? []).reduce(
		(a, c) => ({
			roster_linked: a.roster_linked + (c.roster_linked ?? 0),
			with_headshot: a.with_headshot + (c.with_headshot ?? 0),
			with_class: a.with_class + (c.with_class ?? 0),
			pending_review: a.pending_review + (c.pending_review ?? 0)
		}),
		{ roster_linked: 0, with_headshot: 0, with_class: 0, pending_review: 0 }
	);

	const counts = sources.reduce<Record<string, number>>((acc, s) => {
		acc[s.status] = (acc[s.status] ?? 0) + 1;
		return acc;
	}, {});

	return { sources, counts, overall };
};

export const actions: Actions = {
	save: async ({ request }) => {
		const fd = await request.formData();
		const id = Number(fd.get('source_id'));
		if (!id) return fail(400, { error: 'missing source_id' });
		const domain = String(fd.get('domain') ?? '').trim() || null;
		const sidearm_roster_id = String(fd.get('sidearm_roster_id') ?? '').trim() || null;
		const status = String(fd.get('status') ?? '').trim();
		const { error } = await supabaseAdmin
			.from('roster_sources')
			.update({ domain, sidearm_roster_id, status })
			.eq('id', id);
		if (error) return fail(400, { error: error.message });
		return { success: `Saved source ${id}` };
	},
	reverify: async ({ request }) => {
		const fd = await request.formData();
		const id = Number(fd.get('source_id'));
		if (!id) return fail(400, { error: 'missing source_id' });
		const res = await fetch(`${PUBLIC_SUPABASE_URL}/functions/v1/roster-discovery?source=${id}`, {
			headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
		});
		if (!res.ok) return fail(400, { error: `discovery returned HTTP ${res.status}` });
		const body = await res.json();
		const r = body?.results?.[0];
		return { success: `Re-verified source ${id}: ${r?.status ?? 'done'}${r?.note ? ` (${r.note})` : ''}` };
	}
};
