---
name: branch-code-review
description: Comprehensive code review of all changes on the current branch versus its base (develop/main). Auto-detects large diffs and spawns a parallel team of specialist reviewers (frontend, backend, SQL/DB, security, tests, cross-domain consistency). Use whenever the user asks to review the current branch, review changes before pushing, audit a feature branch, run a pre-merge check, or compare HEAD against develop/main. Make sure to use this skill any time a branch-wide review is requested, even if the user only says "review my changes" or "review this PR".
allowed-tools: Bash(git:read-only), Bash(mkdir:*), Bash(cat:*), Bash(grep:*), Bash(test:*), Read, Write, Glob, Grep, TaskCreate, TeamCreate, TaskList, TaskUpdate, TaskGet, TaskOutput, TaskStop, SendMessage, TeamDelete, ToolSearch
model: sonnet
effort: high
---

**Scope:** Tuned for the CXM monorepo path layout; adjust the area classifications if used elsewhere.

Perform a comprehensive code review of all changes in the current branch compared to its base branch.

**CRITICAL: READ-ONLY COMMANDS ONLY**
You may ONLY run these git commands:
- `git branch` (list/show branches)
- `git log` (view history)
- `git diff` (view changes)
- `git status` (view status)
- `git show` (view objects)
- `git merge-base` (find common ancestor)
- `git rev-parse` (parse refs)
- `git remote -v` (list remotes)

NEVER run: `git checkout`, `git reset`, `git commit`, `git push`, `git pull`, `git merge`, `git rebase`, `git add`, `git rm`, `git clean`, `git stash`, or ANY command that modifies the repository.

---

## Inputs

The user may invoke this skill with optional context:

- **Prior review path** — if the user says something like *"compare with the existing review"*, *"here's the previous review at <path>"*, or passes `--prior <path>`, read that file before starting. Use it for the New-vs-existing diff in Phase 5 and to honor `<!-- ignore: ... -->` annotations the user may have left in it.
- **Save override** — if the user says `--no-save` or *"don't save the file"*, skip Phase 6's file write at the end. Otherwise auto-save is the default.

If the user did not pass a prior review path explicitly, do **not** auto-discover one. Run a fresh review.

---

## Phase 1: Gather Context

1. **Detect base branch and current branch:**
   ```bash
   git branch --show-current
   ```

   ```bash
   # Detect base branch (develop if exists, otherwise main)
   git rev-parse --verify develop >/dev/null 2>&1 && echo "develop" || echo "main"
   ```

2. **Get commit history and diff stats:**
   ```bash
   git log <base>..HEAD --oneline --no-decorate
   git diff <base>...HEAD --stat
   git diff <base>...HEAD --name-only
   ```

3. **Classify changed files into areas:**
   - **Frontend**: `app/frontend/**`, `app/cxm-core/**`, `*.tsx`, `*.jsx`, `*.css`, `*.scss`
   - **Backend**: `app/api/**`, `app/mono/**`, `app/voice/**`, `app/websocket-server/**`, `app/cron/**`, `app/flow/**`, `app/ingest/**`, `app/salesforce-cdc/**`
   - **SQL/DB**: `infrastructure/sql/**`, `**/migrations/**`, `**/seeders/**`, `*.sql`, Sequelize model files (`**/models/**`)
   - **Tests**: `**/*.test.*`, `**/*.spec.*`, `**/tests/**`, `app/e2e-testing-suite/**`, `app/tests/**`
   - **Security-sensitive**: Files touching auth, tokens, secrets, integrations, permissions, middleware

**Empty-diff edge case:** If `git log <base>..HEAD` is empty, report "No changes to review on this branch" and stop.

---

## Phase 2: Decide Review Mode

Count how many areas have changed files. Use **team mode** if **3 or more areas** have changes. Otherwise use **solo mode**.

### Solo Mode (< 3 areas changed)

Run the review yourself following the standard analysis below (Phase 3-Solo).

