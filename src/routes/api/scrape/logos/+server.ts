import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

const NCAA_BASE   = 'https://www.ncaa.com/sites/default/files/images/logos/schools';
const BUCKET      = 'team-logos';
const REQ_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
	Accept: 'image/svg+xml,image/*,*/*'
};

async function tryFetch(url: string): Promise<ArrayBuffer | null> {
	try {
		const res = await fetch(url, {
			headers: REQ_HEADERS,
			signal: AbortSignal.timeout(10_000)
		});
		return res.ok ? await res.arrayBuffer() : null;
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json() as { ncaaTeamId?: string; slug?: string };
	const { ncaaTeamId, slug } = body;

	if (!ncaaTeamId || !slug?.trim()) error(400, 'ncaaTeamId and slug are required');

	const s = slug.trim();

	// Fetch both NCAA logo variants in parallel
	const [darkBuf, lightBuf] = await Promise.all([
		tryFetch(`${NCAA_BASE}/bgd/${s}.svg`),
		tryFetch(`${NCAA_BASE}/bgl/${s}.svg`)
	]);

	if (!darkBuf && !lightBuf) {
		return json({ success: false, message: `No logos found for slug "${s}"` });
	}

	// If only one variant exists, use it for both storage slots
	const uploadDark  = darkBuf  ?? lightBuf!;
	const uploadLight = lightBuf ?? darkBuf!;

	const darkPath  = `${ncaaTeamId}-dark.svg`;
	const lightPath = `${ncaaTeamId}-light.svg`;

	const [darkUp, lightUp] = await Promise.all([
		supabaseAdmin.storage.from(BUCKET).upload(darkPath, uploadDark, {
			contentType: 'image/svg+xml',
			upsert: true
		}),
		supabaseAdmin.storage.from(BUCKET).upload(lightPath, uploadLight, {
			contentType: 'image/svg+xml',
			upsert: true
		})
	]);

	if (darkUp.error)  error(500, `Storage upload failed (dark): ${darkUp.error.message}`);
	if (lightUp.error) error(500, `Storage upload failed (light): ${lightUp.error.message}`);

	const darkUrl  = supabaseAdmin.storage.from(BUCKET).getPublicUrl(darkPath).data.publicUrl;
	const lightUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(lightPath).data.publicUrl;

	const { error: dbErr } = await supabaseAdmin
		.from('teams')
		.update({ ncaa_logo_slug: s, logo_url_dark: darkUrl, logo_url_light: lightUrl })
		.eq('ncaa_team_id', ncaaTeamId);

	if (dbErr) error(500, `DB update failed: ${dbErr.message}`);

	return json({
		success:    true,
		darkFound:  !!darkBuf,
		lightFound: !!lightBuf,
		darkUrl,
		lightUrl
	});
};
