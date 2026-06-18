---
name: pre-commit-review
description: Review everything not yet committed in the working tree before commit, including staged, unstaged, and untracked files, excluding ignored files. Gives a chat-only commit-readiness review with a score, verdict, branch/base context, and numbered actionable issues. Use when the user wants to check recent local changes before committing, review uncommitted work, or ask whether current working tree changes are safe and ready to commit.
allowed-tools: Bash(git:read-only), Bash(test:*), Read, Glob, Grep
model: sonnet
effort: high
---

Perform a careful, human-readable pre-commit review of everything not yet committed.

The goal is to answer:

1. Are the current local changes safe and ready to commit?
2. What should be fixed or double-checked before committing?
3. Are there any obvious risks from how these local changes interact with the current branch context?

This is a chat-only review. Do not save a markdown file unless the user explicitly asks.

---

## Scope

Review everything not yet committed, excluding ignored files:

- staged changes
- unstaged changes
- untracked files

Treat `HEAD` as already committed. Everything else is the review target.

If a file has both staged and unstaged changes, review the not-yet-committed state as a whole, but call out whether an issue is in:

- staged
- unstaged
- both

Ignored files should not be reviewed.

---

## Safety rules

**Read-only repository commands only.**

You may run:

- `git branch`
- `git log`
- `git diff`
- `git status`
- `git show`
- `git merge-base`
- `git rev-parse`
- `git remote -v`
- `git check-ignore`

Never run commands that mutate repository state, including:

- `git checkout`
- `git reset`
- `git commit`
- `git push`
- `git pull`
- `git merge`
- `git rebase`
- `git add`
- `git rm`
- `git clean`
- `git stash`

---

## Inputs

The user may optionally specify:

- a narrower scope such as staged-only or unstaged-only
- a base branch or fixed point if they want explicit comparison context
- a spec, PRD, issue, or path if they want light spec-awareness

Default behavior:

- review all not-yet-committed changes
- exclude ignored files
- use branch/base/spec context lightly
- return results in chat only

---

## Phase 1: Detect repository and context

1. Detect repo root:

   ```bash
   git rev-parse --show-toplevel
   ```

2. Detect current branch:

   ```bash
   git branch --show-current
   ```

3. Detect base branch, unless user gave one explicitly:

   ```bash
   git rev-parse --verify develop >/dev/null 2>&1 && echo develop || echo main
   ```

4. Validate the chosen base or fixed point resolves before continuing:

   ```bash
   git rev-parse --verify <base>
   ```

5. Determine whether the current branch already differs from base:

   ```bash
   git log <base>..HEAD --oneline --no-decorate
   git diff <base>...HEAD --stat
   ```

6. Determine whether a spec source exists:

   - First use any spec, PRD, issue link, or path explicitly provided by the user.
   - Otherwise infer lightly from branch name, commit messages, or nearby `docs/`, `specs/`, or `.scratch/` files if obviously relevant.
   - If nothing useful is found, continue without spec context.

Branch and spec context are secondary. They help interpret the local changes, but they are not the main review target.

---

## Phase 2: Gather working-tree review target

Run:

```bash
git status --short
git diff
git diff --cached
```

Also account for untracked files from `git status --short`.

Review all untracked files except those ignored by git. If needed, confirm ignore status with:

```bash
git check-ignore <path>
```

Capture these explicitly for the response:

- current branch
- comparison base
- whether branch context exists beyond local changes
- whether the review covered staged, unstaged, untracked, or all three

If there is nothing staged, nothing unstaged, and no relevant untracked files, reply:

```text
Nothing to review.
```

Stop there.

---

## Phase 3: Analyze local changes

Review the local uncommitted changes first and foremost.

Focus on:

- Correctness: bugs, edge cases, null handling, broken conditions, races, inconsistent state
- Safety: risky edits, accidental debug code, temporary hacks, unsafe config changes
- Security: auth, permissions, secrets, token handling, validation, injection
- Data/database: migrations, models, schema or data compatibility concerns
- API/contracts: request/response shape, events, jobs, queues, integration expectations
- Frontend/user impact: rendering, loading/error states, accessibility, UX regressions
- Performance: obvious waste, N+1 patterns, unnecessary recomputation, memory risks
- Tests: missing or weak coverage for meaningful behavior changes
- Maintainability: duplication, confusing naming, unnecessary complexity, poor typing
- Commit hygiene: accidental unrelated edits, noisy files, mixed concerns, generated artifacts that should not be committed
- Spec alignment: only light review here; mention obvious mismatches, missing expected behavior, or visible scope creep if the intended feature is clear

