# M175 (DIR-114) — iteration 0

**Task:** DIR-114 — Add args-normalization defense to all checked-in dynamic workflow scripts.
**Charter:** `experiments/quay-perpetual-stream/charters/M175-dir114-args-normalization.md`
**Class:** development / instrument-correction (Δv̂ > 0, VT-neutral)

## Pre-flight

Set `extra.acceptance` on DIR-114 via `task_write`:
```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-114 experiments/quay-perpetual-stream/charters/M175-dir114-args-normalization.md /tmp/m175-absorb-entry.md
```

## Root cause (recap, verified against the task's own Finding)

The Workflow tool's runtime sometimes delivers the top-level `args` global to a dispatched
`.claude/workflows/*.js` script body as a JSON-**encoded string**, not the parsed object its own
contract promises "verbatim". Raw `args.field` access on a string yields `undefined`; chained
calls (`args.charterFile.match(...)`) throw `TypeError: Cannot read properties of undefined
(reading 'match')`. Session `80ae3423` observed this crash live in `execute-milestone.js` and
hand-patched a session-private ephemeral copy; it was never checked in.

## Implementation

### 1. Normalization line added to all 5 checked-in workflow scripts

Added, at the very top of each script (right after the `export const meta = {...}` block, before
any `args` use), the exact normalization form already verified working by session 80ae3423:

```js
const $a = (typeof args === 'string') ? JSON.parse(args) : args
```

Then every bare `args.xxx` reference in each script body was replaced with `$a.xxx` (the
normalization line itself is the one exception, since it must read the raw `args` to detect its
shape). Counts matched the Finding's own tally exactly:

| File | raw `args.` refs replaced |
|---|---|
| `.claude/workflows/execute-milestone.js` | 35 |
| `.claude/workflows/drain-directives.js` | 3 |
| `.claude/workflows/diagnose-verify-failure.js` | 4 |
| `.claude/workflows/run-routines.js` | 4 |
| `.claude/workflows/select-preflight.js` | 1 |

**AC evidence — `grep -n 'args\.' <file>` per file, post-fix (zero remaining raw references):**
```
=== .claude/workflows/execute-milestone.js ===
(zero remaining raw args. references)

=== .claude/workflows/drain-directives.js ===
(zero remaining raw args. references)

=== .claude/workflows/diagnose-verify-failure.js ===
(zero remaining raw args. references)

=== .claude/workflows/run-routines.js ===
(zero remaining raw args. references)

=== .claude/workflows/select-preflight.js ===
(zero remaining raw args. references)
```

`node --check` passes on all 5 files (valid syntax, CommonJS top-level-return-safe).

