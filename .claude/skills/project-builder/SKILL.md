---
name: project-builder
description: Executes a project plan produced by the project-planner skill. Scans docs/planning/ for available plans, lets the user choose one, then builds and verifies each phase in order — checking off completion criteria in real time and never re-executing finished work. Invoke when the user wants to begin or resume executing a plan.
arguments: [project_name]
allowed-tools: Read Glob Grep Write Edit Bash WebFetch
---

# Project Builder

Execute a project plan one phase at a time, marking progress in the HTML files as you go. Work through the steps below in order.

---

## Step 1 — Discover available plans

Glob `docs/planning/*/phase-*.html` and group results by the directory name (the segment between `docs/planning/` and the filename — that is the project name).

If `$project_name` was supplied as an argument, skip straight to Step 2 using that name.

Otherwise present the user with a numbered list:

```
Available plans:
  1. my-feature     (3 phases)
  2. another-thing  (5 phases)

Which plan would you like to build?
```

Wait for the user to choose before continuing.

---

## Step 2 — Assess completion state

Read every phase file for the selected plan in order. For each file, count:
- **Total criteria**: `<li>` elements that are direct children of `<ul class="checklist">`
- **Done criteria**: `<li class="done">` elements within the same list

**If every criterion across every phase is `done`:**
> "This plan is already complete — all [N] phases are finished. No work will be re-executed."

Exit. Do not proceed.

**If some phases are complete:**
> "Phases 1–N are already complete. Resuming from Phase N+1: [Title]."

**If no phases have been started:**
> "Starting from Phase 1."

---

## Step 3 — Load context before writing any code

Read the following before implementation begins:

1. `CLAUDE.md` — conventions, architecture, build commands
2. All files under `docs/planning/$project_name/references/` (glob for them)
3. Every file named in "Key files to read before starting" sections across all phase documents

Do not write a single line of code before this context is loaded.

---

## Step 4 — Execute phases in order

Process phase files in ascending numeric order (`phase-01-*`, `phase-02-*`, …). For each phase:

### 4a — Skip if already complete

If all `<li>` elements in `<ul class="checklist">` have `class="done"`, print:
> "✅ Phase N: [Title] — already complete, skipping."

Move to the next phase immediately.

### 4b — Announce and orient

Print a clear header before starting work:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase N of M: [Title]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Overview text from the phase file]
```

Read the phase file fully. Consult any reference documents cited with `<div class="ref">` inline citations before writing code.

### 4c — Implement

Build everything described in "What Will Be Built" and follow all "Implementation Notes". Respect every constraint in `CLAUDE.md`.

**Scope discipline:** implement only what this phase describes. Do not implement work from later phases even if you can see it — phase boundaries exist because later phases may depend on decisions not yet made.

### 4d — Verify each criterion

After implementation, go through every `<li>` in `<ul class="checklist">` one by one. For each:

1. **Determine what it requires**: file existence, test output, database row, HTTP response, visual check, etc.
2. **Run the verification**: use `Bash`, `Read`, `Grep`, or `WebFetch` as appropriate.
3. **If it passes**: mark it done immediately (see 4e).
4. **If it fails**: diagnose, fix, and re-verify before marking done.

**Criteria that cannot be verified automatically** (e.g. "design matches mockup", "stakeholder has approved"):
Ask the user directly:
> "Criterion N requires manual verification: '[criterion text]'. Can you confirm this is satisfied?"

Do not mark it done until the user confirms.

**Do not advance to the next phase if any criterion remains unmet.**

### 4e — Check off criteria in real time

As each criterion is satisfied, immediately update the phase HTML using the Edit tool.

Change:
```html
<li>Criterion text here</li>
```
to:
```html
<li class="done">Criterion text here</li>
```

Match the exact criterion text so the edit is unambiguous. Modify nothing else in the file.

### 4f — Mark the phase complete

When every `<li>` in `<ul class="checklist">` carries `class="done"`, insert a completion banner into the HTML file.

Find the opening `<h1>` tag of the phase file and use Edit to prepend the banner before it:

```html
<div style="background:#f0fdf4;border:1.5px solid #4ade80;border-radius:7px;padding:.65rem 1.1rem;margin-bottom:1.5rem;font-size:.9rem;color:#166534;font-weight:500;">
  ✅ Phase complete — all criteria satisfied.
</div>
```

Do not alter any other structure in the file.

### 4g — Confirm and advance

Print:
> "✅ Phase N complete. Advancing to Phase N+1."

Then begin Step 4 again for the next phase.

---

## Step 5 — Final summary

After all phases are complete, print:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Build complete: [Project Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Phase 1: [Title]
✅ Phase 2: [Title]
...
```

Then list any remaining manual steps the user must take themselves (production migrations, environment variable changes, third-party configuration, deployments). If there are none, say so.

---

## Guardrails

- **Never re-execute a complete phase.** Completion is determined solely by `<li class="done">` state — not by timestamps or file dates.
- **Never modify plan content.** The only permitted HTML edits are adding `class="done"` to `<li>` elements and inserting the completion banner before `<h1>`. All other content is read-only.
- **Never skip criteria.** Every checklist item must be verified and checked off before a phase is marked complete. "I believe this works" is not verification.
- **Scope to the phase.** If you notice a bug or improvement outside the current phase's scope, note it for the user but do not fix it during this phase.
