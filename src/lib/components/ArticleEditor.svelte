<script lang="ts">
	import { Button, Input, Label, Textarea, Alert, Badge } from 'flowbite-svelte';
	import { enhance } from '$app/forms';
	import type { ArticleFull } from '$lib/server/articles';

	type TeamOpt = { id: number; name: string; short_name: string };
	type PlayerOpt = { id: number; ncaa_player_id?: string; name: string; team_hint?: string | null };

	let {
		article = null,
		allTeams = [],
		form = null
	}: {
		article?: ArticleFull | null;
		allTeams?: TeamOpt[];
		form?: { error?: string } | null;
	} = $props();

	const isEdit = $derived(article !== null);

	// ── Field state ─────────────────────────────────────────────
	let title = $state(article?.title ?? '');
	let slug = $state(article?.slug ?? '');
	let subtitle = $state(article?.subtitle ?? '');
	let category = $state(article?.category ?? '');
	let body = $state(article?.body_markdown ?? '');
	let heroPath = $state(article?.hero_image_path ?? '');
	let heroUrl = $state(article?.hero_image_url ?? '');

	// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
	function toLocalInput(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}
	let publishedAtLocal = $state(toLocalInput(article?.published_at ?? null));

	// ── Slug auto-fill from title ───────────────────────────────
	function deriveSlug(name: string): string {
		return name
			.toLowerCase()
			.replace(/['’`]/g, '')
			.replace(/\s*&\s*/g, '-and-')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	}
	function onTitleBlur() {
		if (!slug.trim() && title.trim()) slug = deriveSlug(title);
	}

	// ── Related teams ───────────────────────────────────────────
	let selectedTeams = $state<TeamOpt[]>(
		(article?.teams ?? []).map((t) => ({ id: t.id, name: t.name, short_name: t.short_name }))
	);
	let teamSearch = $state('');
	const teamMatches = $derived(
		teamSearch.trim().length < 1
			? []
			: allTeams
					.filter(
						(t) =>
							!selectedTeams.some((s) => s.id === t.id) &&
							t.name.toLowerCase().includes(teamSearch.toLowerCase())
					)
					.slice(0, 8)
	);
	function addTeam(t: TeamOpt) {
		selectedTeams = [...selectedTeams, t];
		teamSearch = '';
	}
	function removeTeam(id: number) {
		selectedTeams = selectedTeams.filter((t) => t.id !== id);
	}

	// ── Related players (searched server-side) ──────────────────
	let selectedPlayers = $state<PlayerOpt[]>(
		(article?.players ?? []).map((p) => ({ id: p.id, name: p.name }))
	);
	let playerSearch = $state('');
	let playerResults = $state<PlayerOpt[]>([]);
	let playerSearching = $state(false);
	let playerTimer: ReturnType<typeof setTimeout> | undefined;

	function onPlayerSearchInput() {
		clearTimeout(playerTimer);
		const q = playerSearch.trim();
		if (q.length < 2) { playerResults = []; return; }
		playerTimer = setTimeout(async () => {
			playerSearching = true;
			try {
				const res = await fetch(`/api/admin/news/search-players?q=${encodeURIComponent(q)}`);
				const data = await res.json();
				playerResults = (data.players ?? []).filter(
					(p: PlayerOpt) => !selectedPlayers.some((s) => s.id === p.id)
				);
			} finally {
				playerSearching = false;
			}
		}, 250);
	}
	function addPlayer(p: PlayerOpt) {
		selectedPlayers = [...selectedPlayers, p];
		playerSearch = '';
		playerResults = [];
	}
	function removePlayer(id: number) {
		selectedPlayers = selectedPlayers.filter((p) => p.id !== id);
	}

	// ── Image uploads ───────────────────────────────────────────
	let heroUploading = $state(false);
	let inlineUploading = $state(false);
	let uploadError = $state('');
	let bodyEl: HTMLTextAreaElement | undefined = $state();

	async function uploadImage(file: File): Promise<{ path: string; url: string }> {
		const fd = new FormData();
		fd.append('file', file);
		const res = await fetch('/api/admin/news/upload', { method: 'POST', body: fd });
		if (!res.ok) {
			const msg = await res.text();
			throw new Error(msg || `Upload failed (${res.status})`);
		}
		return res.json();
	}

	async function onHeroChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploadError = '';
		heroUploading = true;
		try {
			const { path, url } = await uploadImage(file);
			heroPath = path;
			heroUrl = url;
		} catch (err) {
			uploadError = err instanceof Error ? err.message : String(err);
		} finally {
			heroUploading = false;
			input.value = '';
		}
	}

	async function onInlineChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploadError = '';
		inlineUploading = true;
		try {
			const { url } = await uploadImage(file);
			const alt = file.name.replace(/\.[^.]+$/, '');
			const snippet = `![${alt}](${url})`;
			// Insert at cursor.
			const el = bodyEl;
			if (el) {
				const start = el.selectionStart ?? body.length;
				const end = el.selectionEnd ?? body.length;
				body = body.slice(0, start) + snippet + body.slice(end);
			} else {
				body += `\n\n${snippet}\n`;
			}
		} catch (err) {
			uploadError = err instanceof Error ? err.message : String(err);
		} finally {
			inlineUploading = false;
			input.value = '';
		}
	}

	// ── Live preview (debounced server render) ──────────────────
	let previewHtml = $state('');
	let previewTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const md = body; // track
		clearTimeout(previewTimer);
		previewTimer = setTimeout(async () => {
			try {
				const res = await fetch('/api/admin/news/preview', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ markdown: md })
				});
				const data = await res.json();
				previewHtml = data.html ?? '';
			} catch {
				/* preview is best-effort */
			}
		}, 300);
		return () => clearTimeout(previewTimer);
	});

	// ── Publish gating ──────────────────────────────────────────
	const canPublish = $derived(!!heroUrl && !!title.trim());
	let submitting = $state(false);
