import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const OUTCOMES = ['home', 'draw', 'away'] as const;
type Outcome = (typeof OUTCOMES)[number];

/**
 * Postgres 42501 is "insufficient privilege" — here it means the RLS WITH CHECK
 * failed, i.e. the game is no longer open. Surface that as a readable 403
 * rather than leaking the database error.
 */
function isLockViolation(code?: string) {
	return code === '42501';
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Sign in to make picks.');

	const body = await request.json().catch(() => null);
	const gameId = Number(body?.gameId);
	const outcome = body?.outcome as Outcome;

	if (!Number.isInteger(gameId) || gameId <= 0) {
		error(400, 'A valid gameId is required.');
	}
	if (!OUTCOMES.includes(outcome)) {
		error(400, `outcome must be one of ${OUTCOMES.join(', ')}.`);
	}

	// locals.supabase runs under the user's JWT, so the kickoff lock and the
	// ownership check in RLS both apply. Never use supabaseAdmin here — it would
	// silently bypass the lock and defeat the whole feature.
	//
	// season_id / sport_code / division are omitted on purpose: the
	// picks_fill_game_context trigger derives them from the game.
	const { data, error: dbError } = await locals.supabase
		.from('picks')
		.upsert(
			{ user_id: user.id, game_id: gameId, outcome },
			{ onConflict: 'user_id,game_id' }
		)
		.select('game_id, outcome, result')
		.single();

	if (dbError) {
		if (isLockViolation(dbError.code)) {
			error(403, 'This game has already started — picks are locked.');
		}
		console.error('[api/picks] upsert failed:', dbError);
		error(500, 'Could not save your pick.');
	}

	return json(data);
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Sign in to make picks.');

	const body = await request.json().catch(() => null);
	const gameId = Number(body?.gameId);

	if (!Number.isInteger(gameId) || gameId <= 0) {
		error(400, 'A valid gameId is required.');
	}

	// RLS scopes this to the caller's own row and blocks it once the game is
	// locked. A locked game matches zero rows rather than erroring, so compare
	// counts to tell "nothing to delete" from "not allowed to delete".
	const { data, error: dbError } = await locals.supabase
		.from('picks')
		.delete()
		.eq('user_id', user.id)
		.eq('game_id', gameId)
		.select('game_id');

	if (dbError) {
		if (isLockViolation(dbError.code)) {
			error(403, 'This game has already started — picks are locked.');
		}
		console.error('[api/picks] delete failed:', dbError);
		error(500, 'Could not clear your pick.');
	}

	if (!data || data.length === 0) {
		// Either there was no pick, or the game locked before this landed. Ask the
		// client to reconcile rather than pretending the delete succeeded.
		const { data: stillThere } = await locals.supabase
			.from('picks')
			.select('game_id')
			.eq('user_id', user.id)
			.eq('game_id', gameId)
			.maybeSingle();

		if (stillThere) {
			error(403, 'This game has already started — picks are locked.');
		}
	}

	return json({ gameId, cleared: true });
};
