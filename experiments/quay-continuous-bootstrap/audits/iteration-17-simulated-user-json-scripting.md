# Simulated User: JSON scripting user — Iteration 17

## Setup

Workspace: `/tmp/quay-persona-a-iter17`
CLI: `node /home/yale/work/quay/experiments/quay-continuous-bootstrap/worktrees/iteration-17/packages/quay/bin/quay.js`

Created 18 test tasks (`PT-001` through `PT-018`) directly as markdown files in the test tasks directory. Config set up with the native provider pointing at the worktree's `quay-native` package.

```
# Create test workspace
mkdir -p /tmp/quay-persona-a-iter17/.quay /tmp/quay-persona-a-iter17/tasks

# Write .quay/config.yml (native provider, absolute path)
# Create 18 task markdown files (PT-001 … PT-018, status: open, label: test)

# Verify baseline
cd /tmp/quay-persona-a-iter17
node .../quay.js task list   # → 18 tasks
```

## Findings

### CB-022: --page-size in JSON mode

PASS — returns exactly 5 tasks.

```
$ quay task list --page-size 5 --json
[
  { "id": "PT-001", ... },
  { "id": "PT-002", ... },
  { "id": "PT-003", ... },
  { "id": "PT-004", ... },
  { "id": "PT-005", ... }
]
count: 5
```

Previously (iteration 16), `--page-size 5 --json` returned all 18 tasks. The fix in iteration 17 applies `displayTasks = sorted.slice(0, pageSize)` before the JSON branch, so `--json` and non-JSON paths both honour the page-size limit.

Also verified with `--page-size 10 --json` → 10 tasks.

### --format json + --page-size

PASS — returns exactly 3 tasks.

```
$ quay task list --page-size 3 --format json
count: 3
IDs: ['PT-001', 'PT-002', 'PT-003']
```

`--format json` is aliased to `flags.json = true` (fix from iteration 13, CB-021), so it follows the same code path as `--json`. The page-size fix applies equally.

### Table mode regression

PASS — `--page-size 7` returns exactly 7 rows in table mode plus the footer hint.

```
$ quay task list --page-size 7
PT-001  open  primitive  Pagination test task 1 …  5s ago
PT-002  open  primitive  Pagination test task 2 …  5s ago
…
PT-007  open  primitive  Pagination test task 7 …  5s ago
# showing 7 of 18 tasks (use --page-size to adjust)
```

Row count (excluding `#` comment lines): 7. No regression.

### UQ-048: invalid --page-size

PASS — all invalid values warn to stderr and fall back to all results; exit code 0.

| Input          | Stderr warning                                                          | Stdout tasks | Exit code |
|----------------|-------------------------------------------------------------------------|--------------|-----------|
| `--page-size 0`  | `Warning: invalid --page-size value '0'; using default (all results)`  | 18           | 0         |
| `--page-size abc`| `Warning: invalid --page-size value 'abc'; using default (all results)`| 18           | 0         |
| `--page-size -1` | `Warning: invalid --page-size value '-1'; using default (all results)` | 18           | 0         |
| `--page-size 1001`| `Warning: invalid --page-size value '1001'; using default (all results)`| 18          | 0         |

Validation guards: `!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000`. Warning written to stderr; stdout is clean for scripting.

## New gaps

None detected. All four areas tested pass cleanly.

Minor observation (not a gap): the `# showing N of M tasks` footer line only appears in table mode, not in JSON mode. This is the correct design for JSON scripting (consumers read array length from the JSON itself), so no action needed.

## Overall verdict

PASS

CB-022 is fixed: `--page-size` now correctly limits results in both `--json` and `--format json` modes. Table mode is unaffected. UQ-048 invalid-value validation behaves as specified (stderr warning, fallback to all results, exit 0).
