# Simulated User: First-time CLI contributor — Iteration 14

## Persona
First-time CLI contributor, developer who just cloned the repo, unfamiliar with quay. Reads `--help` first, then tries features in order. Cares about discoverability, documentation clarity, and predictable behavior.

## Test Environment

```
# Set up test root
mkdir -p /tmp/quay-persona-a-iter14/.quay /tmp/quay-persona-a-iter14/tasks
cp -r /home/yale/work/quay/experiments/quay-continuous-bootstrap/worktrees/iteration-14/packages/quay-native \
    /tmp/quay-persona-a-iter14/packages/
cd /tmp/quay-persona-a-iter14/packages/quay-native && npm install

# Config
cat > /tmp/quay-persona-a-iter14/.quay/config.yml <<EOF
providers:
  native:
    enabled: true
    path: "./packages/quay-native"
    tasks_dir: "./tasks"
    mcp_entry: ["node", "./bin/quay-native.js", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "./tasks"
EOF

# Created 3 test tasks as markdown files:
#   PA-001: "Add user authentication module" (labels: backend, security)
#   PA-002: "Write unit tests for auth" (labels: testing, backend)
#   PA-003: "Deploy quay-persona-unique-singulartest to staging" (labels: devops)

# CLI invoked as:
node /home/yale/work/quay/experiments/quay-continuous-bootstrap/worktrees/iteration-14/packages/quay/bin/quay.js <args>
# (run from /tmp/quay-persona-a-iter14)
```

## Findings

### QX-053: --format documentation in --help
**PARTIAL** — `--format json` is documented in the Options section but absent from the usage synopsis.

Exact `--help` output:

```
quay — task management for AI-assisted development

Usage:
  quay task list [--status <status>] [--label <label>] [--prefix <prefix>] [--sort id|status|updated] [--search <query>] [--json]
  ...

Options for task list:
  --status <status>   Filter by status (todo, ready, done, needs-human)
  --label <label>     Filter by label (repeatable: --label A --label B for AND-filter)
  --prefix <prefix>   Filter by task id prefix (e.g. QX for QX-* tasks)
  --sort id|status|updated  Sort by id, status, or last-updated time (default: insertion order)
  --search <query>    Filter by title/body content (case-insensitive)
  --json              Output as JSON (also: --format json)

Examples:
  quay task list --prefix QX          List only QX-* tasks
  ...
```

Assessment: The `--json` option line now mentions `(also: --format json)`, which is a meaningful improvement for discoverability. However:

1. The usage synopsis line still shows only `[--json]`, not `[--json | --format json]`. A first-timer who reads only the synopsis (common) will not see `--format` at all.
2. There is no explanation of *why* two aliases exist or which is preferred. The parenthetical `(also: --format json)` is terse — it documents existence but not intent (e.g., "preferred for scripting").
3. `--format` is not shown anywhere in the Examples section, so scripting users have no copy-paste starting point.

Functional verification: `--format json` produces valid, well-structured JSON (array of task objects with all fields including `id`, `title`, `status`, `labels`, `body`, `updatedAt`). Output is machine-parseable and useful for scripting.

```bash
$ quay task list --format json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); JSON.parse(d); console.log('Valid JSON, items:', JSON.parse(d).length)"
Valid JSON, items: 3
```

The JSON output itself is PASS. The documentation is functional but incomplete for a first-timer.

### QX-054: Unknown --format warning
**PASS** — Warning is emitted to stderr, command exits 0, and table output appears on stdout unaffected.

Exact stderr (for `--format csv`):
```
Warning: unknown --format value 'csv'; supported: json
quay-native mcp: serving tasks from /tmp/quay-persona-a-iter14/tasks
```

Exact stdout (for `--format csv`):
```
PA-001	todo	primitive	Add user authentication module	24s ago
PA-002	ready	primitive	Write unit tests for auth	24s ago
PA-003	todo	primitive	Deploy quay-persona-unique-singulartest to staging	24s ago
```

Exit code: `0`