Before claiming a convention violation, check for nearby or similar in-repo patterns.

Prefer fewer, higher-confidence findings over a long speculative list.

---

## Phase 4: Use branch context lightly

If the branch already differs from base, add only a short context note.

Use branch context to help answer questions like:

- do these local edits depend on broader branch changes?
- is there an obvious mismatch with the apparent feature direction of the branch?
- is there any branch-level risk that makes these local edits harder to judge safely?

Do **not** turn this into a full branch review.

Do **not** bury local issues under branch analysis.

If branch context is not relevant, say nothing about it.

---

## Phase 5: Score commit readiness

Assign a commit-readiness score from 0–100%.

This is not a merge-readiness score. It estimates confidence that the current local changes are coherent, safe, and ready to commit.

Suggested interpretation:

- `95–100%` — ready to commit; only trivial concerns if any
- `85–94%` — commitable after minor fixes or checks
- `70–84%` — meaningful issues should be addressed before commit
- `50–69%` — risky; not recommended to commit yet
- `<50%` — high risk, incomplete, or too messy to commit safely

Use severity to guide scoring:

- Any clear blocker normally caps score at `69%`.
- Multiple blockers normally cap score at `50%`.
- Missing important tests normally caps score around `85%`, lower if the behavior is risky.
- Only nits/questions normally keep score `90%+`.
- Mixed unrelated edits or obvious commit-hygiene problems should reduce the score.

---

## Phase 6: Response format

Return a concise, human-readable review in chat.

Use this structure:

```markdown
## Pre-Commit Review

**Branch:** <branch>  
**Base:** <base>  
**Review scope:** staged / unstaged / untracked / all  
**Branch context:** none / light context summary  
**Spec context:** none / `<path-or-issue>`  
**Commit readiness:** <N>%  
**Verdict:** Ready to commit / Commit after minor fixes / Not ready to commit

### Summary

Short plain-English summary of whether the local changes look safe and coherent.

### Recommended validation order

1. [ ] BLOCKER — `path/file.ts:42` — Short title
2. [ ] SHOULD-FIX — `path/file.ts:88` — Short title
3. [ ] TESTS — `path/file.test.ts` — Missing coverage for X

### Active issues

#### 1. BLOCKER — Short title

**Change area:** staged / unstaged / both / untracked  
**File:** `path/file.ts:42-55`  
**Category:** Correctness / Security / Tests / Maintainability / Performance / Data / API / Frontend / Commit hygiene / Spec  
**Axis:** Commit readiness / Standards / Spec / Tests / Security  
**Confidence:** High / Medium / Low  
**Impact:** One sentence about what can go wrong.

##### What I found

Plain-English explanation.

##### Relevant code

```diff
@@ -42,5 +42,5 @@ functionName
 small focused snippet
```

##### Why it matters

Explain the consequence in practical terms.

##### Suggested next step

Optional. Keep it concise.

#### 2. SHOULD-FIX — Short title

...

### Non-blocking notes

Short bullets for minor nits/questions. Keep this section brief.

### Final recommendation

One short paragraph saying whether the user should commit now or fix specific things first.
```

Format rules:

1. Write for a human reader.
2. Use numbered issues so the user can say “let’s check issue 2”.
3. Keep each issue self-contained.
4. Use small code snippets only. Avoid giant diff dumps.
5. Every active issue must be actionable or explicitly marked as a question.
6. Include `Change area` so the user knows whether the issue is in staged, unstaged, both, or untracked work.
7. Include `Axis` so the user can quickly see the type of concern.
8. Prefer plain English over jargon.
9. Cap non-blocking notes at roughly 10 items.
10. If there are no active issues, say so clearly and make the recommended validation order empty.
11. Do not invent issues just to fill the review.

Severity labels:

- `BLOCKER` — should not commit until addressed or explicitly accepted
- `SHOULD-FIX` — should be fixed before commit if practical
- `TESTS` — missing or weak test coverage for meaningful behavior
- `QUESTION` — needs clarification before deciding risk
- `NIT` — optional cleanup only

---

## Final response behavior

Keep the answer concise.

Always include:

- verdict
- commit-readiness score
- review scope
- whether branch/spec context affected the review
- active issue count by severity

Do not save a file unless the user explicitly asks.

---

Begin the pre-commit review now.
