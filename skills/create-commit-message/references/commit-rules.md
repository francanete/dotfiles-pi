# Commit Message Rules

## The Seven Rules

1. Separate subject from body with a blank line.
2. Limit the subject line to 50 characters. Going slightly over for clarity is acceptable, but going over 72 is not.
3. Capitalize the subject line.
4. Do not end the subject line with a period.
5. Use imperative mood in the subject line ("Fix bug" not "Fixed bug" or "Fixes bug").
6. Wrap the body at 72 characters.
7. Sanity-check: if prepending "If/when committed, this will..." to the subject does not produce a sensible sentence, the subject is wrong.

## Additional Guidelines

- **Body is mandatory for complex changes.** If the diff touches more than one file in a non-obvious way, or the why is not self-evident from the subject, write a body.
- **Prose paragraphs only.** No bullet points, no dashes, no numbered lists. Write in full sentences.
- **Problem first, then solution.** Explain what was wrong or missing, then what this commit does about it.
- **What and why, not how.** The diff already shows how; the message explains what and why.
- **Out-of-context readability.** The message must make sense to someone reading `git log` six months from now with no surrounding conversation.
- **No em dashes.** Use commas, parentheses, or new sentences instead.
- **Ticket references go in the body**, never the subject.
- **Squash default.** This message lands in permanent history, so write accordingly.
- **Keep the body tight.** One or two short paragraphs is almost always enough. Don't pad.

## Examples

Good — short subject only, when the change is self-evident:
```
Readd indent rule to API ESLint config
```

Good — subject + one paragraph, problem-first:
```
Resolve on success before checking timeout

Checking count > 10 first meant a free extension on the 11th poll
would reject instead of resolve. Check StatusText first so a late
success is never treated as a timeout.
```

Good — subject + two paragraphs for a more complex change:
```
Merge afterAll hooks into one to fix Jest upgrade ordering

The latest version of Jest alters lifecycle event ordering, which caused
the two separate afterAll hooks to run out of order, closing the
database connection before the unwind had finished destroying records
created during the test suite.

Consolidating into a single afterAll guarantees the unwind runs first,
then the database connection is closed, regardless of how Jest schedules
multiple hooks.
```

Good — explains context, impact, and scope without listing:
```
Fix unsafe property access in user tasks endpoint

Use lodash get() to safely access nested scopes object to prevent
TypeError when req.api.jwt.data.scopes.omnidesk is undefined.

This can occur when a user has no permissions in the omnidesk
application. The fix allows the endpoint to gracefully fall back to
campaign_current role instead of throwing.
```

Bad — bullet points, too long, no clear narrative:
```
Add private config changes

- Add private_config_meta field
- Update integrations
- Fix HubSpot
- Add tests
```

Bad subject (period, past tense, too vague):
```
added some fixes.
```