The warning message is clear and actionable: it names the bad value, lists what is supported. The command gracefully degrades to table output rather than failing hard. Behavior is correct.

Additional edge case tested — `--format JSON` (uppercase):
```
Warning: unknown --format value 'JSON'; supported: json
```
The comparison is case-sensitive. `--format JSON` is treated as unknown and triggers the warning, rather than being normalized to lowercase. This is a minor gap — a reasonable first-timer might type `--format JSON` expecting it to work. The warning message already tells them the correct casing (`supported: json`), so the UX impact is low but it is a rough edge.

### QX-051: Grammar fix (singular "result")
**PASS** — This fix applies to `serve.js` (web UI), not the CLI. Tested via `quay serve` at port 3099.

Web UI search banner with 1 match (`?q=quay-persona-unique-singulartest`):
```html
<p class="meta" style="color:#0066cc">Showing 1 result for &ldquo;quay-persona-unique-singulartest&rdquo;</p>
```

Web UI search banner with 2 matches (`?q=auth`):
```html
<p class="meta" style="color:#0066cc">Showing 2 results for &ldquo;auth&rdquo;</p>
```

Singular "result" is correctly used when `totalTasks === 1`, and "results" is used for all other counts. Grammar fix is confirmed working.

Note: The CLI's own search header uses a different format (`# search: "query" (1 matches)`) which uses "matches" unconditionally and does not have a singular/plural issue with "result". The CLI's wording is grammatically awkward for 1 match (`(1 matches)` is incorrect English), but that is pre-existing and outside the scope of QX-051.

### QX-052: Filter-zero state
**PASS** — Both surfaces show appropriate messaging.

Web UI (via `quay serve`), label filter with no matches (`?label=nonexistent`):
```html
<tr><td colspan="7" style="text-align:center;color:#666;padding:1rem">No tasks found.</td></tr>
```

CLI, label filter with no matches (`--label nonexistent`):
```
No tasks found.
```

CLI, search with no matches (`--search xyznotexist12345`):
```
# search: "xyznotexist12345" (0 matches)
Hint: use --label to filter by label, or --search to match title/body content.
```

Both surfaces handle zero-result filter states with explicit messaging rather than silent empty output.

## New gaps found

1. **UX gap: `(1 matches)` grammar in CLI search header** — The CLI prints `# search: "query" (1 matches)` when exactly 1 task matches a search. "1 matches" is grammatically incorrect English (should be "1 match"). This is distinct from QX-051 (which fixed "1 results" in the web UI). The CLI has its own parallel grammar bug. Suggested fix: `${sorted.length} ${sorted.length === 1 ? "match" : "matches"}`.

2. **Discoverability gap: `--format` absent from usage synopsis** — The usage line reads `[--json]` only. First-timers who scan the synopsis before reading Options will not see `--format` exists. Consider updating the synopsis to `[--json | --format json]` or just noting `[--format <fmt>]`.

3. **Case sensitivity of `--format` value** — `--format JSON` (uppercase) triggers the unknown-format warning instead of being normalized. Low severity since the warning message gives the correct form, but worth noting for a first-timer who types common uppercase conventions.

4. **No scripting example for `--format json`** — The Examples section has no entry showing `--format json` in use (e.g., `quay task list --format json | jq '.[] | .id'`). The Options line documents the flag but gives no hint of typical usage patterns.

5. **MCP server startup message on stderr during normal CLI use** — Every invocation emits `quay-native mcp: serving tasks from /tmp/.../tasks` to stderr. For a first-timer, this is confusing noise on stderr that looks like a warning or diagnostic. It mixes with the actual warning in QX-054, making stderr harder to parse programmatically. Scripts using `2>/dev/null` lose both the real warning and the informational server message equally.

## Overall verdict

**PARTIAL PASS** — QX-054, QX-051, and QX-052 all work correctly. QX-053 is a partial pass: `--format json` is functional and mentioned in the Options section, but absent from the usage synopsis and examples, limiting discoverability for first-time users. One new grammar bug was found in the CLI (UQ-new: "1 matches" in search header).
