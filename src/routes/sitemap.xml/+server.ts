import type { RequestHandler } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const GET: RequestHandler = async ({ request }) => {
	const origin = new URL(request.url).origin;

	const [{ data: teams }, { data: games }] = await Promise.all([
		supabaseAdmin.from('teams').select('ncaa_team_id').order('name'),
		supabaseAdmin
			.from('games')
			.select('ncaa_contest_id, contest_date')
			.eq('status', 'final')
			.gte('contest_date', '2024-01-01')
			.order('contest_date', { ascending: false }),
	]);

	const staticUrls = [
		{ path: '/', changefreq: 'hourly', priority: '1.0' },
		{ path: '/teams', changefreq: 'daily', priority: '0.8' },
		{ path: '/stats', changefreq: 'daily', priority: '0.8' },
	];

	const teamUrls = (teams ?? []).map(t => ({
		path: `/teams/${t.ncaa_team_id}`,
		changefreq: 'daily',
		priority: '0.7',
	}));

	const gameUrls = (games ?? []).map(g => ({
		path: `/games/${g.ncaa_contest_id}`,
		lastmod: g.contest_date,
		changefreq: 'monthly',
		priority: '0.5',
	}));

	const allUrls = [...staticUrls, ...teamUrls, ...gameUrls];

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
	.map(u => {
		const lastmod = 'lastmod' in u && u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : '';
		return `  <url>
    <loc>${origin}${u.path}</loc>${lastmod}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`;
	})
	.join('\n')}
</urlset>`;

	return new Response(xml, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': 'max-age=3600, s-maxage=3600',
		},
	});
};
