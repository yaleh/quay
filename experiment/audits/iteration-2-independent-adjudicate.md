# Iteration 2 — Independent Adjudicate Audit (QN-001, QN-003, QN-004, QN-005)

Performed with zero prior context from the self-check artifacts (did not read
`experiment/iterations/iteration-2.md`, `experiment/provenance.md`, or
`experiment/audits/iteration-2-adjudicate.md`). All findings below are from
direct inspection of raw files and live command runs.

## Method notes

- `quay-native task check` resolves its tasks dir relative to CWD by default,
  or `$QUAY_NATIVE_TASKS_DIR` if set. Running from `packages/quay-native/`
  without the env var silently resolves to a nonexistent
  `packages/quay-native/tasks/` and reports `"not found"` for every id — this
  is not a gate failure, just a CWD/env-var footgun. All `task check` calls
  below use `QUAY_NATIVE_TASKS_DIR=/home/yale/work/quay/tasks`.
- No scratch task files were left in the real `tasks/` directory. All CLI/MCP
  exercise for QN-001 used a throwaway store at `/tmp/qn001-scratch/tasks`
  (deleted after use). No `tasks/AUDIT-TEST.md` was ever created.

## Per-task verdicts

### QN-001 — Wire `--body`/`--children`/`--extra` into `task edit` — **PASS-WITH-CONCERNS**

Raw file: `status: done`, all AC/DoD boxes checked.

Mechanical gate:
```
QUAY_NATIVE_TASKS_DIR=/home/yale/work/quay/tasks node bin/quay-native.js task check QN-001 --json
{"id":"QN-001","gate":"none","ok":true,"reason":"terminal"}
```
Agrees (task is `done`, gate returns terminal pass — this only confirms the
gate accepts the current state, not that `ready→done` was ever independently
re-derived, since the file was already `done` when I checked it).

Code trace, `bin/quay-native.js`'s `edit` subcommand:
```js
if (flags.body !== undefined) patch.body = flags.body;
if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra);
...
const t = store.write(id, patch);
```
All three flags are genuinely wired and passed to `store.write()`, not just
string-matched. Verified end-to-end on a scratch store (not the real task
files):
```
node bin/quay-native.js task create AUDIT-TEST --title scratch --body "initial body"
node bin/quay-native.js task edit AUDIT-TEST --body "edited body zzz zero" \
    --children "K-1,K-2" --extra '{"foo":"bar"}' --json
```
Result: `body`, `children` (→ `role: "compound"`, correctly re-derived), and
`extra` all applied and persisted correctly via the CLI path.

