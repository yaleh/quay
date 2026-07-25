# M139 Iteration-0 Acceptance Audit — DIR-070-C (Tier B gates parameterization)

**Audit date:** 2026-07-25
**Task:** DIR-070-C
**Charter:** experiments/quay-perpetual-stream/charters/M139-dir070c-tierb-gates.md
**Implementation commit:** 3fe2f9a (merged to master)
**Audit verdict: REFUTED**

## AC Satisfaction

### AC #1: All 5 gates accept parameterized CLI flags for their experiment-specific defaults

**CONFIRMED.** Each of the 5 Tier B gate scripts has the specified CLI flag:

| Gate | Flag | Evidence |
|---|---|---|
| `audit-independence-check.ts` | `--orchestrator-env <name>` | Line 213: `if (args[i] === "--orchestrator-env")` |
| `vmeta-lag-check.ts` | `--threshold <K>` | Line 220: `if (args[i] === "--threshold")` |
| `it0-split-or-commit-check.ts` | `--tasks-dir <dir>` | Line 315: `if (args[i] === "--tasks-dir")` |
| `it0-enforcement-with-design-check.ts` | `--root <dir>` (existing) | Line 314: `if (args[i] === "--root")` |
| `it0-impl-row-check.sh` | `--backlog <file>` | Line 46: `--backlog) BACKLOG_FILE="$2"` |

### AC #2: Default values maintain backward compatibility with current experiment

**REFUTED.** The parameterization of `it0-impl-row-check.sh` broke the positional second-argument interface that `it0-dod-check.ts` (the mechanical DoD enforcer) relies on.

**Evidence:**

Pre-parameterization (commit `3fe2f9a^`), the script used simple positional args:
```bash
MILESTONE_ID="$1"
BACKLOG_FILE="${2:-backlog.md}"
```

Post-parameterization (commit `3fe2f9a`), the while-loop arg parser treats ALL non-flag arguments as `MILESTONE_ID`, overwriting the first with the second:
```bash
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backlog) BACKLOG_FILE="$2"; shift 2 ;;
    --backlog=*) BACKLOG_FILE="${1#*=}"; shift 1 ;;
    --*) echo "ERROR: unknown flag: $1" >&2; exit 2 ;;
    -*) MILESTONE_ID="$1"; shift ;;
    *) MILESTONE_ID="$1"; shift ;;  # <-- second positional OVERWRITES first
  esac
done
```

`it0-dod-check.ts` line 304 calls the script with 2 positional args:
```ts
execFileSync(scriptPath, [milestoneId, tmpBacklog], { encoding: "utf8" });
```

This call now fails because `$2` (tmpBacklog path) overwrites `$1` (milestoneId) as `MILESTONE_ID`, and `BACKLOG_FILE` stays at its default `"backlog.md"`, which does not exist in the working directory.

**Reproduction:**
```
$ bash experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh M139 /tmp/test-backlog.md
ERROR: backlog file not found: backlog.md
[exit 2]
```

The `--backlog` named-flag interface does work:
```
$ bash experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh --backlog /tmp/test-backlog.md M139
PASS: M139 is not design-only ... [exit 0]
```

But `it0-dod-check.ts` was NOT updated to use the `--backlog` flag — it still uses the broken positional interface. This is a regression.

**The other 4 gates** maintain backward compatibility: their parameterization adds optional flags without changing existing positional argument handling.

### AC #3: All 5 gates + `.sh` wrappers in `plugin/scripts/`

**CONFIRMED.** All 9 files present in `plugin/scripts/`:
- `audit-independence-check.ts` + `audit-independence-check.sh`
- `vmeta-lag-check.ts` + `vmeta-lag-check.sh`
- `it0-split-or-commit-check.ts` + `it0-split-or-commit-check.sh`
- `it0-enforcement-with-design-check.ts` + `it0-enforcement-with-design-check.sh`
- `it0-impl-row-check.sh` (standalone .sh, no .ts counterpart)

All `.sh` wrappers are executable. All plugin copies have zero experiment-path references (verified via grep for `experiments/quay-perpetual-stream` and `exp5` patterns — 0 hits across all 9 files).

### AC #4: `.quay/config.yml` gate paths updated

**CONFIRMED.** All 5 Tier B gate paths updated to `plugin/scripts/`:

| Gate section | Gate name | Updated path |
|---|---|---|
| `gates.it0` | `impl-row` | `./plugin/scripts/it0-impl-row-check.sh` |
| `gates.it0` | `vmeta-lag` | `./plugin/scripts/vmeta-lag-check.sh` |
| `gates.it0` | `audit-independence` | `./plugin/scripts/audit-independence-check.sh` |
| `gates.testPass` | `split-or-commit` | `node plugin/scripts/it0-split-or-commit-check.ts .` |
| `gates.testPass` | `enforcement-with-design` | `node plugin/scripts/it0-enforcement-with-design-check.ts .` |

