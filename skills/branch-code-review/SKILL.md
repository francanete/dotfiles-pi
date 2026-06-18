---
name: branch-code-review
description: Human-readable branch merge-readiness review. Reviews the current branch against develop/main, auto-loads any existing .agents/reviews review for the branch, refreshes outstanding/new/resolved issue context, assigns a merge-readiness score, and saves a checklist-style markdown report for issue-by-issue follow-up validation. Use whenever the user asks to review the current branch, review changes before merging, audit a feature branch, run a pre-merge check, review this PR, or check whether a branch is safe to merge.
allowed-tools: Bash(git:read-only), Bash(mkdir:*), Bash(test:*), Read, Write, Glob, Grep
model: sonnet
effort: high
---

Perform a careful, human-readable merge-readiness review of all changes in the current branch compared to its base branch.

The goal is not to produce terse PR comments. The goal is to create a clear markdown review document that the user can work through issue by issue with the assistant later.

---

## Core outcome

Create or refresh one review document at:

```text
<repo-root>/.agents/reviews/<branch-name-with-slashes-replaced-by-dashes>.md
```

Example:

```text
.agents/reviews/feat-fcanete-MS_Teams_realtime_users.md
```

The report must answer:

1. Is this branch ready to merge?
2. What is the merge-readiness score?
3. What are the highest-risk issues?
4. Which issues are new, still present, resolved-looking, ignored, or need validation?
5. What order should the user validate/fix issues in?

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

You may also create the local review directory and write the review markdown file.

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

The user may provide optional context:

- `--no-save` or “do not save” — produce the report in the response only and skip writing the file.
- A specific base branch or fixed point — use it if explicitly provided.
- A specific prior review path — read it if provided, but normally auto-detect the branch review file.
- A spec, PRD, issue link, or spec path — use it for optional spec-alignment review.

Default behavior is to auto-load the existing review file for the current branch if it exists.

---

## Phase 1: Detect branch, base, review path, and spec context

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

   If it does not resolve, stop and ask the user to clarify the comparison point.

5. Compute review path:

   - Replace every `/` in the branch name with `-`.
   - Use a flat file directly inside `.agents/reviews/`.

   ```text
   <repo-root>/.agents/reviews/<safe-branch-name>.md
   ```

6. If the review file already exists, read it before starting the new review.

   Treat it as prior context, not as truth. The current code and diff always win.

7. Determine whether a spec source exists:

   - First use any spec, PRD, issue link, or path explicitly provided by the user.
   - Otherwise look for likely matching files under `docs/`, `specs/`, or `.scratch/`.
   - If nothing useful is found, proceed without spec review.

   Spec alignment is optional. Do not block the review if no spec is available.

---

## Phase 2: Gather review context

Run:

```bash
git status --short
git log <base>..HEAD --oneline --no-decorate
git diff <base>...HEAD --stat
git diff <base>...HEAD --name-only
git diff <base>...HEAD
```

Capture these explicitly for the report header:

- Comparison base: `<base>`
- Reviewed range: `<base>...HEAD`
- Commits reviewed: short commit list from `git log <base>..HEAD --oneline --no-decorate`

If `git log <base>..HEAD` is empty and the diff is empty, report:

```text
No branch changes found to review.
```

Still save a short review file unless `--no-save` was requested.

---

## Phase 3: Analyze changes

Review the branch from these angles:

- Correctness: bugs, edge cases, null handling, races, state mismatches
- Security: auth, permissions, secrets, tokens, injection, validation
- Data/database: migrations, models, schema changes, backward compatibility
- API/contracts: request/response shape, events, jobs, queues, integrations
- Frontend/user impact: rendering, loading/error states, accessibility, UX regressions
- Performance: N+1 patterns, expensive loops, memory leaks, unnecessary network calls
- Tests: missing coverage for changed behavior, weak assertions, untested edge cases
- Maintainability: unnecessary complexity, naming, duplication, type quality
- Project conventions: match existing patterns in the repo; do not invent new conventions
- Spec alignment: if a spec exists, check for missing requirements, partial implementation, incorrect implementation, or scope creep
- Merge risk: anything that could break production, CI, deploys, or downstream consumers

Before claiming a pattern violation, search for nearby or similar in-repo examples and cite them if useful.

If a spec exists, summarize:

- whether the branch appears aligned overall
- any missing or partial requirements
- any behavior added that the spec did not ask for
- any implementation that appears inconsistent with the intended behavior

Prefer fewer, higher-quality findings over a long list of weak speculation.

---

## Phase 4: Reconcile with existing review, if present

If an existing review file was found, compare its issues with the current branch state.

For each previous issue:

- **Still present** — the same underlying concern still exists.
- **Resolved?** — the relevant code appears changed or removed, but user confirmation may be useful.
- **Ignored** — preserve if the old issue was marked ignored or has clear validation notes saying it should be ignored.
- **Needs validation** — the previous issue cannot be confidently confirmed or dismissed from the current diff alone.

Rules:

1. Do not duplicate an existing issue as a separate new issue if it is the same underlying concern.
2. Mark repeated issues as `Still present`.
3. Mark genuinely new findings as `New`.
4. Preserve useful old validation notes when they still apply.
5. If a prior issue appears fixed, include it in the “Previous review context” table as `Resolved?`, not in the main active issue list unless there is still a concrete problem.
6. The current code and diff override the previous review. If the previous review was wrong, say so briefly.

---

## Phase 5: Score merge readiness

Assign a merge-readiness score from 0–100%.

This is not a generic code-quality score. It estimates confidence that the branch can be merged safely.

Suggested interpretation:

- `95–100%` — ready or nearly ready; only trivial issues
- `85–94%` — likely mergeable after minor checks or fixes
- `70–84%` — meaningful issues should be addressed first
- `50–69%` — risky; not recommended to merge yet
- `<50%` — high risk or incomplete

Use severity to guide scoring:

- Any confirmed blocker normally caps score at `69%`.
- Multiple blockers normally cap score at `50%`.
- Missing important tests normally caps score around `85%`, lower if behavior is risky.
- Only nits/questions normally keep score `90%+`.

Also include a score breakdown table:

- Correctness
- Security
- Tests
- Maintainability
- Merge/deploy risk

---

## Phase 6: Report format

Render the report in this human-readable markdown format.

```markdown
# Branch Review: <branch-name>

**Base:** <base>  
**Branch:** <branch>  
**Reviewed range:** `<base>...HEAD`  
**Review file:** `.agents/reviews/<safe-branch>.md`  
**Existing review loaded:** Yes/No  
**Spec source:** None / `<path-or-issue>`  
**Merge readiness:** <N>%  
**Verdict:** Ready / Probably ready / Not ready / High risk

## Commits reviewed

- `<sha> message`
- `<sha> message`

## Summary

Short plain-English summary of what changed and the main merge risk.

## Score breakdown

| Area | Score | Notes |
|---|---:|---|
| Correctness | 90% | ... |
| Security | 95% | ... |
| Tests | 75% | ... |
| Maintainability | 85% | ... |
| Merge/deploy risk | 80% | ... |

## Spec alignment

Include this section only if a spec source exists.

- **Overall alignment:** Aligned / Mostly aligned / Unclear / Misaligned
- **Source:** `<path-or-issue>`
- **Notes:** Short plain-English summary of gaps, scope creep, or unclear behavior.

## Previous review context

Include this section only if an existing review was loaded.

| Previous issue | Current status | Notes |
|---|---|---|
| #1 Short title | Still present | Same underlying issue remains in `path/file.ts`. |
| #2 Short title | Resolved? | Code changed; user should confirm behavior. |

## Recommended validation order

1. [ ] BLOCKER — Still present — `path/file.ts:42` — Short title
2. [ ] SHOULD-FIX — New — `path/file.ts:88` — Short title
3. [ ] TESTS — New — `path/file.test.ts` — Missing coverage for X

## Active issues

### 1. BLOCKER — Short title

**Status:** New / Still present / Needs validation  
**File:** `path/file.ts:42-55`  
**Category:** Correctness / Security / Tests / Maintainability / Performance / Data / API / Frontend / Merge risk  
**Axis:** Merge risk / Standards / Spec / Tests / Security  
**Confidence:** High / Medium / Low  
**Impact:** One sentence about what can go wrong.

#### What I found

Plain-English explanation.

#### Relevant code

```diff
@@ -42,5 +42,5 @@ functionName
 small focused snippet
```

#### Why it matters

Explain the consequence in practical terms.

#### Suggested fix

Optional. Include only if the fix is reasonably clear. Keep it concise.

#### Validation notes

- Pending user validation.

### 2. SHOULD-FIX — Short title

...

## Non-blocking notes

Short bullets for minor nits/questions. Keep this section brief.

## Final recommendation

One paragraph saying what should happen before merge.
```

Format rules:

1. Write for a human reader, not for GitHub inline comments.
2. Use numbered issues so the user can say “let’s check issue 3”.
3. Keep each issue self-contained.
4. Use small code snippets only. Avoid giant diff hunks.
5. Every active issue must be actionable or explicitly marked as a question.
6. Include an `Axis` field for each active issue so the user can see whether it is primarily merge-risk, standards, spec, tests, or security related.
7. Prefer plain English over jargon.
8. Cap non-blocking notes at roughly 10 items.
9. Do not bury blockers under long summaries.
10. If there are no active issues, say so clearly and make the recommended validation order empty.
11. Do not invent issues just to fill the report.

Severity labels:

- `BLOCKER` — should not merge until addressed or explicitly accepted
- `SHOULD-FIX` — should be fixed before merge, but not necessarily catastrophic
- `TESTS` — missing or weak test coverage for meaningful behavior
- `QUESTION` — needs clarification before deciding risk
- `NIT` — optional cleanup only

Issue status labels:

- `New`
- `Still present`
- `Needs validation`
- `Resolved?`
- `Ignored`

Only include `Resolved?` and `Ignored` issues in “Previous review context”, not in “Active issues”, unless there is still a concrete active risk.

---

## Phase 7: Save the report

Unless the user passed `--no-save` or asked not to save:

1. Ensure the directory exists:

   ```bash
   mkdir -p <repo-root>/.agents/reviews
   ```

2. Write the rendered report to the computed review path with `Write`.

3. If the file existed before this run, overwrite it with the refreshed report.

4. In the final user response, print one of:

   ```text
   Created review: <path>
   ```

   or

   ```text
   Updated review: <path>
   ```

5. Check whether `.agents/reviews/` is ignored:

   ```bash
   git check-ignore -q .agents/reviews/dummy.md && echo ignored || echo not-ignored
   ```

   If it is not ignored, append this tip once in the final response:

   ```markdown
   > Tip: add `/.agents/reviews/` to your `.gitignore` or global git ignore if you want review docs to stay local.
   ```

---

## Final response to user

Keep the final response concise:

- verdict
- merge-readiness score
- reviewed range
- spec source used or not used
- active issue count by severity
- created/updated review path
- gitignore tip if relevant

Do not paste the full report in chat if it was saved, unless the user asks.

---

Begin the branch review now.