</script>

<form
	method="POST"
	action="?/save"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update();
			submitting = false;
		};
	}}
	class="space-y-5"
>
	<!-- Serialized state carried into the form action -->
	<input type="hidden" name="team_ids" value={JSON.stringify(selectedTeams.map((t) => t.id))} />
	<input type="hidden" name="player_ids" value={JSON.stringify(selectedPlayers.map((p) => p.id))} />
	<input type="hidden" name="hero_path" value={heroPath} />
	<input type="hidden" name="hero_url" value={heroUrl} />

	{#if form?.error}
		<Alert color="red" class="text-xs">{form.error}</Alert>
	{/if}

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="sm:col-span-2">
			<Label class="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Title</Label>
			<Input name="title" bind:value={title} onblur={onTitleBlur} placeholder="Article headline" required />
		</div>

		<div>
			<Label class="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Slug</Label>
			<Input name="slug" bind:value={slug} placeholder="auto-from-title" />
			<p class="mt-0.5 text-[11px] text-gray-400">URL: <code>/news/{slug || 'auto-generated'}</code></p>
		</div>

		<div>
			<Label class="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Category</Label>
			<Input name="category" bind:value={category} placeholder="e.g. Recap, Rankings" />
		</div>

		<div class="sm:col-span-2">
			<Label class="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Subtitle / dek</Label>
			<Input name="subtitle" bind:value={subtitle} placeholder="Short summary shown on cards & the article header" />
		</div>

		<div>
			<Label class="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Publish date</Label>
			<Input type="datetime-local" name="published_at" bind:value={publishedAtLocal} />
			<p class="mt-0.5 text-[11px] text-gray-400">Leave blank to stamp now on publish. Backdate to reorder.</p>
		</div>
	</div>

	<!-- Hero image -->
	<div>
		<Label class="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
			Hero image <span class="text-primary-500">*required to publish</span>
		</Label>
		<div class="flex items-start gap-4">
			{#if heroUrl}
				<img src={heroUrl} alt="Hero preview" class="h-24 w-40 rounded object-cover border border-gray-200 dark:border-gray-700" />
			{:else}
				<div class="flex h-24 w-40 items-center justify-center rounded border border-dashed border-gray-300 dark:border-gray-600 text-[11px] text-gray-400">no image</div>
			{/if}
			<div class="space-y-1">
				<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onchange={onHeroChange} class="block text-xs text-gray-600 dark:text-gray-400 file:mr-2 file:rounded file:border-0 file:bg-primary-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-primary-600" />
				{#if heroUploading}<p class="text-[11px] text-blue-500">Uploading…</p>{/if}
				{#if heroUrl}<button type="button" class="text-[11px] text-red-500 hover:underline" onclick={() => { heroPath=''; heroUrl=''; }}>Remove</button>{/if}
			</div>
		</div>
	</div>

	<!-- Body + preview -->
	<div>
		<div class="mb-1 flex items-center justify-between">
			<Label class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Body (Markdown)</Label>
			<label class="cursor-pointer text-[11px] font-medium text-primary-600 hover:underline dark:text-primary-400">
				{inlineUploading ? 'Uploading…' : '+ Insert image'}
				<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" onchange={onInlineChange} />
			</label>
		</div>
		<div class="grid gap-3 lg:grid-cols-2 lg:items-start">
			<div class="min-w-0">
				<Textarea name="body_markdown" bind:value={body} bind:elementRef={bodyEl} rows={18} class="w-full min-w-0 font-mono text-sm" placeholder="Write in Markdown…" />
			</div>
			<div class="min-w-0 rounded border border-gray-200 dark:border-gray-700 p-3 overflow-auto max-h-[28rem] bg-white dark:bg-gray-900">
				<p class="mb-2 text-[10px] uppercase tracking-wider text-gray-400">Preview</p>
				<div class="article-body prose-preview text-sm">{@html previewHtml}</div>
			</div>
		</div>
	</div>

	<!-- Related teams -->
	<div>
		<Label class="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Related teams</Label>
		<div class="mb-2 flex flex-wrap gap-1.5">
			{#each selectedTeams as t (t.id)}
				<Badge color="gray" class="gap-1">
					{t.name}
					<button type="button" class="ml-1 text-red-500" onclick={() => removeTeam(t.id)} aria-label="Remove {t.name}">×</button>
				</Badge>
			{/each}
			{#if selectedTeams.length === 0}<span class="text-[11px] text-gray-400">None</span>{/if}
		</div>
		<div class="relative max-w-sm">
			<Input bind:value={teamSearch} placeholder="Search teams to tag…" size="sm" />
			{#if teamMatches.length}
				<div class="absolute z-20 mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
					{#each teamMatches as t (t.id)}
						<button type="button" class="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700" onclick={() => addTeam(t)}>{t.name}</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Related players -->
	<div>
		<Label class="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Related players</Label>
		<div class="mb-2 flex flex-wrap gap-1.5">
			{#each selectedPlayers as p (p.id)}
				<Badge color="gray" class="gap-1">
					{p.name}
					<button type="button" class="ml-1 text-red-500" onclick={() => removePlayer(p.id)} aria-label="Remove {p.name}">×</button>
				</Badge>
			{/each}
			{#if selectedPlayers.length === 0}<span class="text-[11px] text-gray-400">None</span>{/if}
		</div>
		<div class="relative max-w-sm">
			<Input bind:value={playerSearch} oninput={onPlayerSearchInput} placeholder="Search players by name…" size="sm" />
			{#if playerSearching}<p class="mt-0.5 text-[11px] text-gray-400">Searching…</p>{/if}
			{#if playerResults.length}
				<div class="absolute z-20 mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg max-h-56 overflow-auto">
					{#each playerResults as p (p.id)}
						<button type="button" class="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700" onclick={() => addPlayer(p)}>
							{p.name}{#if p.team_hint}<span class="text-gray-400"> · {p.team_hint}</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	{#if uploadError}
		<Alert color="red" class="text-xs">{uploadError}</Alert>
	{/if}

	<!-- Actions: two submit buttons carry the target status -->
	<div class="flex items-center gap-2 border-t border-gray-200 dark:border-gray-700 pt-4">
		<Button type="submit" name="status" value="draft" color="alternative" size="sm" disabled={submitting || !title.trim()}>
			Save as draft
		</Button>
		<Button type="submit" name="status" value="published" color="primary" size="sm" disabled={submitting || !canPublish} title={canPublish ? '' : 'A hero image and title are required to publish'}>
			{article?.status === 'published' ? 'Update (published)' : 'Publish'}
		</Button>
		{#if isEdit && article?.status === 'published'}
			<Button type="submit" name="status" value="draft" color="light" size="sm" disabled={submitting}>Unpublish</Button>
		{/if}
		{#if isEdit}
			<a href="/news/{article?.slug}" target="_blank" class="ml-auto text-xs text-primary-600 hover:underline dark:text-primary-400">Open public page ↗</a>
		{/if}
	</div>
</form>
