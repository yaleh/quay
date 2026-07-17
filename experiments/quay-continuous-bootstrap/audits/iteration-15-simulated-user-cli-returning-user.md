# Simulated User: Returning CLI user — Iteration 15

## Setup

Scratch root: `/tmp/quay-persona-a-iter15`

Created `.quay/config.yml` pointing to the iteration-15 worktree's `quay-native` provider
and `/tmp/quay-persona-a-iter15/tasks` as the tasks directory.

Created 4 test tasks manually as markdown files:
- `T-001`: "Fix login bug" (open, backend)
- `T-002`: "Add dark mode support" (open, frontend)
- `T-003`: "Update documentation" (done, docs)
- `T-004`: "Fix payment flow" (open, backend)

All commands run as:
```
cd /tmp/quay-persona-a-iter15 && node /home/yale/work/quay/experiments/quay-continuous-bootstrap/worktrees/iteration-15/packages/quay/bin/quay.js <args>
```

## Findings

### UQ-042: Grammar fix ("1 match" singular)

PASS — `quay task list --search "login"` returned exactly one result with the header:
```
# search: "login" (1 match)
```
Singular "match" is used correctly. Comparison confirmed plural works too:
- `--search "fix"` → `# search: "fix" (2 matches)`
- `--search "nonexistent_xyz_123"` → `# search: "nonexistent_xyz_123" (0 matches)`

### UQ-043: --format in synopsis

PASS — The synopsis line from `quay --help` (and `quay task list --help`) reads:
```
  quay task list [--status <status>] [--label <label>] [--prefix <prefix>] [--sort id|status|updated] [--search <query>] [--json | --format json]
```
Both `--json` and `--format json` appear in the synopsis. The Options section also
clarifies: `--json  Output as JSON (also: --format json)`.

### UQ-044: --format JSON case normalization

PASS — `quay task list --format JSON` (all uppercase) produced valid JSON output
identical to `--format json` and `--json`. No warning, no error. Mixed case (`--format
Json`) also works correctly. Only truly unrecognized values (e.g., `--format csv`)
produce a warning:
```
Warning: unknown --format value 'csv'; supported: json
```
After the warning, table output is returned unchanged (graceful fallback, no crash).

### UQ-045: Scripting example in --help

PASS — `quay task list --help` Examples section includes both a plain `--format json`
example and a `jq` pipeline example:
```
  quay task list --format json        Output all tasks as JSON (scripting-friendly)
  quay task list --format json | jq '.[] | .id'  Extract task IDs with jq
```

## New gaps

- **No `--version` flag**: `quay --version` exits with the generic usage error (exit 1).
  This is a minor discoverability gap — users expecting `quay --version` to print `0.1.0`
  will receive an unhelpful error. Not blocking, but commonly expected by CLI users.

- **`quay-native mcp:` prefix on stderr mixed with stdout**: The native provider prints
  `quay-native mcp: serving tasks from /path/...` to stderr on every command. While
  this goes to stderr, it can be confusing when piping JSON output and watching a terminal,
  as it appears interleaved. Pre-existing behavior, not introduced in iteration 15.

## Overall verdict

PASS — All four targeted regressions from iteration 13 are resolved: singular grammar
("1 match"), `--format json` in synopsis, uppercase `--format JSON` case normalization
producing valid JSON output, and `jq` scripting example in `--help`. No blocking new
gaps found.
