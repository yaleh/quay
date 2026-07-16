# Iteration 3 — Independent Adjudicate Audit

Performed with zero prior context from `experiments/quay-native-bootstrap/iterations/iteration-3.md`,
`experiments/quay-native-bootstrap/provenance.md`, or `experiments/quay-native-bootstrap/audits/iteration-3-adjudicate.md`
(none of those were read). All findings below are derived from direct
inspection of raw artifacts and live command execution performed during this
audit.

## Claim 1 — QN-007 ("fix MCP extra-field bug"): **PASS**

**Schema inspection.** `packages/quay-native/src/mcp-server.js`'s `task_write`
tool's `inputSchema` declares:

```js
extra: z.record(z.any()).optional(),
```

immediately after `body`. This is present in the file as currently checked
out.

**Live end-to-end round-trip test (independent, not from the task's own
claimed repro).** Created a scratch task store at `/tmp/audit-scratch-tasks`
(outside the repo, no real QN-*.md files touched) with task `AUDIT-TEST-3`:

- CLI `task edit --extra '{"nested":{"a":1,"b":[1,2,3]},"flat":"x"}'` round-tripped
  correctly via CLI `task get`.
- A dedicated Node script (temporarily placed inside
  `packages/quay-native/test/` so module resolution could find
  `@modelcontextprotocol/sdk`, then deleted afterward) opened a real MCP
  client connection and called `task_write` with a **nested, non-trivial**
  extra value: `{ nested: { a: 1, b: [1,2,3], deep: { c: "z" } }, flat: "y",
  arr: [ {x:1}, {x:2} ] }`.
  - MCP `task_write` response's `task.extra` == the exact nested value sent.
  - Subsequent MCP `task_get` call returned the same exact nested value.
  - Subsequent **CLI** `task get --json` (separate process) returned the same
    exact nested value.
  - All three round-trips matched byte-for-byte (`JSON.stringify` equality),
    confirmed programmatically (script exited 0).

This directly disproves any suspicion of superficial fix (e.g. it round-trips
for flat strings but not nested objects) — nested arrays/objects survive both
surfaces cleanly.

**Adversarial break/restore test on `test/abi-symmetry.mjs` (the most
important check).**

1. Baseline run of `node test/abi-symmetry.mjs`: **PASS**, exit 0, prints
   `ALL FOUR SURFACES SYMMETRIC`. The `task_write_value_equivalence` and
   `task_write_extra_only_equivalence` blocks both report `match: true`, with
   the latter explicitly diffing a **nested** extra value
   (`{"foo":"bar","nested":{"n":1}}`), not just a flat string or key
   presence.
2. Temporarily commented out the `extra: z.record(z.any()).optional(),` line
   in `mcp-server.js` (backed up original file by md5sum first:
   `93509b9454972d13087c77d78e2828c1`).
3. Re-ran `node test/abi-symmetry.mjs`: **test correctly FAILED**, exit 1,
   printed `MISMATCH FOUND`. Specifically:
   - `task_write_value_equivalence.mcpExtra` reverted to `{}` while
     `cliExtra` remained `{"k":"v"}` — `match: false`.
   - `task_write_extra_only_equivalence.mcpExtra` reverted to `{}` while
     `cliExtra` remained the nested value — `match: false`.
   - The other four blocks (`task_list`, `task_get`, `task_write` key-set,
     `task_check`) still passed, correctly isolating the regression to the
     `extra`-value checks only.
4. Restored the original file from backup; verified byte-identical via
   md5sum (`93509b9454972d13087c77d78e2828c1` matched exactly, confirmed with
   `diff` returning no output).
5. Re-ran `node test/abi-symmetry.mjs` one final time: **PASS**, exit 0,
   `ALL FOUR SURFACES SYMMETRIC` again.

**Conclusion: the test has real teeth.** It fails when the bug is
reintroduced and passes when the fix is present — this is not a test that
passes unconditionally regardless of the underlying code.

**Task file inspection.** `tasks/QN-007.md` raw frontmatter:
`status: done`, all four AC checkboxes are `[x]` (checked), all four DoD
items are `[x]` (checked). Content (Proposal/Plan/AC/DoD) is substantive,
specific, and consistent with what was actually verified above (describes
the exact same schema change, the same test-strengthening approach, and the
same nested-value round-trip claim). No placeholder text.

