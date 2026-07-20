// Admin-gated image upload for articles (hero + inline body images).
// Gated by hooks.server.ts (ADMIN_PATHS includes '/api/admin'). Stores to the
// public 'article-images' bucket and returns { path, url }.

import { json, error } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

const BUCKET = 'article-images';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

const EXT_BY_TYPE: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const file = form.get('file');

	if (!(file instanceof File)) {
		throw error(400, 'No file provided (expected multipart field "file").');
	}

	const contentType = (file.type || '').toLowerCase();
	const ext = EXT_BY_TYPE[contentType];
	if (!ext) {
		throw error(415, `Unsupported image type "${file.type}". Use JPG, PNG, WebP, or GIF.`);
	}
	if (file.size > MAX_BYTES) {
		throw error(413, `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 8 MB.`);
	}

	const now = new Date();
	const yyyy = now.getUTCFullYear();
	const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
	const key = `${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;

	const buffer = new Uint8Array(await file.arrayBuffer());
	const { error: uploadError } = await supabaseAdmin.storage
		.from(BUCKET)
		.upload(key, buffer, { contentType, cacheControl: '31536000', upsert: false });
	if (uploadError) {
		throw error(500, `Upload failed: ${uploadError.message}`);
	}

	const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(key);
	return json({ path: key, url: data.publicUrl });
};
