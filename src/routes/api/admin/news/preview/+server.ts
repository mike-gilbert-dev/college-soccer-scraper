// Admin-gated Markdown preview. Reuses the exact renderMarkdown() the public
// detail page uses, so preview === final render. Gated via ADMIN_PATHS.

import { json } from '@sveltejs/kit';
import { renderMarkdown } from '$lib/server/markdown';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { markdown } = await request.json().catch(() => ({ markdown: '' }));
	return json({ html: renderMarkdown(typeof markdown === 'string' ? markdown : '') });
};