**Concern (new bug found, not previously flagged in the task's own text):**
MCP's `task_write` tool does **not** accept `extra` at all. Its
`inputSchema` in `src/mcp-server.js` only declares
`id, title, status, labels, parent, children, body` — `extra` is missing.
I confirmed this empirically, not just by reading the schema: patching a
twin scratch task via MCP `task_write` with
`{ id, body, children, extra: {foo:"bar"} }` produced a resulting task with
`"extra": {}`, i.e. the `extra` value was silently dropped before reaching
`store.write()`. The CLI can set `extra`; MCP cannot. This is the exact
class of "ABI symmetry" gap QN-001's own Proposal describes finding for
`body`/`children` on the CLI side — it still exists, just now on the MCP
side and for a different field (`extra`), and it went uncaught by
`test/abi-symmetry.mjs` because that test's `task_write_value_equivalence`
case only diffs `body`/`children`/`role`, never `extra`. QN-001's AC and DoD
as written do not claim anything about `extra`'s MCP-side symmetry
specifically (only that CLI `--extra` sets the object, which is true), so
this is not a false checkbox — but it is an adjacent, real gap in the same
symmetry contract QN-001 is about, worth flagging for a follow-up task.

**Verdict: PASS** on the literal AC/DoD as written (all four verified
individually and truthfully); **WITH-CONCERNS** because the broader
CLI/MCP symmetry claim in the task's framing is incomplete — `extra` is
CLI-only, undetected by the existing symmetry test.

### QN-003 — Port `quay:author` orchestration Skill — **PASS**

Raw file: `status: done`, AC/DoD checked. `skills/author/SKILL.md` (121
lines) exists and contains substantive content: four explicitly named steps
(`write-proposal`, `review-proposal`, `write-plan`, `review-plan`), each with
a stated "Dispatch-capable target" and "Degraded fallback" (currently
active, same-session checklist). Gaps section honestly states "No
subagent-dispatch primitive exists in this environment (confirmed by
iteration 1's explicit `ToolSearch` check — not assumed)" and describes what
was and wasn't exercised. This is real, specific content, not placeholder
text.

Mechanical gate: `{"id":"QN-003","gate":"none","ok":true,"reason":"terminal"}`
— agrees with `done` status.

**Verdict: PASS.**

### QN-004 — Port `quay:execute` orchestration Skill — **PASS**

Raw file: `status: done`, AC/DoD checked. `skills/execute/SKILL.md` (124
lines) exists, mirrors QN-003's structure: named steps `implement-phase`,
`self-audit-ac`, `gate-check`, each with dispatch-capable/degraded-fallback
statements. Contains an explicit, load-bearing "Independent-audit
requirement (not optional)" note under `self-audit-ac` stating the
`ready→done` transition is provisional pending a separate out-of-band audit
— matching the task's AC #2 claim exactly. Gaps section names the same
no-subagent-dispatch-primitive finding and states plainly "This Skill itself
remains entirely unexercised as of iteration 1" — an honest, unhedged
admission, not spin.

Mechanical gate: `{"id":"QN-004","gate":"none","ok":true,"reason":"terminal"}`
— agrees.

**Verdict: PASS.**

### QN-005 — Deepen `task_check` gate correctness / fix `\Z` bug — **PASS**

Raw file: `status: done`. AC/DoD text reads correctly and completely — not
truncated (ironic given the bug being fixed is a truncation bug; I read the
raw file directly and it is intact, containing the word "zero" in its own
Proposal prose without issue).

Mechanical gate: `{"id":"QN-005","gate":"none","ok":true,"reason":"terminal"}`
— agrees.

## `\Z` bug — independently verified, genuinely fixed

Current `store.js` `extractSection()`:
```js
const re = new RegExp(`^##\\s+${h}\\b([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "im");
```
The old anchor `\Z` (not valid in JS regex — JS has no `\Z` metacharacter) is
gone, replaced by `(?![\s\S])`, a genuine JS end-of-string zero-width
lookahead (true "no characters remain", not a literal `Z`/`z` match). I
independently reconstructed the *old* buggy regex from the code comment's own
description and ran both side-by-side on adversarial input:

```
body = "## AC\nWhen the count is zero this used to truncate.\n- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n## DoD\nsomething"

OLD regex (\Z literal, case-insensitive): captures "\nWhen the count is "
  → truncates at the "z" in "zero", losing all four checkboxes.
NEW regex ((?![\s\S])):                  captures the full section including
  all four checkboxes.
```
This proves the bug was real, reproducible, and is now genuinely gone — not
just claimed.

Additional edge cases I ran myself directly against the current `store.js`
(not the bundled test file), via `createStore()` on a throwaway store:

- **Section at true end-of-file (no trailing heading):** a task missing its
  `## DoD` heading correctly reports `dod: false` (no false-truncation
  artifact hiding a missing section) and the gate correctly fails with
  `"missing artifacts: dod"`.
- **Sections containing many literal z/Z characters** ("Zero, zebra, ZULU,
  size zzz all present..."): AC section correctly retained and its checkbox
  count (`acTotal: 2`) was unaffected — no truncation at any of the
  z/Z occurrences.
- **Nested `###` sub-headings inside a `##` section:** a `### Sub-heading`
  inside `## AC` did **not** stop capture early (only true `##`-level
  headings terminate a section) — both checkboxes after the sub-heading
  were correctly counted (`acTotal: 2`).
- **AC as the final section in the file, no trailing newline:** correctly
  captured both checkboxes (`acTotal: 2`), confirming the `(?![\s\S])`
  branch fires correctly at true EOF.

All edge cases behave correctly. The fix is genuine, not moved/masked
elsewhere.

### `test/gate-correctness.test.mjs` — exists, substantive, passes

Ran directly: `node test/gate-correctness.test.mjs` → **exit 0**, all 13
assertions pass:
```
PASS: GC-A ... heading-only-no-content fails the gate
PASS: GC-B ... prose-only AC (no checkboxes) fails the gate
PASS: GC-C ... passes when both new bars are met
PASS: GC-D ... done task still gates ok:true (terminal) [no regression]
PASS: GC-E ... AC section is not truncated at the word "zero" (acTotal should be 4, got 4)

All gate-correctness tests passed.
```
Test cases meaningfully cover the fixed bug (case GC-E specifically
reconstructs the "zero"-truncation scenario against `execute->done`'s real
checkbox count, not just a superficial "does it run" smoke test) plus the
two new `author->ready` heuristics (minimum content length, AC-checkbox
presence) with both a failing and passing case each, and an explicit
no-regression check on the terminal `done` path. This is not a superficial
test file — it exercises the actual failure mode (checkbox count silently
truncated) with a concrete assertion on `acTotal`, which is exactly the
metric the old bug would have corrupted.

## QN-001 CLI↔MCP ABI symmetry — additional finding

Beyond the `extra`-field gap above, the existing value-equivalence check in
`test/abi-symmetry.mjs` (`task_write_value_equivalence`) is real (uses two
sibling tasks, one patched via CLI, one via MCP, then diffs actual `body`,
`children`, and `role` values — not just key sets) and passes:
```
"task_write_value_equivalence": {
  "cliBody": "patched via CLI", "mcpBody": "patched via CLI",
  "cliChildren": ["C-1","C-2"], "mcpChildren": ["C-1","C-2"],
  "cliRole": "compound", "mcpRole": "compound",
  "match": true
}
```
This is a legitimate, non-superficial symmetry test for the fields it
covers. It simply doesn't cover `extra`, which is the gap noted above.

## Test suite results

Repo has no root-level test runner or `npm test` script (`/home/yale/work/quay/package.json`
is an npm workspaces root with no `scripts` block at all; `packages/quay/package.json`
and `packages/quay-native/package.json` also have no `scripts.test`). The de
facto suite is four standalone `.mjs` files in `packages/quay-native/test/`,
run manually via `node <file>`:

```
node test/abi-symmetry.mjs        → ALL FOUR SURFACES SYMMETRIC, exit 0
node test/gate-correctness.test.mjs → All gate-correctness tests passed, exit 0
node test/lock.test.mjs           → All QN-006 lock tests passed, exit 0
node test/concurrent-writer.mjs   → not a standalone test; it's a helper
                                     process spawned by lock.test.mjs with
                                     positional args (tasksDir, id, label,
                                     runs). Running it directly with no args
                                     throws (undefined tasksDir passed to
                                     mkdirSync). This is expected/correct
                                     usage, not a bug — lock.test.mjs invokes
                                     it correctly with real args and that
                                     test passes.
```
All real tests pass. `packages/quay` (the Core CLI/web client package) has
no tests at all currently — not a regression caused by these four tasks,
just a pre-existing gap worth noting since the audit asked for a broader
sanity check.

## New bugs / discrepancies found (summary)

1. **MCP `task_write` silently drops `extra`** (`src/mcp-server.js`
   `inputSchema` omits `extra` entirely, unlike the CLI's `edit --extra`).
   Confirmed empirically via a live MCP client call. Not covered by
   `test/abi-symmetry.mjs`'s value-equivalence case. This is a real,
   previously-undetected CLI/MCP asymmetry, in the same family of bug
   QN-001 was written to close (just the mirror-image direction, and for a
   different field). Does not falsify any of QN-001's actual AC claims
   (none of which claim MCP-side `extra` support), but it undercuts the
   task's broader "ABI symmetry" narrative and should be tracked as a
   follow-up.
2. Default tasks-dir CWD-resolution footgun in `bin/quay-native.js`
   (`resolveTasksDir()`) — running the CLI from `packages/quay-native/`
   without `$QUAY_NATIVE_TASKS_DIR` silently looks in the wrong directory
   and reports `"not found"` rather than any kind of "wrong directory"
   warning. Minor UX issue, not a correctness bug, not in scope for any of
   the four tasks, but worth noting since it could mislead a future
   operator running `task check` from the wrong CWD into thinking a task
   doesn't exist.
3. No functional regressions found anywhere in `store.js`, the CLI, or the
   MCP server as a result of these four tasks' changes.

## Overall verdict

**PASS-WITH-CONCERNS**, driven entirely by the QN-001 MCP `extra` gap
(concern #1 above). All four tasks' own AC/DoD claims, as literally written,
are true and independently verified against real command runs — not "should
work" reasoning. The `\Z` regex bug is genuinely fixed (proven via
side-by-side reconstruction of the old vs. new regex against adversarial
input, plus my own additional edge-case probing beyond the bundled test
file), and `test/gate-correctness.test.mjs` is a real, substantive test that
passes and meaningfully targets the fixed failure mode. QN-003 and QN-004's
SKILL.md files are real, non-placeholder content matching their stated AC.
The one adjacent finding (MCP-side `extra` field silently dropped) is new,
real, and not previously documented in any of the four tasks' own text —
worth a follow-up task, but does not invalidate any of the four `done`
verdicts as scoped.
