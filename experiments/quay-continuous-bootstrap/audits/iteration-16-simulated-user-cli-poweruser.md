# Simulated User: CLI power user — Iteration 16

## Setup

Worktree: `/home/yale/work/quay/experiments/quay-continuous-bootstrap/worktrees/iteration-16`
CLI binary: `packages/quay/bin/quay.js`
Run prefix: `cd <worktree> && node packages/quay/bin/quay.js <args>`

The worktree already contains 157 tasks in `./tasks/`, which is sufficient for
pagination testing. The `--root` flag mentioned in the test spec does not exist
in the CLI — `loadConfig()` searches from `process.cwd()` upward for
`.quay/config.yml`. Tests were run from the worktree root, which finds the
worktree's own `.quay/config.yml` correctly.

---

## Findings

### --version flag

**PASS**

```
$ node packages/quay/bin/quay.js --version
quay 0.2.0
EXIT: 0

$ node packages/quay/bin/quay.js -V
quay 0.2.0
EXIT: 0
```

Both `--version` and `-V` print `quay 0.2.0` and exit 0. The version is read
from `package.json` via `createRequire(import.meta.url)` — works correctly
regardless of cwd.

---

### --page-size basic behavior

**PASS** (with one minor note on stderr noise)

Every command below produces a one-line `quay-native mcp: serving tasks from ...`
banner on stderr. This is expected (provider startup log), not a bug.

**task list (no --page-size) — shows all 157 tasks:**
```
$ node packages/quay/bin/quay.js task list | wc -l
158    # 157 task lines + 1 stderr line (counted together here)
```
No truncation notice. Correct — help text says default is "all".

**task list --page-size 5 — shows 5 tasks:**
```
$ node packages/quay/bin/quay.js task list --page-size 5
DIR-004   done   primitive   DIR-004: ...   30m ago
DIR-005   ready  primitive   DIR-005: ...   30m ago
PC-PARENT todo   primitive   Parent task    30m ago
QC-001    done   primitive   ...            30m ago
QC-002    done   primitive   ...            30m ago
# showing 5 of 157 tasks (use --page-size to adjust)
EXIT: 0
```
Exactly 5 task rows, plus a "showing N of M" footer. PASS.

**task list --page-size 10 — shows 10 tasks:**
```
# showing 10 of 157 tasks (use --page-size to adjust)
EXIT: 0
```
Exactly 10 task rows. PASS.

**task list --page-size 100 — shows 100 tasks:**
```
# showing 100 of 157 tasks (use --page-size to adjust)
EXIT: 0
```
Exactly 100 task rows. PASS.

**task list --page-size 200 — shows all 157 tasks (no footer):**
When page-size exceeds total count, no truncation footer is shown. 158 output
lines (157 tasks + 1 header from stderr). PASS — correct "show all" semantics
when page-size is larger than the total.

---

### --format json + --page-size

**FAIL** — two issues:

**Issue 1: `--format json` is not a valid flag.** The CLI uses `--json` (boolean),
not `--format json`. Passing `--format json` silently sets `flags.format = "json"`
and `--json` is not set, so the output is table format, not JSON. No error is
raised. The prompt template says `--format json` but the CLI contract says `--json`.

**Issue 2: `--json` ignores `--page-size` (bug CB-NEW-001).**
```
$ node packages/quay/bin/quay.js task list --page-size 5 --json 2>/dev/null | python3 -c \
  "import json,sys; a=json.loads(sys.stdin.read()); print('items:', len(a))"
items: 157
```
When `--json` is used, the CLI prints `sorted` (the full result) instead of
`displayTasks` (the paginated slice). Source: `quay.js` line 268:
`if (flags.json) { printJson(sorted); }` — `sorted` is the full list;
`displayTasks` is the paginated slice computed on line 267.

A script piping `quay task list --page-size 5 --json` to a JSON consumer
will receive all 157 items, not 5. This breaks CLI pipeline composability.

---

### Edge cases

**--page-size 0 — silently falls back to "show all":**
```
$ node packages/quay/bin/quay.js task list --page-size 0 | wc -l
158   # all 157 tasks, no error, EXIT: 0
```
Source: `pageSizeValid = pageSize > 0`, so `0` is invalid → `displayTasks = sorted`.
No error message is printed. A user who accidentally passes `--page-size 0`
gets all results with no warning. Minor UX gap (gap NEW-002).

**--page-size -1 — silently falls back to "show all":**
```
$ node packages/quay/bin/quay.js task list --page-size -1 | wc -l
158   # all 157 tasks, no error, EXIT: 0
```
Same fallback path as `--page-size 0`. No error. Minor UX gap (same NEW-002).

**--page-size abc — silently falls back to "show all":**
```
$ node packages/quay/bin/quay.js task list --page-size abc | wc -l
158   # all 157 tasks, no error, EXIT: 0
```
`parseInt("abc", 10)` → `NaN`; `Number.isFinite(NaN)` → false → invalid →
`displayTasks = sorted`. No error message. Same silent fallback. Minor UX gap
(same NEW-002, applies to all invalid --page-size values).

---

## New gaps

1. **CB-NEW-001 (significant): `--json` output ignores `--page-size`.**
   `printJson(sorted)` should be `printJson(displayTasks)` when `pageSizeValid`
   and `pageSize !== null`. Pipeline consumers passing `--json` cannot page
   results. Fix: one-line change in `quay.js` line 268.

2. **NEW-002 (minor): Invalid `--page-size` values fall back silently.**
   `--page-size 0`, `--page-size -1`, and `--page-size abc` all produce full
   output with no warning or error. A user who misspells or passes a bad value
   gets unexpected (all) results silently. Expected: print an error like
   `Error: --page-size requires a positive integer` and exit 1 (matching the
   existing pattern for `--prefix` and `--label` validation).

3. **NEW-003 (minor): `--format json` is accepted but silently ignored.**
   The flag `--format json` does not exist in the CLI; only `--json` is
   documented and implemented. `--format json` quietly sets an unused flag
   and produces table output — no error, no hint. Users coming from other
   CLIs that use `--format json` (e.g., gh, kubectl) will be confused.
   Could add an alias or a clear error: `Error: use --json instead of --format json`.

4. **NEW-004 (cosmetic): `quay-native mcp: serving tasks from ...` appears on stderr
   for every CLI invocation.** In a shell pipeline (`quay task list --json | jq ...`),
   this stderr line is harmless, but in scripts that capture stderr for logging or
   redirect both streams, it is noise. This is emitted by the provider subprocess
   unconditionally — no `--quiet` flag exists. Not blocking but worth noting.

---

## Overall verdict

**PARTIAL**

- `--version` / `-V`: PASS — clean output, correct exit code.
- `--page-size` table output: PASS — correct row counts, informative footer.
- `--json` + `--page-size`: FAIL — `--json` returns the full unsliced set regardless of `--page-size` (CB-NEW-001 — significant).
- Edge cases (0, -1, abc): Silent fallback to all-results with no error or warning (NEW-002 — minor).
- `--format json`: Not a valid flag — silently ignored (NEW-003 — minor).

The core pagination feature works for table output. The JSON pipeline use case
(most important for power users composing shell pipelines) is broken.
