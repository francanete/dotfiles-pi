# Review: `[branch-name]` → `[base-branch]`

**Last review:** [YYYY-MM-DD HH:MM]
[If a prior review was supplied via Inputs, also include:]
**Compared with:** `[path/to/prior/review.md]` ([N] suppressed by `<!-- ignore -->`, [N] new findings marked 🆕)

**Verdict:** [✅ Ready to merge | ⚠️ Should-fix only | ❌ Has blockers]
**[N] blocking · [N] should-fix · [N] nits** · [N] commits · [N] files · +[add]/-[del]
[Solo mode] — or — [Team mode: frontend, backend, sql, security, tests, consistency]

[1–2 sentences: what this branch does and the bottom line.]

> Tip: to suppress a finding in future reviews, add `<!-- ignore: <reason> -->` on its own line directly under the severity-prefix line, then pass this file as `--prior` next time.

---

## 🚫 Blockers

[One review-comment block per finding. Omit this section if none.]

#### `path/to/file.ts:40-44` ✓ validated `security` `logic`

```diff
@@ -40,5 +40,5 @@ function getUser
 function getUser(req) {
   const userId = req.params.id;
-  const q = `SELECT * FROM users WHERE id = ${userId}`;
+  // ...
   return db.query(q);
 }
```

**blocking — SQL injection via string interpolation**

`userId` flows from `req.params` directly into a templated query. Use parameterized replacements per the project's Sequelize convention:

```diff
+  const q = sequelize.query(
+    'SELECT * FROM users WHERE id = :id',
+    { replacements: { id: userId } }
+  );
```

---

#### `path/to/another.tsx:88` `logic`

```diff
@@ -86,3 +86,4 @@ function ProfileCard({ user }: Props) {
 export function ProfileCard({ user }: Props) {
   const t = useTranslation();
+  const name = user.profile.displayName.trim();
   return <Box>{name}</Box>;
```

**blocking — missing null guard on `user.profile`**

`user.profile` is optional on `UserProfile` (see `app/cxm-core/src/domain/user.ts:42`). This will throw at render for unverified accounts. Per project convention, use an explicit guard rather than optional chaining:

```diff
+const name = user.profile ? user.profile.displayName.trim() : '';
```

---

## ⚠️ Should fix

[One review-comment block per finding. Omit this section if none.]

#### `path/to/file.js:12` `dry`

```diff
+export function formatPhone(n) {
+  return n.replace(/[^\d]/g, '').replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
+}
```

**should-fix — duplicates existing helper**

`formatHelper()` in `app/cxm-core/src/utils/format.ts:45` already implements this. Import it instead of re-implementing.

```diff
+import { formatHelper } from '@cxm-core/utils/format';
```

---

#### `path/to/handler.ts:22-26` 🆕 `tests`

```diff
+export async function deleteAccount(userId: string) {
+  await db.users.destroy({ where: { id: userId } });
+  await pubsub.publish('account.deleted', { userId });
+}
```

**should-fix — no test coverage for new public function**

`deleteAccount` is exported and reachable from the API but has no test in `tests/handler.test.ts`. Add a happy-path test plus one for the missing-user case.

---

## 💡 Nits

[Bullet list of one-liners. Omit this section if none.]

- `path/to/file.ts:10` — **nit:** alias `mu` violates SQL convention; use the unaliased table or a descriptive alias.
- `path/to/other.ts:55` — **nit:** em dash in user-facing string; prefer comma or new sentence.
- `path/to/x.ts:120` — **nit:** unused import `lodash/merge`.

---

## ❓ Questions

[Optional. Use for things the reviewer can't decide without the author. Omit if none.]

#### `path/to/file.ts:33`

**question — is the new retry intentional on 4xx?**

`retryOnError` now retries on any non-2xx, including `400`/`404`. Was that the intent, or should it be limited to `5xx` and network errors as the existing `httpClient.ts:88` does?

---

<details>
<summary>Filtered out by validation pass ([N])</summary>

[Team mode only. Findings the validator marked `false-positive`. Each line: original claim, source specialist, verbatim validator evidence. Omit this `<details>` block entirely in solo mode or when nothing was filtered.]

- `path/to/file.ts:30` — race-condition claim from `backend-reviewer` dropped. Validator: "the cited block is wrapped in a transaction on line 28, so the read/write is atomic".
- `path/to/y.ts:12` — duplicate-helper claim from `consistency-reviewer` dropped. Validator: "the cited helper at `utils/format.ts:45` has a different signature and would not satisfy the call site".

</details>

<details>
<summary>Specialist verdicts (team mode)</summary>

[Team mode only. One row per specialist that ran. Omit this block entirely in solo mode.]

| Specialist  | Verdict | One-liner                                          |
|-------------|---------|----------------------------------------------------|
| Frontend    | ✅      | No issues.                                         |
| Backend     | ❌      | SQL injection in `getUser`.                        |
| SQL/DB      | ⚠️      | Missing index on new `account_id` column.          |
| Security    | ❌      | See backend blocker.                               |
| Tests       | ⚠️      | `deleteAccount` uncovered.                         |
| Consistency | ✅      | API contract and frontend caller aligned.          |

</details>

---

## Format conventions

[This section is documentation for whoever fills the template — do not include in the rendered review.]

- **One concern per comment block.** If a function has two issues, that's two blocks.
- **File anchor format:** ` `path/to/file.ts:LINE` ` for single line, ` `path/to/file.ts:START-END` ` for ranges. Putting the line number directly on the path makes it clickable in most terminals/editors. Do NOT write `lines 144–149` in prose — that loses the hyperlink.
- **Diff hunk first, comment second, suggested fix last.** Mirrors the GitHub PR review UI.
- **Both code blocks use ` ```diff `.** The context hunk above the comment shows the actual diff (`-`/`+`/space prefixes). The suggested-fix block below the comment uses `+` prefixes for every line so the proposal renders green and is unambiguously marked as new code, not existing code. Never use ` ```suggestion ` — it loses color outside GitHub.
- **Severity prefix in bold** at the start of the comment body: `blocking`, `should-fix`, `nit`, `question`, `praise`. No emoji in the prefix.
- **Tags as inline backticks** on the header line: `security`, `logic`, `perf`, `quality`, `convention`, `simplify`, `dry`, `breaking`, `tests`, `consistency`.
- **`✓ validated` marker** goes on the header line right before the tags, team mode only, only on `confirmed` findings.
- **`🆕` marker** goes on the header line right before the tags, only when a prior review was supplied via Inputs and this finding is not in it. If both `✓ validated` and `🆕` apply, order is: line range → `✓ validated` → `🆕` → tags.
- **Ignore annotation:** to suppress a finding in future reviews, add `<!-- ignore: <reason> -->` on its own line directly under the severity-prefix line of the comment block. Next time you pass this file as `--prior`, that finding will be silently dropped.
- **Skip empty sections.** If there are no nits, omit the `## 💡 Nits` heading entirely.
- **Cap nits at ~10.** If you have more, you're fishing — surface a count and stop.
- **Suggested-fix block is optional.** Omit when the fix is non-trivial or the comment is a `question`.