Diff review confirms the change is a pure mechanical `args.` → `$a.` substitution plus one new
normalization line per file — no judgment/phase-structure/schema changes (Done-when #3):
```
$ git diff --stat .claude/workflows/
 .claude/workflows/diagnose-verify-failure.js | 11 +++--
 .claude/workflows/drain-directives.js        | 11 +++--
 .claude/workflows/execute-milestone.js       | 69 +++++++++++++++-------------
 .claude/workflows/run-routines.js            |  7 ++-
 .claude/workflows/select-preflight.js        |  7 ++-
```

### 2. Single-source-of-truth follow-through: `plugin/workflows/` mirror

Discovered mid-build (per CLAUDE.md's drift-fixing discipline) that `.claude/workflows/` is not
the only checked-in copy: `plugin/sync.sh` mechanically mirrors 3 of the 5 files
(`execute-milestone.js`, `drain-directives.js`, `run-routines.js`) into `plugin/workflows/` for
Tier-3 plugin distribution (external workspaces installing the quay plugin get these files
verbatim and would hit the identical crash). Ran `bash plugin/sync.sh` to propagate the fix
through the existing, already-checked-in sync mechanism (no new sync logic invented — DIR-114
Requested-action #2's "single source" concern is satisfied by using the sync script that already
exists rather than hand-copying). Reverted the script's incidental unrelated re-sync of
`plugin/gate-scripts/*.sh` (pre-existing drift from `experiments/.../scripts/`, out of this
milestone's scope) via `git checkout -- plugin/gate-scripts/` so the commit stays scoped to
DIR-114.

`plugin/test/plugin-packaging.test.mjs`'s existing "git-tracked workflows in plugin/workflows/
are byte-identical to .claude/workflows/ canonical sources" test independently confirms the
mirror is in sync post-fix (see Test evidence below).

## Verification — args-normalization actually prevents the crash (AC #2 spirit)

DIR-114's AC #2 asks for a real, non-fixture `Workflow()` call proving both args-delivery shapes
(object vs JSON string) don't crash. This build session has no `Workflow` tool in its own toolset
(subagent sessions dispatch through MCP/Bash/task tools only — confirmed via `ToolSearch`), so a
literal `Workflow()` re-dispatch from inside this build step is not possible here. In its place,
built a harness that reproduces the Workflow runtime's exact args-delivery contract (a top-level
`args` global inside an `AsyncFunction`-wrapped script body, matching how `return`/`await`
statements at top level are legal) and drove **all 5 real, unmodified, checked-in files** through
both observed shapes, with `agent`/`parallel`/`phase`/`log` mocked (no real LLM/network calls):

```
$ node args-norm-harness.mjs   (post-fix, actual committed files)

=== .claude/workflows/execute-milestone.js ===
  [args=object] OK — returned: {"outcome":"done","taskId":"DIR-114","verifyCacheUpdates":{}}
  [args=JSON-string] OK — returned: {"outcome":"done","taskId":"DIR-114","verifyCacheUpdates":{}}

=== .claude/workflows/drain-directives.js ===
  [args=object] OK — returned: {"drained":0}
  [args=JSON-string] OK — returned: {"drained":0}

=== .claude/workflows/diagnose-verify-failure.js ===
  [args=object] OK — returned: {"autoFixed":[],"diagnoses":[],"retryReady":true}
  [args=JSON-string] OK — returned: {"autoFixed":[],"diagnoses":[],"retryReady":true}

=== .claude/workflows/run-routines.js ===
  [args=object] OK — returned: {...}
  [args=JSON-string] OK — returned: {...}

=== .claude/workflows/select-preflight.js ===
  [args=object] OK — returned: {...}
  [args=JSON-string] OK — returned: {...}

ALL PASS
```

**Harness is discriminating, not a rubber stamp** — re-ran it against the pre-fix (`git show
HEAD:...`) versions of all 5 files and it reproduced the exact real crash from the Finding on
`execute-milestone.js` under the JSON-string shape:
```
=== prefix/execute-milestone.js ===
  [args=object] OK — returned: {"outcome":"done","taskId":"DIR-114","verifyCacheUpdates":{}}
  [args=JSON-string] CRASHED — TypeError: Cannot read properties of undefined (reading 'match')
```
(pre-fix run for the other 4 files completed without crashing under this harness's limited mock
coverage — consistent with the Finding's own observation that plain `args.field` access silently
yields `undefined` rather than throwing; only `execute-milestone.js`'s `.charterFile.match(...)`
chain crashes on first touch. Post-fix, all 5 are clean under both shapes.)

This is a **repo-side execution-semantics simulation of the real crash site**, not a literal
`Workflow()` tool call — that requires the outer-loop orchestration layer (which does have the
`Workflow` tool) and is the natural next real-world exercise of these scripts (the very next
`execute-milestone`/`drain-directives`/etc. dispatch after this commit lands is itself a live
proof, tracked by the DoD's "Human verification when exp5 marks this DIR done" checklist item 2).
Harness script and pre-fix snapshot copies are scratch artifacts (not committed — this repo has no
narrow home for a workflow-runtime simulation harness yet; if this class of fix recurs, it may be
worth promoting to a checked-in test).

## Test evidence

- `node --check` on all 5 `.claude/workflows/*.js` and 3 `plugin/workflows/*.js` files: all pass.
- `bash scripts/test.sh plugin/test/plugin-packaging.test.mjs`: 30/30 pass, including "git-tracked
  workflows in plugin/workflows/ are byte-identical to .claude/workflows/ canonical sources".
- Full suite: `bash scripts/test.sh` (313s) — `tests 517, suites 4, pass 514, fail 0, cancelled 0,
  skipped 3, todo 0`. The 3 skipped are the live-GitHub conformance tests
  (`serve-github.test.mjs`, `provider-abi-conformance.test.mjs`,
  `cli-edit-parity-conformance.test.mjs`), which self-skip without
  `QUAY_TEST_LIVE_GITHUB=1`/`GH_TOKEN` per ADR-019 — expected, not a regression. Zero failures
  attributable to this change.

## Files touched

- `.claude/workflows/execute-milestone.js`
- `.claude/workflows/drain-directives.js`
- `.claude/workflows/diagnose-verify-failure.js`
- `.claude/workflows/run-routines.js`
- `.claude/workflows/select-preflight.js`
- `plugin/workflows/execute-milestone.js` (re-synced via `plugin/sync.sh`)
- `plugin/workflows/drain-directives.js` (re-synced via `plugin/sync.sh`)
- `plugin/workflows/run-routines.js` (re-synced via `plugin/sync.sh`)

No changes to any script's judgment logic, phase structure, or schema — pure `args.` → `$a.`
substitution plus one new normalization line per file (Done-when #3).
