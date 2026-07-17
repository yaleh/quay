# Simulated-User Report — Iteration 13
# Persona: CLI Power User (scripting/automation)

**Overall verdict**: PASS

---

## QX-048 verification (--format json fix)

### Commands run and outputs observed

**Baseline: `--json` still works**
```
node worktrees/iteration-13/.../quay.js task list --json 2>/dev/null | head -3
[
  {
    "id": "DIR-004",
```
PASS — baseline unaffected.

**Core fix: `--format json` now produces valid JSON**
```
node worktrees/iteration-13/.../quay.js task list --format json 2>/dev/null | head -3
[
  {
    "id": "DIR-004",
```
PASS — was broken (silently fell through to human-readable table), now emits JSON array.

**jq-style pipeline**
```
node .../quay.js task list --format json 2>/dev/null \
  | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).length+' tasks')"
147 tasks
```
PASS — round-trips cleanly through a JSON parser.

**`--prefix` + `--format json`**
```
node .../quay.js task list --prefix QX --format json 2>/dev/null | head -5
[
  {
    "id": "QX-001",
    "title": "Add cross-experiment task filtering to CLI and Web UI",
    "status": "todo",
```
PASS — prefix filter respected, output is valid JSON.

**`--format json` vs `--json` produce identical output**
```bash
out1=$(quay.js task check QX-049 --json 2>/dev/null)
out2=$(quay.js task check QX-049 --format json 2>/dev/null)
[ "$out1" = "$out2" ] && echo "IDENTICAL" || echo "DIFFER"
# → IDENTICAL
```
PASS — the alias produces byte-for-byte identical output.

**All subcommands with `--format json`**
| Subcommand | Result |
|---|---|
| `task list --format json` | valid JSON array |
| `task view QX-048 --format json` | valid JSON object, id+status correct |
| `task edit QX-048 --status done --format json` | valid JSON object, status reflects update |
| `task check QX-048 --format json` | valid JSON object |
| `action list QX-001 --format json` | valid JSON array |

All PASS.

**Empty result set**
```
node .../quay.js task list --prefix ZZNONEXISTENT --format json 2>/dev/null
→ [] (valid empty JSON array)
```
PASS — no crash, no human-readable fallback.

**JSON boundaries clean (no preamble/postamble text on stdout)**
```
First char: '[' (expected '[')
Last char:  ']' (expected ']')
```
PASS — stdout is uncontaminated. The one line on stderr (`quay-native mcp: serving tasks from ...`) is routed correctly and is suppressible with `2>/dev/null`.

**Combined filter + alias: `--prefix QX --status done --format json`**
```
→ 48 results, nonQX=0, nonDone=0
```
PASS — all filters compose correctly with the alias.

**JSON schema: top-level keys in list items**
```
body, children, extra, id, labels, parent, role, status, title, updatedAt
```
Stable, machine-parseable fields. Sufficient for scripting automation.

---

## General CLI surface scan

### `--search` + `--format json`
```
node .../quay.js task list --search "pageNav" --format json 2>/dev/null
→ valid JSON, 2 results
```
PASS.

### `--status todo --json`
```
node .../quay.js task list --status todo --json 2>/dev/null
→ 4 todo tasks, 0 non-todo. PASS.
```

### `--label X --format json`
```
node .../quay.js task list --label bug --format json 2>/dev/null
→ VALID JSON, 10 results. PASS.
```

### `--sort` + `--format json`
```
node .../quay.js task list --prefix QX --sort updated --format json 2>/dev/null
→ VALID JSON, 49 tasks, first=QX-048 (most recently updated), last=QX-002. PASS.
```

### `--help` documentation gap
The `--help` output lists `--json` but does NOT mention `--format json`. From a power user's perspective this is a documentation gap: `--format json` is a now-supported alias but appears nowhere in the usage string or options list. Users who reach for `--format json` (a natural pattern borrowed from many CLIs: `jq`, `gh`, `kubectl`) will only discover it works by accident or by reading source code.

```
Options for task list:
  ...
  --json              Output as JSON     ← only --json documented; --format json not mentioned
```

### `--format <unsupported-value>` silently falls through
```
node .../quay.js task list --format table 2>/dev/null
→ (human-readable table — no error, no warning)
```
Minor concern: a scripter who misspells `json` (e.g., `--format JSON` or `--format csv`) gets human-readable output silently instead of an error. This makes scripting bugs harder to catch. No stderr warning is emitted. The source comment acknowledges "unknown format values are left for the caller to handle" — but from the script writer's perspective, silent fallthrough is a footgun.

### stdout/stderr separation
`quay-native mcp: serving tasks from ...` goes to stderr, not stdout. `2>/dev/null` suppresses it cleanly. This is correct behavior and the persona's natural reflex (`2>/dev/null`) handles it.

---

## New gaps found

**GAP-A (provisional)**
- **Dimension**: usability_quality / documentation
- **Description**: `--format json` is now a valid alias for `--json` but is not mentioned in `--help` output, usage strings, or options documentation. A power user scanning `--help` before writing a script will not discover this alias exists. The usage line reads `[--json]` only.
- **Severity**: minor
- **Source**: simulated-user (CLI power user, iteration 13)
- **Suggested fix**: Add `--format <format>` to the usage string and options list (e.g., `--format json    Output as JSON (alias for --json)`), or add a parenthetical to the existing `--json` line: `--json              Output as JSON (also: --format json)`.

**GAP-B (provisional)**
- **Dimension**: usability_quality / error feedback
- **Description**: `--format <unsupported-value>` silently falls through to human-readable output with no warning. A script that uses `--format JSON` (wrong case) or `--format csv` (unsupported) gets tab-separated human text on stdout and exit code 0, making the bug invisible until the JSON parse step fails downstream. The fix is a simple stderr warning or non-zero exit when `flags.format` is set to a value other than `"json"`.
- **Severity**: minor
- **Source**: simulated-user (CLI power user, iteration 13)

---

## Summary

QX-048 (`--format json` alias) is **fully verified**. All tested subcommands (`task list`, `task view`, `task edit`, `task check`, `action list`) correctly emit valid JSON when `--format json` is passed. Filters compose correctly with the alias. Output is byte-for-byte identical to `--json`. No stdout contamination. Empty result sets return `[]` cleanly.

Two new minor gaps surfaced during the surface scan:
1. **GAP-A**: `--format json` undocumented in `--help` — a scripter cannot discover the alias from the help text.
2. **GAP-B**: `--format <unknown>` silently falls through — a scripter who misspells `json` gets human-readable output with exit code 0, making the error invisible at the flag-parse layer.

Neither gap is blocking or significant. The persona verdict is **PASS** with two minor findings to log.
