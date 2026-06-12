---
name: project-planner
description: Conducts a structured intake interview to fully understand a new feature, epic, or sub-project, then generates a sequence of HTML phase documents that a project-builder skill can execute in order. Invoke when the user wants to plan significant new work.
arguments: [project_name]
allowed-tools: Read Glob Grep Write Bash WebFetch
---

# Project Planner

You are running a structured planning session. Work through the five steps below in order. Do not skip to phase generation until the interview is complete and all open questions are resolved.

---

## Step 1 — Read the codebase first

Before asking anything, orient yourself:

- Read `CLAUDE.md` for stack, conventions, and architecture
- Read `docs/` for any existing design or API reference docs
- Glob `src/` to understand the directory structure
- Read `package.json` (or equivalent) for dependencies

Use what you learn to skip interview questions whose answers are already unambiguous from the code. Note any assumptions you're making from the codebase so the user can correct them.

---

## Step 2 — Intake interview

Conduct a thorough interview. Ask one cluster of related questions at a time — not a wall of everything at once. Wait for answers. Ask follow-up questions on anything ambiguous before moving to the next cluster. Do not proceed to Step 3 until every branch of the tree is resolved.

If $project_name was provided as an argument, skip the naming question.

### Question tree

**Project identity**
- What is the name of this planning session / feature / epic? ← skip if `$project_name` provided
- In one sentence: what problem does this solve, and for whom?
- Is this a new feature, a refactor, a performance improvement, or something else?

**Scope**
- Walk me through the user journey end-to-end — what does the user do, and what does the system do at each step?
- What are the must-have behaviors for this to be considered shippable?
- What is explicitly out of scope for this work?
- Are there hard deadlines, milestones, or external dependencies with dates?

**Functional requirements** (ask follow-up branches as needed)
- What are the edge cases and error states that must be handled?
- Are there any admin or internal-only behaviors alongside the user-facing ones?
- Are there notification, email, or async job requirements?

**Non-functional requirements**
- Are there performance expectations? (concurrency, response time, data volume)
- Security or access control requirements beyond what already exists?
- Accessibility, internationalization, or device-target requirements?

**Technical context** (skip anything already clear from the codebase)
- Which existing files, tables, or services will this touch?
- Does this require new external services, APIs, or npm packages?
- Are schema migrations required? If so, do the new tables/columns affect existing data?
- Does this introduce any breaking changes or require coordinated deploys?

**Reference documents**
- Do you have any supporting materials? (wireframes, mockups, API specs, design docs, user stories, exported Figma files, CSVs, etc.)
- For each document: ask the user to share it (path or paste content), then ask follow-up questions until you understand exactly which phases it informs and what decisions it settles.

**Validation and acceptance**
- How will each major piece be manually tested?
- Are automated tests expected (unit, integration, e2e)?
- Who reviews/approves before this is considered done?

---

## Step 3 — Store reference documents

For every reference document the user provides:

1. If it's a local file path, read it.
2. If it's a URL, fetch it.
3. If it's pasted content, treat that as the source.
4. Write it to: `docs/planning/$project_name/references/<original-filename>`
5. Confirm each file was stored and note which phases it will inform.

---

## Step 4 — Design and generate phase documents

### Sequencing rules

Design phases so that:
- No phase depends on work defined in a later phase
- Schema/migration work precedes application code that uses it
- Auth and permissions work precedes features that require it
- Server-side data flows precede client-side UI that consumes them
- Core functionality precedes polish, error handling, and edge cases
- Each phase is independently testable and completable in one focused session
- Aim for 4–8 phases for most features; split or merge to keep each phase cohesive

### Output

For each phase, write a file to:

```
docs/planning/$project_name/phase-01-<slug>.html
docs/planning/$project_name/phase-02-<slug>.html
...
```

Use zero-padded numbers so files sort correctly. Use a short kebab-case slug that names what the phase builds (e.g. `phase-02-schema-migrations`, `phase-04-scoreboard-ui`).