### Team Mode (3+ areas changed)

Spawn a team of specialist review agents in parallel. Each agent reviews ONLY the files in their domain. Proceed to Phase 3-Team.

---

## Phase 3-Solo: Standard Single-Agent Review

Get the full diff:
```bash
git diff <base>...HEAD
```

Analyze the changes from ALL these perspectives, but DO NOT output findings per-phase. Instead, collect all findings for the consolidated output:

**Perspectives to analyze:**
- Logic & Correctness (bugs, edge cases, null handling, race conditions)
- Security (injection, validation, secrets, auth)
- Performance (memory leaks, unnecessary work, N+1 patterns)
- Code Quality (complexity, naming, types)
- Project Conventions (check CLAUDE.md for project-specific rules, **and apply the User Review Rules block defined in [references/team-mode.md](references/team-mode.md)**)
- Simplification (can code be significantly simpler?)
- DRY (does similar code already exist in codebase?)
- Breaking Changes (will this break other code?)
- Test Coverage (are new/modified code paths covered by tests?)

Search for DRY violations, breaking change impacts, and test coverage gaps. Produce findings in the **PR-comment block format** described in Phase 5 (file-anchor header + ` ```diff ` hunk + severity-prefixed comment + optional ` ```suggestion ` block). Then **skip Phase 4 (validation runs in team mode only)** and go straight to Phase 5. Solo findings appear in the report unmarked (no `✓ validated` markers, no `Filtered out by validation pass` block, no `Specialist verdicts` block).

---

## Phase 3-Team: Spawn Specialist Agents

First call `ToolSearch` with `query: 'select:TaskCreate,TeamCreate,TaskList,TaskUpdate,SendMessage'` to load the spawn primitives, then use `TaskCreate` (not `Task`) to spawn each specialist with `subagent_type: 'general-purpose'`, `model: 'sonnet'`, `effort: 'high'`.

Each agent gets:
- The list of changed files in their domain
- The branch name and base branch
- Instructions to produce findings in the standard format
- **The User Review Rules block, appended verbatim to their prompt**
- **The Comment Block Format block, appended verbatim to their prompt** (so subagents emit findings in the exact shape the orchestrator expects)

**IMPORTANT**: Only spawn agents for areas that actually have changes. Skip areas with no changed files. The Security and Cross-Domain Consistency reviewers always run in team mode regardless of area count.

If team mode triggered, see [references/team-mode.md](references/team-mode.md) for the full specialist agent prompts, the User Review Rules block, and the Comment Block Format block to append to each.

---

## Phase 4: Validate Findings (team mode only)

**Solo mode skips this phase entirely** — its findings go straight to Phase 5 unmarked.

After all specialists complete, first consolidate, then validate.

**4a. Consolidate**:
1. **Collect** all agent outputs
2. **Deduplicate** — if multiple agents flagged the same code (e.g., backend + security both flag an injection), merge into one finding with combined tags. Keep the highest severity of the merged set.
3. **Group by severity** — `blocking` > `should-fix` > `nit` > `question`. The final report renders these as separate sections; do not interleave.
4. **Determine overall verdict** — ❌ if any `blocking` finding survives, ⚠️ if only `should-fix` / `nit`, ✅ if no findings at all.
5. **Clean up the specialist team** — send shutdown requests and delete the team

**4b. Validate**: run a single validator subagent that re-checks every aggregated finding against the actual code. This catches false-positives from individual specialists who may have misread context.