**Mechanical gate.** `cd packages/quay-native && QUAY_NATIVE_TASKS_DIR=<repo>/tasks
node bin/quay-native.js task check QN-007 --json` →
`{"id":"QN-007","gate":"none","ok":true,"reason":"terminal"}`. Gate agrees:
task is `done` and terminal (no further gate to satisfy).

Note: the default `tasksDir` resolution in `bin/quay-native.js` is
`process.cwd()+"/tasks"`, which resolves to
`packages/quay-native/tasks/` (containing only a stray `V-1.md`) unless
`QUAY_NATIVE_TASKS_DIR` is set to point at the repo-root `tasks/` directory
where the real QN-*.md files live. This is a minor pre-existing usability
quirk (see "New bugs found" below), not a defect in QN-007 itself — once
pointed at the correct directory, the gate for QN-007 reports `ok: true`
correctly.

## Claim 2 — QN-002 ("GitHub Provider" authored to `ready`, not executed): **PASS**

**Task file inspection.** `tasks/QN-002.md` raw frontmatter:
`status: ready` (not `done`, not `todo`). Proposal, Plan (4 phases), AC (4
items), and DoD (4 items) sections are all substantive and specific — no
placeholder/lorem-ipsum content. All 4 AC checkboxes are unchecked (`[ ]`),
confirmed by direct grep of the raw file (0 of 4 checked). This matches the
claim exactly.

