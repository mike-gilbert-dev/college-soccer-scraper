import type { RequestHandler } from './$types';
import { supabaseAdmin } from '$lib/server/supabase-admin';

export const GET: RequestHandler = async ({ request }) => {
	const origin = new URL(request.url).origin;

	const [{ data: teamSeasons }, { data: games }, { data: articles }] = await Promise.all([
		supabaseAdmin
			.from('team_seasons')
			.select('team:teams!inner(ncaa_team_id)')
			.eq('division', 1),
		supabaseAdmin
			.from('games')
			.select('ncaa_contest_id, contest_date')
			.eq('status', 'final')
			.eq('division', 1)
			.gte('contest_date', '2024-01-01')
			.order('contest_date', { ascending: false }),
		supabaseAdmin
			.from('articles')
			.select('slug, updated_at')
			.eq('status', 'published')
			.order('published_at', { ascending: false }),
	]);

	// Deduplicate teams (same team may appear across multiple seasons)
	const seenIds = new Set<string>();
	const teams = (teamSeasons ?? [])
		.map(ts => (ts.team as unknown as { ncaa_team_id: string } | null))
		.filter((t): t is { ncaa_team_id: string } =>
			t !== null && !seenIds.has(t.ncaa_team_id) && (seenIds.add(t.ncaa_team_id), true)
		);

	const staticUrls = [
		{ path: '/', changefreq: 'hourly', priority: '1.0' },
		{ path: '/scores', changefreq: 'hourly', priority: '0.9' },
		{ path: '/teams', changefreq: 'daily', priority: '0.8' },
		{ path: '/ratings', changefreq: 'daily', priority: '0.8' },
		{ path: '/stats', changefreq: 'daily', priority: '0.8' },
		// The leaderboard is indexable; individual /u/ profile pages are not.
		{ path: '/pickem', changefreq: 'daily', priority: '0.7' },
	];

	const articleUrls = (articles ?? []).map(a => ({
		path: `/news/${a.slug}`,
		lastmod: a.updated_at ? String(a.updated_at).slice(0, 10) : undefined,
		changefreq: 'weekly',
		priority: '0.7',
	}));

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

	const allUrls = [...staticUrls, ...articleUrls, ...teamUrls, ...gameUrls];

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
