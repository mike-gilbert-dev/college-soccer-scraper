import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

async function requireAdmin(locals: App.Locals) {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');
	if (!locals.isAdmin) error(403, 'Forbidden');
}

export const POST: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);

	const { label, start_date, end_date } = await request.json() as {
		label: string;
		start_date: string;
		end_date: string;
	};

	if (!label?.trim())      error(400, 'label is required');
	if (!start_date?.trim()) error(400, 'start_date is required');
	if (!end_date?.trim())   error(400, 'end_date is required');
	if (end_date <= start_date) error(400, 'end_date must be after start_date');

	// `year` (NOT NULL) is the season's starting calendar year, e.g. label
	// "2025-2026" → 2025. Derive it from start_date.
	const year = parseInt(start_date.slice(0, 4), 10);

	const { data, error: dbErr } = await supabaseAdmin
		.from('seasons')
		.insert({ year, label: label.trim(), start_date, end_date })
		.select('id, year, label, start_date, end_date')
		.single();

	if (dbErr) error(400, dbErr.message);

	return json(data);
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);

	const { id, label, start_date, end_date } = await request.json() as {
		id: number;
		label: string;
		start_date: string;
		end_date: string;
	};

	if (!id)                 error(400, 'id is required');
	if (!label?.trim())      error(400, 'label is required');
	if (!start_date?.trim()) error(400, 'start_date is required');
	if (!end_date?.trim())   error(400, 'end_date is required');
	if (end_date <= start_date) error(400, 'end_date must be after start_date');

	const year = parseInt(start_date.slice(0, 4), 10);

	const { data, error: dbErr } = await supabaseAdmin
		.from('seasons')
		.update({ year, label: label.trim(), start_date, end_date })
		.eq('id', id)
		.select('id, year, label, start_date, end_date')
		.single();

	if (dbErr) error(400, dbErr.message);

	return json(data);
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);

	const { id } = await request.json() as { id: number };
	if (!id) error(400, 'id is required');

	// Prevent deletion if games exist for this season
	const { count } = await supabaseAdmin
		.from('games')
		.select('*', { count: 'exact', head: true })
		.eq('season_id', id);

	if ((count ?? 0) > 0) {
		error(400, `Cannot delete — ${count} game(s) reference this season.`);
	}

	const { error: dbErr } = await supabaseAdmin
		.from('seasons')
		.delete()
		.eq('id', id);

	if (dbErr) error(400, dbErr.message);

	return json({ success: true });
};
