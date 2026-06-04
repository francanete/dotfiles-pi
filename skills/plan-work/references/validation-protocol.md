# Validation protocol

How phase 2 of `plan-work` invokes the validator and surfaces results.

## Why a separate agent

The validator must read the plan cold to catch what the planner missed. If it has access to the planning conversation, it inherits the planner's blind spots. Treat this isolation as load-bearing.

## How to invoke

Spawn `fran-general:plan-validator` via the `Agent` tool. The prompt must contain ONLY two facts:

1. The absolute path to the plan .md
2. The repo root (the working directory the validator should investigate against)

### Exact prompt template

```
Validate the plan at <ABSOLUTE_PATH_TO_PLAN_MD>.
Repo root: <ABSOLUTE_PATH_TO_REPO_ROOT>.

Read the plan cold. Cross-reference against the codebase. Return your structured findings report per your output spec.
```

That is the entire prompt. Do NOT include:

- Conversation history with the user
- Your own summary of what the plan says
- Hints about what to look for ("watch out for X")
- Reassurance ("the user already knows about Y")

Each of these defeats the purpose.

## How to surface findings

When the validator returns:

1. Print a `## Validation findings` header.
2. Reproduce the validator's report verbatim. Do not edit, summarize, or re-rank.
3. Below the report, ask: *"Want me to address any of these in the plan?"*

If the validator returns "no findings", say so plainly — don't pad.

## When to skip phase 2

Only when the user explicitly opts out (e.g., "skip validation, just write the plan"). Note in the chat that validation was skipped, so the user remembers it's an unvalidated draft.

## Failure modes

- **Validator reads the wrong file** — confirm the absolute path you passed.
- **Validator returns shallow findings** — likely the plan was too vague for cross-referencing. Push the user to make phase 1 more concrete on the next iteration.
- **Validator and user disagree on a finding** — surface the disagreement; don't suppress either side. The user decides.
