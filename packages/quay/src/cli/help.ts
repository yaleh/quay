// cli/help.ts — structured help text for the Core CLI (moved verbatim from
// packages/quay/bin/quay.ts by gap-cli-import-command-migration-into-src).
// QX-005 (experiment 4, iteration 1): structured help text for --help / -h.
// Previously `quay --help` fell through to the generic usage error on stderr
// (UQ-001) and `quay task --help` / `quay task list --help` likewise showed
// nothing useful (UQ-002). This closes both gaps.
//
// QX-007 (experiment 4, iteration 1): `quay serve --help` and
// `quay action --help` previously exited 0 with no output (UQ-010). Fixed by
// adding a fallback stub for unrecognised subcommand names so callers always
// get at least minimal guidance.

export function printHelp(sub) {
  if (!sub || sub === "task") {
    process.stdout.write(`quay — task management for AI-assisted development

Usage:
  quay --version | -V
  quay init [--force] [--dry-run] [--root <path>]   (scaffold an EMPTY task store; the loop install is the /quay:init skill, NOT this command)
  quay task list [--status <status>] [--label <label>] [--prefix <prefix>] [--sort id|status|updated] [--search <query>] [--page-size <n>] [--root <path>] [--json|--format json]
  quay task view <task-id> [--json]
  quay task create <task-id> --title <title> [--body <text>|--body-file <path>] [--status <status>] [--labels <a,b>] [--parent <id>] [--children <a,b>] [--extra <json>] [--json]
  quay task edit <task-id> [--title <title>] [--status <status>] [--body <text>|--body-file <path>] [--labels <a,b>] [--extra <json>] [--parent <id>] [--children <a,b>] [--expect-status <status>] [--acceptance <cmd>] [--append-notes <text>] [--enforce-gate] [--json]
  quay task check <task-id> [--json]
  quay adr list [--status <status>] [--tag <tag>] [--json] [--root <path>]
  quay adr view <id> [--json] [--root <path>]
  quay adr new <id> --title <title> [--status <status>] [--body <text>|--body-file <path>] [--json] [--root <path>]
  quay adr accept|deprecate|reject <id> [--json] [--root <path>]
  quay adr supersede <id> --by <newId> [--json] [--root <path>]
  quay action list <task-id> [--json]
  quay action run <task-id> <action-id> [--json]
  quay gate <task-id> [--gate <name>] [--cwd <dir>] [--timeout <ms>] [--dry-run]
  quay gate --list [--verbose|-v] [--json]
  quay gate-log <task-id> [--gate <name>] [--json] [--file <log-path>]
  quay complete <task-id> [--file <log-path>] [--cwd <dir>] [--timeout <ms>]
  quay adjudicate <task-id> [--file <log-path>]
  quay promote <task-id> [--file <log-path>] [--cwd <dir>] [--timeout <ms>]
  quay retreat <task-id> --reason <reason> [--file <log-path>]
  quay run [--once] [--file <log-path>] [--cwd <dir>] [--timeout <ms>]
  quay migrate --from <providerId> --to <providerId> [--json]
  quay config validate [--json|--format json] [--check-files] [--root <path>]
  quay serve [--port <port>] [--host <host>]
  quay mcp
  quay manager start [--dry-run] [--json]
  quay manager adopt <root> [--dry-run] [--json]
  quay manager arm [--dry-run] [--json] [--verify]

Options for task list:
  --status <status>   Filter by status (todo, ready, done, needs-human, superseded)
  --label <label>     Filter by label (repeatable: --label A --label B for AND-filter)
  --prefix <prefix>   Filter by task id prefix (e.g. QX for QX-* tasks)
  --sort id|status|updated  Sort by id, status, or last-updated time (default: insertion order)
  --search <query>    Filter by title/body content (case-insensitive)
  --page-size <n>     Limit output to the first <n> tasks (must be a positive integer)
  --root <path>       Scope the workspace to <path>: resolve .quay/config.yml from
                      <path> (not the process cwd). Fails closed when <path> has no
                      config (no silent cwd fallback). Workspace-scoped commands
                      (task/adr/action/gate/gate-log/complete/adjudicate/promote/
                      retreat/run/migrate/config validate) all accept --root.
  --json              Output as JSON
  --format json       Alias for --json (any other --format value is a usage error)

Options for task create:
  --title <title>      Title for the new task (REQUIRED — hard usage error, no provider call, if missing or empty)
  --body <text>        Initial body text (mutually exclusive with --body-file)
  --body-file <path>   Read initial body from a file ("-" for stdin; mutually exclusive with --body)
  --status <status>    Initial status (todo, ready, done, needs-human, superseded)
  --labels <a,b>       Comma-separated initial labels
  --parent <id>        Parent task id
  --children <a,b>     Comma-separated child task ids
  --extra <json>       Extra metadata as a JSON object string
  --json                Output the created task as JSON

Options for task edit:
  --title <title>       New title (see note below: required and non-empty if <task-id> does not yet exist)
  --status <status>     New status (todo, ready, done, needs-human, superseded)
  --body <text>         Replace body with this text (mutually exclusive with --body-file)
  --body-file <path>    Replace body with file contents ("-" for stdin; mutually exclusive with --body)
  --labels <a,b>        Comma-separated labels (replaces existing labels)
  --extra <json>        Extra metadata as a JSON object string (merged into existing extra)
  --parent <id>         New parent task id
  --children <a,b>      Comma-separated child task ids (replaces existing children)
  --expect-status <status>  Compare-and-swap: fail if the task's current status is not this value
  --acceptance <cmd>        Set the runnable acceptance meter (stored in extra.acceptance; run by
                            'quay gate <id>', the default gate). Repeatable: multiple values are
                            joined with ' && '. Merged into existing extra without clobbering.
  --append-notes <text>     Append text to the existing body (read-then-write convenience)
  --enforce-gate         Opt-in: when a --status change is present, run the same gate check
                          'task check' performs BEFORE writing; refuses (exit 1, no write) if the
                          gate fails, printing the gate's reason. Without this flag (the default),
                          status transitions are UNGUARDED — no gate check is performed, matching
                          today's behavior — analogous to 'git commit --no-verify': a deliberate
                          low-level write path that does not enforce process gates unless asked to.
                          A no-op guard-check if --status is not also given (e.g. --labels alone).
  --json                 Output the edited task as JSON
  (at least one of the above patch-producing flags, or --append-notes, is required)
  Note: editing a task id that does NOT currently exist requires a non-empty --title (this is an
  upsert-as-create; a missing or empty --title is refused with a usage error instead of silently
  creating a titleless or empty-titled task — use 'quay task create' for a dedicated create path
  instead).

Gate engine commands (QENG-1/2) — evaluate a named check and append an immutable GateEvent:
  gate <task-id>    Run a named gate check against <task-id> (default gate: acceptance — runs
                    task.extra.acceptance as a shell command, fail-closed if unset). Exit 0 = PASS,
                    1 = FAIL. Appends a GateEvent to the log (see gate-log).
  gate --list       List every registered gate name (no task id required).
                    --verbose, -v     Show NAME, SOURCE, TYPE, DETAIL columns + diagnostics (DIR-104).
                    --json            Output as JSON (gates array + diagnostics array). Takes
                                      precedence over --verbose when both are present.
  gate-log <task-id>  Print the GateEvent history for <task-id> (human-readable by default).
  --gate <name>     Select a non-default named gate for 'gate'/'gate-log' (e.g. --gate dod).
  --list            With 'gate' (no task id): list registered gate names instead of running one.
  --json            With 'gate-log': output the GateEvent array as JSON instead of human-readable
                    text. With 'gate --list': output gate listing as JSON (DIR-104).
  --file <log-path>  Override the GateEvent log path for 'gate-log' (default
                    <workspaceRoot>/.quay/gate-events.jsonl).
  --cwd <dir>       DIR-046: run the acceptance command IN <dir> instead of the workspace root
                    (e.g. gate a milestone worktree BEFORE merge, not the main repo). Wins over
                    both the workspaceRoot default AND a pre-set QUAY_ACCEPTANCE_CWD env var.
                    Also honored by 'complete'/'promote'/'run'. A per-gate 'cwd' field in the
                    workspace's gates config (DIR-120: .quay/config.yml's own 'gates:' section
                    for a migrated workspace, or a legacy .quay/gates.yml — see
                    packages/quay/src/gate/config/loader.ts's own doc comment) is a
                    lower-precedence third option.
  --timeout <ms>    DIR-046: override the acceptance runner's kill deadline in milliseconds
                    (default 60000). Also honored by 'complete'/'promote'/'run'. A per-gate
                    'timeoutMs' field in that same workspace gates config is a lower-precedence
                    workspace-data alternative — a TIMEOUT failure's reason names both knobs
                    ("raise the gates config's timeoutMs / --timeout").

// Environment contract — when the acceptance gate spawns a command:
  The runner spawns 'sh -c' (a clean shell — no .bashrc/.profile is sourced).
  PATH is inherited from the invoking process, not a fixed system default.
  Override the environment with a per-provider 'acceptance_env' file:
    acceptance_env  DIR-103-C: per-provider config key in .quay/config.yml's provider
                    block — a path to an env file that is dot-sourced before every
                    acceptance command dispatched through that provider. Relative paths
                    resolve against the workspace root. If the configured file does not
                    exist, the runner fails closed BEFORE executing the acceptance
                    command. The QUAY_ACCEPTANCE_ENV env var overrides the config key
                    when pre-set (mirrors the QUAY_ACCEPTANCE_CWD / QUAY_ACCEPTANCE_
                    TIMEOUT_MS explicit-override-wins precedence — a pre-set env var is
                    never clobbered).

  --dry-run         DIR-103-A: execute task.extra.acceptance with the same cwd/timeout/env as a
                    real gate run, print stdout/stderr + exit code, but do NOT append a GateEvent
                    or mutate task status. Short form: -n. Only valid with the default
                    'acceptance' gate (--dry-run --gate dod is a usage error).

Lifecycle commands (QENG-3) — status-writing verbs over the {todo,ready,done,needs-human} phases:
  complete <id>     Precondition status=ready; runs the acceptance gate; on pass writes status=done
                    (exit 0), on fail leaves status unchanged (exit 1). Not-ready → exit 1, no gate/write.
  adjudicate <id>   Independent read-only audit pass; records an audit GateEvent (see gate-log);
                    never writes status; exit 0 always.
  promote <id>      One legal forward step (todo->ready via the dod gate; ready->done via complete).
  retreat <id> --reason <r>   One legal backward step (done->ready, ready->todo, needs-human->todo);
                    --reason is required and recorded in the GateEvent. An illegal transition
                    exits nonzero with a message.
  --file <log-path>  Override the GateEvent log path (default <workspaceRoot>/.quay/gate-events.jsonl)

Driver command (QENG-4) — the autonomous loop AS CODE (scan -> gate -> complete):
  run [--once]      Scan the board for actionable 'ready' tasks (status=ready AND a non-empty
                    acceptance meter) and drive each through 'complete'. NO positional id — 'run'
                    scans the board itself, lowest actionable id first (deterministic).
                    --once  Process exactly ONE actionable task then stop (exit 0 always; a meter
                            fail leaves the task ready + records a GateEvent — a driver observation,
                            not an error). No actionable task -> prints "nothing to do", exit 0.
                    (no flag)  Bounded loop until a fixpoint (no actionable tasks left) or the stop
                            sentinel <workspaceRoot>/.quay/.stop (checked at each iteration boundary);
                            both exit 0. Only the runaway safety ceiling (maxIterations) exits 1.

Migration command (DIR-039) — generic ABI provider-to-provider task migration:
  migrate --from <providerId> --to <providerId>
                    Reads EVERY task from the --from provider via the Provider ABI (task_list) and
                    writes each one to the --to provider via the ABI (task_write) — provider-
                    agnostic, works for any pair declared in .quay/config.yml (e.g. --from github
                    --to native). Both providers connect simultaneously (does not require either
                    to be the config's 'enabled' default). Exit 0 if every task migrated cleanly;
                    exit 1 if any per-task write failed (errors are still reported, not fatal to the
                    whole run — a partial migration is visible, not silently swallowed).
  --from <providerId>  Source provider id (must exist in .quay/config.yml's providers map)
  --to <providerId>    Target provider id (must exist in .quay/config.yml's providers map, and
                        differ from --from)
  --json              Output a { total, migrated, errors } JSON summary instead of one line per task

Examples:
  quay task list --prefix QX          List only QX-* tasks
  quay task list --status todo        List todo tasks
  quay task list --search "bootstrap" List tasks with "bootstrap" in title or body
  quay task view QX-001               View task details
  quay task create QX-002 --title "New task"  Create a new task (--title required, non-empty)
  quay task edit QX-001 --status done Mark task done
`);
  } else if (sub === "init") {
    process.stdout.write(`quay init — scaffold a new quay workspace

Usage:
  quay init [--force] [--dry-run] [--root <path>]

Flags:
  --force      Overwrite existing .quay/config.yml if present.
  --dry-run    Print the generated config to stdout without writing to disk.
  --root <path>  Scaffold at <path> instead of the current working directory.

Description:
  Creates .quay/config.yml (with all 3 sections: providers, gates, loop) and
  a tasks/ directory at the project root. Auto-detects project type (Node.js /
  Go) to suggest appropriate gate defaults.

  If .quay/config.yml already exists, refuses to overwrite unless --force.

  This command only scaffolds a brand-new EMPTY task store. It does NOT lay
  down the loop mechanism (workflows, agents, gate scripts, tick docs) — the
  canonical path for onboarding an existing project onto quay-driven
  development is the /quay:init skill inside a Claude Code session:
  /quay:init --all --loop. CLI init has no --loop flag; passing it is an error.
`);
  } else if (sub === "config") {
    process.stdout.write(`quay config — validate workspace configuration

Usage:
  quay config validate [--json|--format json] [--check-files] [--root <path>]
  quay config check [--json|--format json] [--check-files] [--root <path>]

Description:
  Validates .quay/config.yml (or legacy .quay/gates.yml + .quay/loop.yml) for
  structural correctness: YAML syntax, provider fields, gate schemas, gate
  reference resolution, loop fields, and routine shapes. Exits 0 when the
  config is valid; exits 1 with diagnostics when errors are found.

  'check' is an alias for 'validate'.

  --root <path> resolves the workspace from <path> (not the process cwd),
  with the same semantics every workspace-scoped command uses — so
  "task list --root <path>" and "config validate --root <path>" agree on
  which config is in scope (no second semantics).

Options:
  --json          Output issues as a JSON array (empty on valid).
  --format json   Alias for --json.
  --check-files   Also verify that gate script/command paths reference files
                  that exist on disk.
  --root <path>   Scope the workspace to <path> (fail-closed when <path> has
                  no .quay/config.yml).
`);
  } else if (sub === "gate") {
    process.stdout.write(`quay gate — run a named gate check against a task

Usage:
  quay gate <task-id> [--gate <name>] [--cwd <dir>] [--timeout <ms>] [--dry-run]
  quay gate --list

  gate <task-id>    Run a named gate check against <task-id> (default gate: acceptance — runs
                    task.extra.acceptance as a shell command, fail-closed if unset). Exit 0 = PASS,
                    1 = FAIL. Appends a GateEvent to the gate-event log.
  gate --list       List every registered gate name (no task id required).

Flags:
  --gate <name>     Select a non-default named gate (e.g. --gate dod).
  --list            With 'gate' (no task id): list registered gate names.
  --cwd <dir>       Run the acceptance command in <dir> instead of the workspace root.
  --timeout <ms>    Override the acceptance runner's kill deadline in ms (default 60000).
  --dry-run         Execute task.extra.acceptance with the same cwd/timeout/env as a real
                    gate run, print stdout/stderr + exit code, but do NOT append a GateEvent
                    or mutate task status. Short form: -n. Only valid with the default
                    'acceptance' gate.

Environment contract — when the default 'acceptance' gate spawns a command:
  The runner spawns 'sh -c' (a clean shell — no .bashrc/.profile is sourced).
  PATH is inherited from the invoking process, not a fixed system default.
  Override the environment with a per-provider 'acceptance_env' file:
    acceptance_env  DIR-103-C: per-provider config key in .quay/config.yml's provider
                    block — a path to an env file that is dot-sourced before every
                    acceptance command dispatched through that provider. Relative paths
                    resolve against the workspace root. If the configured file does not
                    exist, the runner fails closed BEFORE executing the acceptance
                    command. The QUAY_ACCEPTANCE_ENV env var overrides the config key
                    when pre-set (mirrors the QUAY_ACCEPTANCE_CWD / QUAY_ACCEPTANCE_
                    TIMEOUT_MS explicit-override-wins precedence — a pre-set env var is
                    never clobbered).
`);
  } else {
    // QX-007: stub for subcommands not yet documented in detail (serve, action, mcp, …).
    process.stdout.write(`Usage: quay ${sub} [...]\nRun \`quay --help\` for full usage documentation.\n`);
  }
}
