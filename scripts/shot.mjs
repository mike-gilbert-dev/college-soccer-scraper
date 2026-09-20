// Screenshot a page from the running dev server, for visual checks.
//   node scripts/shot.mjs /bracket                       (light + dark, desktop)
//   node scripts/shot.mjs "/bracket?gender=W" --out=wso
//   node scripts/shot.mjs /bracket --width=390           (phone)
//   node scripts/shot.mjs /bracket --port=5179 --full
//
// Writes PNGs to .shots/ (gitignored). Assumes `npm run dev` is already running.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const arg = (n, d) => {
	const v = process.argv.find((a) => a.startsWith(`--${n}=`));
	return v ? v.split('=')[1] : d;
};
const path = process.argv[2] ?? '/';
const port = arg('port', '5179');
const width = parseInt(arg('width', '1280'), 10);
const height = parseInt(arg('height', '900'), 10);
const out = arg('out', 'shot');
const full = process.argv.includes('--full');
const themes = arg('theme') ? [arg('theme')] : ['light', 'dark'];

mkdirSync('.shots', { recursive: true });

const browser = await chromium.launch();
for (const theme of themes) {
	const ctx = await browser.newContext({
		viewport: { width, height },
		colorScheme: theme,
		deviceScaleFactor: 2
	});
	// The app picks its theme from localStorage and toggles a `dark` class in an
	// inline script (see app.html) — prefers-color-scheme alone does not drive it,
	// so seed the key before any document loads.
	await ctx.addInitScript((t) => {
		try {
			localStorage.setItem('theme', t);
		} catch {
			/* private mode */
		}
	}, theme);
	const pg = await ctx.newPage();
	const url = `http://localhost:${port}${path}`;
	const res = await pg.goto(url, { waitUntil: 'networkidle' });
	// Surface a bad page instead of silently shooting an error screen.
	if (!res || res.status() >= 400) {
		console.error(`  ${url} -> HTTP ${res?.status()}`);
		await ctx.close();
		continue;
	}
	const file = `.shots/${out}-${theme}.png`;
	await pg.screenshot({ path: file, fullPage: full });

	// Report horizontal overflow — the thing a screenshot hides. Checking only the
	// document misses the common case: an `overflow-x-auto` container showing its
	// own scrollbar while the page itself fits perfectly (the bracket board did
	// exactly this, 2px over because the container's border wasn't budgeted).
	const overflow = await pg.evaluate(() => {
		const d = document.documentElement;
		const inner = [...document.querySelectorAll('*')]
			.filter((e) => e.scrollWidth > e.clientWidth + 0.5)
			.map((e) => ({
				sel: e.tagName.toLowerCase() + (e.className ? `.${String(e.className).split(/\s+/)[0]}` : ''),
				by: Math.round(e.scrollWidth - e.clientWidth)
			}));
		return { scrollW: d.scrollWidth, clientW: d.clientWidth, scrollH: d.scrollHeight, inner };
	});
	const pageWarn =
		overflow.scrollW > overflow.clientW ? `  ⚠ page overflows by ${overflow.scrollW - overflow.clientW}px` : '';
	console.log(`  ${file}  ${theme}  ${width}x${height}  page ${overflow.scrollW}x${overflow.scrollH}${pageWarn}`);
	for (const o of overflow.inner) console.log(`      ⚠ scrollbar: ${o.sel} overflows by ${o.by}px`);
	await ctx.close();
}
await browser.close();