Non-Tier-B gates (`line-budget`, `dogfood-evidence`) correctly left pointing to experiment scripts.

### AC #5: `plugin-packaging.test.mjs` passes (no experiment leakage)

**CONFIRMED.** All 29/29 tests pass, including 5 new DIR-070-C-specific tests:
- `DIR-070-C: all 9 new gate scripts + wrappers present in plugin/scripts/`
- `DIR-070-C: all .sh wrappers are executable`
- `DIR-070-C: .sh wrappers runnable (exit 2 for missing args, not ENOTFOUND)`
- `DIR-070-C: Tier-B gates registered in .quay/config.yml`
- `DIR-070-C: Tier-B plugin copies have zero exp5/experiment-path references`

### AC #6: External workspace can run `quay gate --gate <name>` with custom paths

**CONFIRMED** (with caveat for `it0-impl-row-check.sh`). All 5 gates accept parameterized flags. An external workspace can configure these gates in their `.quay/config.yml` with custom `argsKey` arrays (e.g. `implRowArgs: ["--backlog", "./my-backlog.md", "MY-MILESTONE"]`). The gates resolve via `quay gate --gate <name>` as confirmed by plugin-packaging test "DIR-070-B: all 5 gates runnable via quay gate --gate <name>". The caveat is that `it0-impl-row-check.sh` requires the `--backlog` named flag; the old positional `[backlog-file]` interface is broken (see AC #2).

## DoD Satisfaction

### Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 1 Tier B

**CONFIRMED.** The task body references the document in its Plan section. The implementation matches the Gap 1 Tier B specification: 5 gates with minor experiment coupling, fixable with CLI flags.

### 5 gates parameterized with CLI flags

**CONFIRMED** (see AC #1).

### 5 gates + wrappers in `plugin/scripts/`

**CONFIRMED** (see AC #3).

### `.quay/config.yml` updated

**CONFIRMED** (see AC #4).

### Plugin packaging test passes

**CONFIRMED.** 29/29 pass (see AC #5).

### Depends on DIR-070-B (Tier A gates must be in plugin/ first)

**CONFIRMED.** DIR-070-B completed at M137 (commit 09271a9, merged to master, task promoted to done, `verified-eliminated` deviation status). All Tier A gates are present in `plugin/scripts/` before Tier B was attempted.

## Mechanical Gate

**REFUTED.** `it0-dod-check.sh` exits with code 2 (usage/environment error), not 0 (PASS):

```
ERROR: backlog file not found: backlog.md
ERROR: it0-impl-row-check.sh usage/environment error (exit 2): ERROR: backlog file not found: backlog.md
EXIT_CODE=2
```

Root cause: the broken backward compatibility in `it0-impl-row-check.sh` (see AC #2) prevents `it0-dod-check.ts` from executing its Clause 4 (impl-row) check. The gate errors out before it can evaluate any other clauses.

Note: this is an **error** (exit 2), not a **failure** (exit 1). The mechanical enforcer cannot complete its evaluation because its dependency on `it0-impl-row-check.sh`'s positional interface is broken. This is a different class of finding than a clause violation — the instrument itself is broken.

## Additional findings

### Finding: Task lifecycle status is `todo` despite merged implementation

The task file `tasks/DIR-070-C.md` frontmatter and the quay task store both report `status: todo`. The implementation was merged to master in commit `3fe2f9a`, but the task lifecycle was never completed (no todo→ready→done promotion). This would be a DoD Clause 8 violation (task canonical-lifecycle-record) if the gate were operational.

### Finding: it0-impl-row-check.sh arg-parsing regression

The `--backlog` flag parameterization replaced simple positional arg handling (`MILESTONE_ID="$1"; BACKLOG_FILE="${2:-backlog.md}"`) with a while-loop parser that only recognizes `--backlog` as a named flag and treats every other argument as `MILESTONE_ID`. The old positional second-argument interface is lost, breaking the one caller that relied on it: `it0-dod-check.ts`.

The fix is a 3-line addition to the while-loop: handle the case where `MILESTONE_ID` is already set and `$1` is not a flag — treat it as `BACKLOG_FILE`:
```bash
    *) if [ -z "$MILESTONE_ID" ]; then MILESTONE_ID="$1"; else BACKLOG_FILE="$1"; fi; shift ;;
```

## Verdict

**REFUTED** — AC #2 (backward compatibility) is objectively broken for `it0-impl-row-check.sh`, causing the mechanical DoD gate (`it0-dod-check.sh`) to error out instead of evaluating the task. The other 4 gates are correctly parameterized with backward-compatible defaults. The task lifecycle remains incomplete (`status: todo`).
