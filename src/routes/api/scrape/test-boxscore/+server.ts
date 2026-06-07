import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchRawBoxScore } from '$lib/server/ncaa-api';

export const GET: RequestHandler = async ({ url, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) error(401, 'Unauthorized');

	const contestId = url.searchParams.get('contestId');
	if (!contestId) error(400, 'contestId is required');

	const data = await fetchRawBoxScore(contestId);
	return json(data);
};