1. **Aggregate** all consolidated findings into a single flat list. Each entry must carry: file path, line number, claim, severity, tags, and source-specialist.
2. **Spawn one validator subagent** via `TaskCreate` with `subagent_type: 'general-purpose'`, `model: sonnet`, `effort: high` (the validator is the single quality gate — see [references/team-mode.md#validator](references/team-mode.md#validator) for the rationale). Pass it:
   - The full aggregated findings list (verbatim claims, not paraphrased)
   - The validator prompt and rules from [references/team-mode.md#validator](references/team-mode.md#validator)
3. **Receive** a verdict per finding: `confirmed`, `partial`, or `false-positive`, each with a one-line evidence string.
4. **Apply verdicts** when assembling the Phase 5 report:
   - `confirmed` → keep the finding as a comment block in its severity section, and add the marker `✓ validated` on the header line right before the inline tags (e.g. `#### \`file.ts\` line 42 ✓ validated \`security\``).
   - `partial` → keep the finding but demote its severity by one step (`blocking` → `should-fix`, `should-fix` → `nit`). Append the validator's verbatim caveat as a final italicized line inside the comment body: `_Validator caveat: …_`.
   - `false-positive` → remove from the main report entirely. Collect all dropped findings in the `Filtered out by validation pass` `<details>` block at the bottom, each with the validator's evidence string verbatim, so the user can spot-check the validator's calls.
5. The validator must not introduce new findings or comment on style. If it tries to, ignore those lines.

---

## Phase 5: Output

Fill in the template at [assets/review-report-template.md](assets/review-report-template.md). The output mimics a GitHub/GitLab PR review: a header verdict, then a flat stream of comment blocks grouped by **severity** (blockers → should-fix → nits → questions), not by file or category.

### If a prior review was supplied (Inputs)

Read the prior review file. Then, when assembling the new report:

1. **Honor ignore annotations.** Any finding in the prior file that has an HTML comment of the form `<!-- ignore: <reason> -->` directly under its severity-prefix line is suppressed: if the new review would surface a semantically-equivalent finding (same file, same kind of concern, regardless of small line drift or rewording), drop it silently. Do NOT include it in the new report. At the top of the new report, in the metadata block, include `**Suppressed by prior <!-- ignore --> annotations:** N` so the user knows how many were dropped.
2. **Mark genuinely new findings.** Add the marker `🆕` on the header line right before the inline tags (mirroring `✓ validated`'s placement) for any finding in the new review that does NOT have a semantic match in the prior review. Findings that *do* match an existing prior finding appear unmarked — do not add a "still present" or "✅ resolved" marker. Only `🆕` matters.
3. **Match semantically, not by string equality.** Two findings match if they're about the same file and the same underlying concern (small line shifts, rewordings, refactored code that still has the same problem all count as the same finding). Use judgment; don't write a fuzzy-match algorithm.

### Anatomy of a comment block

````markdown
#### `path/to/file.ts:40-44` [✓ validated] `tag1` `tag2`

```diff
@@ -40,5 +40,5 @@ functionName
 context line
-removed line
+added line
 context line
```

**severity — short title**

One or two sentences explaining the concern, citing concrete code or sibling files where useful.

```diff
+fixed code goes here
+(every line prefixed with + so it renders green)
```
````

- **Header — file anchor:** ` `path/to/file.ts:LINE` ` for a single line, ` `path/to/file.ts:START-END` ` for ranges. The line number must be attached directly to the path (with `:`) so terminals/editors hyperlink it. Do NOT write `lines N–M` after the path — that loses the click-through. Optional `✓ validated` (team mode, `confirmed` only), then space-separated inline-backtick tags.
- **Context diff hunk:** ` ```diff `-tagged. Include the `@@ -L,N +L,N @@ optional-context @@`-style hunk header so line numbers are visible in the gutter. Show only the few lines needed for context. Use `-`/`+`/space prefixes per the actual diff.
- **Severity prefix:** bold, lowercase: `**blocking — title**`, `**should-fix — title**`, `**nit — title**`, `**question — title**`, `**praise — title**`. The em dash here is a fixed structural marker — leave it as-is.
- **Suggested-fix block:** ` ```diff `-tagged with **every line prefixed `+`** so the proposal renders green and is unambiguously marked as new code, not existing code. Do NOT use ` ```suggestion ` — it doesn't render with color outside GitHub. Optional — omit when the fix is non-trivial, when the comment is a `question`, or when rendered as a one-line nit.

### Output rules

1. **One concern per block.** Two issues in the same function = two blocks.
2. **Group by severity, not by file or category.** A reader's first question is "what must I fix to merge", not "what's wrong with file X".
3. **Tags as inline backticks**, not sections. A DRY violation is a comment tagged `dry`, not its own section.
4. **Skip empty severity sections** entirely (no `## 💡 Nits` heading if there are no nits).
5. **Cap nits at ~10.** Beyond that, state the count and stop.
6. **Nits are one-liners.** No diff hunk, no suggestion block: `` - `file.ts:10` — **nit:** alias `mu` violates SQL convention. ``
7. **Every finding must be actionable.** No vague "consider reviewing this".
8. **`✓ validated` markers and the `Filtered out by validation pass` / `Specialist verdicts` `<details>` blocks are team-mode only.** Solo mode omits all three.
9. **Max ~3 non-nit blocks per file.** If a file has more, the most-impactful 3 graduate; the rest become nits.

### Tag reference

Inline backticks on the header line, lowercase, combine multiple when relevant.

- `logic` — bugs, edge cases, incorrect behavior
- `security` — vulnerabilities, validation, secrets, auth
- `perf` — inefficiency, N+1, memory leaks
- `quality` — complexity, naming, types
- `convention` — project style violations (User Review Rules, CLAUDE.md, memory)
- `simplify` — can be significantly simpler
- `dry` — duplicates existing code
- `breaking` — may break other code or external contracts
- `tests` — missing or weak test coverage
- `consistency` — cross-domain mismatch (API/consumer, model/migration, event/listener)

---

## Phase 6: Save the report

Unless the user passed `--no-save` or asked you not to save, persist the rendered report to disk.

**Path:** `<repo-root>/.claude/reviews/<branch-name-with-slashes-replaced-by-dashes>.md` — a flat file inside `.claude/reviews/`, no subdirectories. Replace every `/` in the branch name with `-`. Example: branch `feat/fcanete/MS_Teams_realtime_users` → `.claude/reviews/feat-fcanete-MS_Teams_realtime_users.md`. The file replaces any prior version at the same path (one file per branch — overwrite, do not accumulate timestamped copies).

**Steps:**

1. Compute the path. Use `git rev-parse --show-toplevel` to find the repo root. Replace all `/` in the branch name with `-` to form the filename.
2. Ensure the reviews directory exists: `mkdir -p <repo-root>/.claude/reviews` (flat — no subdirectories).
3. Write the rendered report with `Write`. Replaces any prior file.
4. **Gitignore reminder (one-shot per session):** check whether `.claude/reviews/` is ignored. Run:
   ```bash
   git check-ignore -q .claude/reviews/dummy.md && echo "ignored" || echo "not-ignored"
   ```
   If the answer is `not-ignored`, append a single line at the very end of your text reply to the user (NOT inside the saved file): `> Tip: add \`/.claude/reviews/\` to your \`.gitignore\` (or \`~/.config/git/ignore\`) to keep these review notes local.` Do not nag the user on subsequent runs in the same session.
5. **Print the saved path** in your text reply to the user, on its own line, prefixed `Saved review to: ` so it's easy to spot and click.

**If the file already existed before this run** (i.e. there was a prior review at the same path) and the user did NOT pass that prior file as input via Inputs, mention it in your text reply: `> Note: a prior review existed at <path> and was overwritten. Pass it as input next time if you want a New-vs-existing diff.`

---

Begin the review now.

<details><summary>Eval tasks</summary>

1. Small UI-only branch (1-3 files in `app/frontend/`) → should route to solo mode.
2. Large multi-area branch (frontend + API + SQL migration) → should route to team mode and spawn frontend, backend, SQL/DB, plus consistency reviewer.
3. Security-sensitive branch (auth/permissions changes) → should always include the security reviewer regardless of size.

</details>
