import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
// `vitest/config` re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		// Node environment only — the suite covers pure logic modules
		// (username rules, pick grading), not Svelte components.
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