Use this exact HTML template for every phase file:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Phase N: [Title] — [Project Name]</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.65; color: #111; }
    h1 { font-size: 1.6rem; border-bottom: 3px solid #e8463a; padding-bottom: .5rem; margin-bottom: .5rem; }
    h2 { font-size: 1.1rem; color: #333; margin-top: 2rem; border-bottom: 1px solid #e5e5e5; padding-bottom: .25rem; }
    h3 { font-size: 1rem; color: #444; }
    .meta { display: flex; flex-wrap: wrap; gap: 1.5rem; background: #f7f7f7; padding: .75rem 1rem; border-radius: 6px; font-size: .875rem; margin-bottom: 1.75rem; color: #444; }
    .meta strong { color: #111; }
    .checklist { list-style: none; padding: 0; margin: 0; }
    .checklist li { padding: .4rem 0 .4rem .25rem; border-bottom: 1px solid #f0f0f0; display: flex; gap: .75rem; align-items: flex-start; font-size: .95rem; }
    .checklist li::before { content: "☐"; font-size: 1.1rem; color: #aaa; flex-shrink: 0; margin-top: .05rem; }
    .ref { background: #fffbeb; border-left: 3px solid #f59e0b; padding: .5rem .85rem; margin: .75rem 0; border-radius: 0 5px 5px 0; font-size: .875rem; }
    .ref a { color: #92400e; font-weight: 500; }
    .dep { background: #eff6ff; border-left: 3px solid #60a5fa; padding: .5rem .85rem; margin-bottom: 1.25rem; border-radius: 0 5px 5px 0; font-size: .875rem; color: #1e40af; }
    .note { background: #f0fdf4; border-left: 3px solid #4ade80; padding: .5rem .85rem; margin: .75rem 0; border-radius: 0 5px 5px 0; font-size: .875rem; }
    code { background: #f3f4f6; padding: .15rem .4rem; border-radius: 3px; font-size: .875em; font-family: ui-monospace, monospace; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 1rem 1.25rem; border-radius: 7px; overflow-x: auto; font-size: .875rem; }
    pre code { background: none; padding: 0; font-size: inherit; }
    a { color: #e8463a; }
  </style>
</head>
<body>

<h1>Phase N: [Title]</h1>

<div class="meta">
  <span><strong>Project:</strong> [Project Name]</span>
  <span><strong>Phase:</strong> N of M</span>
  <span><strong>Depends on:</strong> Phase N-1 complete &mdash; <em>or</em> None (first phase)</span>
</div>

<!-- Only include if this phase truly depends on a prior one -->
<div class="dep">
  ⚠️ <strong>Prerequisite:</strong> Phase N-1 ([Title]) must be complete before starting this phase.
</div>

<h2>Overview</h2>
<p>[2–3 sentences describing what this phase builds and why it comes at this point in the sequence. The project-builder reads this first to orient themselves.]</p>

<h2>What Will Be Built</h2>
<p>[Detailed, specific description of every deliverable in this phase. Name files, tables, components, API routes, migrations. The project-builder should be able to start building from this section alone.]</p>

<!-- Inline citation whenever a reference doc settles a decision or provides context -->
<div class="ref">
  📄 See <a href="references/filename.ext">filename.ext</a> — [one sentence describing what's relevant in this doc for the above deliverable].
</div>

<h2>Implementation Notes</h2>
<p>[Constraints, patterns, or decisions the project-builder must respect. Reference CLAUDE.md conventions where applicable. Include any known gotchas.]</p>

<h3>Key files to read before starting</h3>
<ul>
  <li><code>src/path/to/relevant/file.ts</code> — [why it's relevant]</li>
</ul>

<h2>Completion Criteria</h2>
<p>Every item below must be satisfied before proceeding to Phase N+1.</p>
<ul class="checklist">
  <li>[Specific, verifiable criterion — prefer observable outcomes over vague ones]</li>
  <li>[Another criterion]</li>
</ul>

<h2>How to Validate</h2>
<p>[Step-by-step manual test instructions. Be concrete: name the URL, the action, and the expected result. Reference test data or seed scripts where applicable.]</p>

</body>
</html>
```

**Inline citation guidance:**
- Add a `<div class="ref">` callout immediately after any passage where a reference document provides context, settles a design decision, or contains data the project-builder needs.
- If no reference documents exist for this project, omit all `.ref` divs.

---

## Step 5 — Confirm and hand off

After all phase files are written:

1. List every file created with its path and a one-sentence summary of what that phase builds.
2. Show the complete phase sequence as a numbered list so the user can verify the order makes sense.
3. Summarize any assumptions you made from the codebase that the user should review.
4. Tell the user: **"Run `/project-builder $project_name` to begin executing these phases in order."**