**Scope/discipline check.** The Plan explicitly restricts v1 scope to
`data.read` + `manifest` capabilities only, explicitly deferring
`data.write`/`gate`/`skill` to a future task ("mirroring how native itself
staged `data.read` before `data.write`/`gate`"). It explicitly separates
"Phase 0 — precondition gate (execution-time only)" and labels Phases 1–4 as
deliverables for a *future* execution, not this iteration. This reads as
honest walking-skeleton discipline (G5) rather than gold-plating — it
resists the natural temptation to design labels/milestones/webhooks/
projects-v2 up front, and it explicitly calls out open questions (id scheme,
status-label convention, sub-issue mapping) as unresolved rather than
prematurely deciding them.

**Verification that nothing beyond authoring happened.**
- `find` across the entire repo (excluding `node_modules`/`.git`) for
  `*quay-github*` or any `*github*`-named file: **zero results**. No
  `packages/quay-github` directory, no `DESIGN.md` for it, no stub
  `provider.yml`, no `github-client.js` — nothing exists beyond this task's
  own prose.
- `git status --short` at repo root shows only pre-existing untracked
  directories (`experiments/quay-native-bootstrap/`, `packages/`, `tasks/`, etc. — the whole
  project appears to not yet be committed beyond the two prior commits) and
  a `.gitignore` modification; no GitHub-provider-shaped new files anywhere.
- `gh auth status` (read-only, non-mutating) was run per instructions and
  shows: logged in as `yaleh`, active account true, scopes `codespace,
  gist, read:org, repo, workflow`. This is consistent with the task's Phase
  0 precondition description but was NOT invoked as part of this task's own
  authoring (no evidence of `gh auth status` or any other `gh` command
  appearing anywhere in artifacts/files produced by QN-002's authoring — the
  task correctly defers this check to a future execution phase). No
  mutating `gh` command was run by this audit either.

Conclusion: QN-002 is genuinely design-only, appropriately minimal in scope,
and no code or GitHub-side action was taken.

## Claim 3 — Full regression check

Test files under `packages/quay-native/test/`:

| File | Role | Result |
|---|---|---|
| `abi-symmetry.mjs` | standalone test (run directly) | **PASS** (exit 0, `ALL FOUR SURFACES SYMMETRIC`) |
| `gate-correctness.test.mjs` | standalone test (run directly) | **PASS** (exit 0, "All gate-correctness tests passed.") |
| `lock.test.mjs` | standalone test (run directly) | **PASS** (exit 0, "All QN-006 lock tests passed.") |
| `concurrent-writer.mjs` | **not a standalone test** — a helper process spawned by `lock.test.mjs` with CLI args (`tasksDir id label runs`); throws `ERR_INVALID_ARG_TYPE` if invoked directly with no args, by design | N/A when run directly (expected); exercised correctly and passes as part of `lock.test.mjs`'s own run |

No `test` script is defined in `packages/quay-native/package.json`; running
each `.mjs` file directly with `node` is the intended invocation, consistent
with how `lock.test.mjs` spawns `concurrent-writer.mjs` internally via
`execFileSync`/similar with explicit arguments.

**Prior-iteration task regression spot check** (via
`quay-native.js task check <id> --json`, pointed at repo-root `tasks/`):

| Task | status (frontmatter) | gate check result |
|---|---|---|
| QN-001 | done | `{"gate":"none","ok":true,"reason":"terminal"}` |
| QN-003 | done | `{"gate":"none","ok":true,"reason":"terminal"}` |
| QN-004 | done | `{"gate":"none","ok":true,"reason":"terminal"}` |
| QN-005 | done | `{"gate":"none","ok":true,"reason":"terminal"}` |
| QN-006 | done | (frontmatter confirmed `status: done`; not separately re-gated but consistent with others) |
| QN-007 | done | `{"gate":"none","ok":true,"reason":"terminal"}` |
| QN-002 | ready | `{"gate":"execute->done","ok":false,"acTotal":4,"acChecked":0,"reason":"0/4 AC checkboxes checked"}` (correctly reports not-done, as expected for a `ready`-only task) |

Nothing regressed. All previously-done tasks still gate clean; QN-002's gate
correctly reflects its honest `ready`/not-executed state (it is expected to
fail the execute→done gate since it has 0/4 AC checked — this is the correct
behavior, not a bug).

## New bugs found (minor, not blocking)

1. **Default `tasksDir` resolution is directory-relative and easy to
   mis-point.** `bin/quay-native.js`'s `resolveTasksDir()` defaults to
   `process.cwd()+"/tasks"` when `QUAY_NATIVE_TASKS_DIR` is unset. Since the
   actual QN-*.md task files live at the repo-root `tasks/` directory but the
   CLI package itself lives in `packages/quay-native/` (which has its own,
   separate, near-empty `tasks/` subdirectory containing only a stray
   `V-1.md`), running `quay-native task check QN-007` from
   `packages/quay-native/` without setting the env var silently reports
   `{"ok": false, "reason": "not found"}` rather than an explicit
   "wrong tasks directory, did you mean to set QUAY_NATIVE_TASKS_DIR?"-style
   diagnostic. This is a pre-existing usability rough edge (present before
   this iteration too, not introduced by QN-007/QN-002) but worth noting: a
   careless verifier could easily conclude a task's gate check is "failing"
   when in fact the gate is fine and only the tasks directory pointer was
   wrong. Low severity, not a correctness bug in any of the audited claims.
2. No other bugs found. `store.js`'s `extra` handling, both `task_write`
   value-equivalence blocks in `abi-symmetry.mjs`, and all other test files
   behaved exactly as documented.

## Overall verdict: **PASS**

- QN-007: PASS — the fix is real (schema now declares `extra`), verified
  live end-to-end with a nested-object value on a scratch task store across
  CLI and MCP surfaces in both write and read directions; the strengthened
  `abi-symmetry.mjs` test has genuine teeth, proven by an adversarial
  break/restore cycle (fails when the bug is reintroduced, passes when
  fixed); the task file's frontmatter/AC/DoD accurately reflect the real
  state; the mechanical gate agrees (`done`/terminal).
- QN-002: PASS — authored to `ready` with substantive, appropriately
  minimal (not gold-plated) content; AC checkboxes genuinely unchecked;
  zero evidence of any GitHub-provider code or `gh` invocation beyond
  prose authoring; this audit's own `gh auth status` check was read-only
  and non-mutating as instructed.
- Full regression: PASS — all 3 real standalone test files pass; the 4th
  file (`concurrent-writer.mjs`) is correctly a non-standalone helper, not
  a regression; QN-001/003/004/005/006/007 all remain `done` with clean
  gates; QN-002 correctly shows its honest not-yet-executed gate state.

No blocking issues found. One minor pre-existing usability rough edge noted
(default tasks-dir resolution) but it does not affect the correctness of any
audited claim.
