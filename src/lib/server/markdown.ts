// Markdown → sanitized HTML. This is the ONLY place article Markdown becomes
// HTML. Admins are trusted, but sanitizing server-side is cheap insurance and
// lets us safely render any pasted content. Runs on the server (Node) only —
// no parser ships to the browser.

import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// marked is configured for GitHub-ish flavored markdown, synchronous output.
marked.setOptions({ gfm: true, breaks: false });

const ALLOWED_TAGS = [
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
	'p', 'br', 'hr',
	'ul', 'ol', 'li',
	'blockquote', 'pre', 'code',
	'strong', 'em', 'del', 's',
	'a', 'img',
	'figure', 'figcaption',
	'table', 'thead', 'tbody', 'tr', 'th', 'td'
];

/** Render trusted-but-sanitized article Markdown to HTML. */
export function renderMarkdown(md: string): string {
	const rawHtml = marked.parse(md ?? '', { async: false }) as string;

	return sanitizeHtml(rawHtml, {
		allowedTags: ALLOWED_TAGS,
		allowedAttributes: {
			a: ['href', 'title', 'target', 'rel'],
			img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
			code: ['class'],
			th: ['align', 'colspan', 'rowspan'],
			td: ['align', 'colspan', 'rowspan']
		},
		allowedSchemes: ['http', 'https', 'mailto'],
		// Force external links to open safely.
		transformTags: {
			a: (tagName, attribs) => {
				const href = attribs.href ?? '';
				const external = /^https?:\/\//i.test(href);
				return {
					tagName,
					attribs: external
						? { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
						: attribs
				};
			},
			img: (tagName, attribs) => ({
				tagName,
				attribs: { ...attribs, loading: attribs.loading ?? 'lazy' }
			})
		}
	});
}
