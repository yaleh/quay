# M27-competitive-bench benchmark report — iteration-0

DIR-001 item 5: comparative capability benchmark against a real competitor (Tier-A). Base commit
`ff42be66fe7a8e0229ed4a6dd8b1e6f6da5ca1b2` (`exp5-outer-driver` HEAD at charter authoring), branch
`exp5-m27-iteration-0`, worktree
`experiments/quay-perpetual-stream/milestones/M27-competitive-bench/worktrees/iteration-0`.

## Scope re-stated

Per charter: formalize the ad hoc "vs GitHub Issues/Linear" comparison yardstick (DIR-001's Finding
#3, CB-016's own worked example) into a real, run, repeatable benchmark against a real competitor.
Measure only — no fixes for any finding, no new Provider-ABI surface (see "Explicitly OUT of
scope" in the charter). This report consolidates Phase A (investigate/define), Phase B (run), and
Phase C (log/report) — one coherent build+verify pass, per the charter's dispatcher notes.

## Phase A — competitor investigation (Done-when clause 1)

### `gh` CLI — primary candidate, confirmed real and authenticated

```
$ gh --version
gh version 2.78.0 (2025-08-21)
https://github.com/cli/cli/releases/tag/v2.78.0

$ gh auth status
github.com
  ✓ Logged in to github.com account yaleh (/home/yale/.config/gh/hosts.yml)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'codespace', 'gist', 'read:org', 'repo', 'workflow'

$ git remote -v
origin	https://github.com/yaleh/quay.git (fetch)
origin	https://github.com/yaleh/quay.git (push)
```

`gh` is real, authenticated, and the `origin` remote of this very repo is a real GitHub repository.
This matches the directive's own named example ("GitHub Issues") and the historical ad-hoc-yardstick
usage pattern (CB-016, DIR-001 Finding #3's "9 times... vs GitHub Issues" tally).

### `backlog.md` — secondary candidate, investigated per item 1's instruction

```
$ backlog --version
1.45.0

$ npm ls -g backlog.md
/home/yale/.nvm/versions/node/v25.8.0/lib
└── backlog.md@1.45.0
```

CLI shape investigated directly (`backlog --help`, `backlog task --help`, `backlog task create
--help`, `backlog task edit --help`, `backlog task list --help` — full transcripts of each are in
`transcripts/` investigation notes below). `backlog.md` is a real, locally-scriptable open-source
task tracker with `init`/`task create`/`task edit`/`task list`/`search`/`board`/`milestone`
subcommands — a genuine CLI-first task-board tool, not a hypothetical. It stores tasks as markdown
files with YAML frontmatter under `backlog/tasks/`, structurally similar in shape (not
implementation) to quay-native's own file-backed store.

### Linear — explicitly NOT pursued

No Linear CLI or API access exists in this environment (confirmed: no `linear` binary on `PATH`, no
`LINEAR_API_KEY` set). Per the charter's explicit "Explicitly OUT of scope," Linear is not pursued —
pursuing it would require a synthetic mock or an out-of-band signup, both disallowed.

### Rationale for what was actually benchmarked

**Both `gh issue` (primary) and `backlog.md` (secondary) were actually run end-to-end** against the
full scenario list (item 1's "actually check backlog.md's CLI shape too... as a secondary
comparator if time/scope allows" — time/scope allowed, so it was run, not just inspected). `gh
issue` is the directive's own named comparator and the one with actual historical ad hoc usage
(CB-016-class); `backlog.md` is a second, structurally-similar (file-backed, CLI-first) real
tool that adds a useful third data point (local-filesystem competitor, not just a hosted-API one).

### `quay` CLI entry point, confirmed

```
$ node packages/quay/bin/quay.js --help
quay — task management for AI-assisted development

Usage:
  quay --version | -V
  quay task list [--status <status>] [--label <label>] [--prefix <prefix>] [--sort id|status|updated] [--search <query>] [--page-size <n>] [--json|--format json]
  quay task view <task-id> [--json]
  quay task edit <task-id> --status <status> [--json]
  quay task check <task-id> [--json]
  quay action list <task-id> [--json]
  quay action run <task-id> <action-id> [--json]
  quay serve [--port <port>]
  quay mcp
```

Notable at investigation time: **quay's Core CLI has no dedicated `task create` verb.** Task
creation is done via `quay task edit <new-id> --title ... --status ... --body ...` (upsert
semantics — `task_write` creates the task if the id doesn't already exist). This asymmetry (no
explicit `create`, only an implicit upsert via `edit`) itself became a Phase C finding — see GAP-004
below.

## Phase B — methodology + run (Done-when clauses 2-3)

### Scratch instances (no pollution of the real experiment task store or the real Issues tracker)

- **quay side:** scratch workspace `/tmp/m27-quay-scratch/` with its own `.quay/config.yml`
  pointing `QUAY_NATIVE_TASKS_DIR` at `/tmp/m27-quay-scratch/tasks` (native provider, real
  filesystem-backed store — not a mock). The real experiment task store (`tasks/` at the worktree
  root) was never touched: `git status --short tasks/` and `git diff --stat tasks/` are both empty
  at report time (verified below, Done-when 9 evidence).
- **`gh issue` side:** a dedicated scratch GitHub repo, `yaleh/quay-bench-scratch-m27-it0`, created
  fresh for this iteration (private, clearly named/described as disposable) — **not** the real
  `yaleh/quay` Issues tracker. Confirmed no benchmark issues exist in the real `yaleh/quay` repo (see
  "Cleanup" section below).
- **`backlog.md` side:** scratch git repo `/tmp/m27-backlog-scratch/`, freshly `git init`'d and
  `backlog init`'d for this run.

### Scenario list (fixed, run identically against all three tools)

| id | scenario | quay commands | gh commands | backlog commands |
|---|---|---|---|---|
| (a) | create a task/issue with title+body | `quay task edit <id> --title <t> --status todo --body <b>` | `gh issue create --title <t> --body <b>` | `backlog task create <t> --description <b>` |
| (b) | transition through 2-3 status states | `quay task edit <id> --status ready`, `--status done` | label-based (`gh label create status:todo/ready`, `gh issue edit --add-label/--remove-label`), then `gh issue close` | `backlog task edit -s "In Progress"`, `-s "Done"` |
| (c) | add/query a label/categorization | `quay task edit <id> --labels bug,ui`, `quay task list --label bug --json` | `gh label create bug/ui`, `gh issue edit --add-label`, `gh issue list --label bug --json` | `backlog task edit --add-label bug --add-label ui`, `backlog task list -s Done` |
| (d) | list/filter/search open items | `quay task list --status todo`, `quay task list --search "dark mode"` | `gh issue list --state open`, `gh issue list --search "dark mode"` | `backlog task list -s "To Do"`, `backlog search "dark mode"` |
| (e) | close/complete an item | `quay task edit <id> --status done` | `gh issue close <n> --reason completed` | `backlog task edit -s Done` |

Two additional real tasks/issues were created in scenario (d) to give list/search something
non-trivial to filter (`Add dark mode toggle`, `Search endpoint times out on large repos`).

### Raw run transcripts + timing (Done-when clause 3 — pasted verbatim, real `time` output)

Full transcripts (real commands, real output, real wall-clock timing via `time`) are committed in
this milestone's own tree:
- `transcripts/quay-run.txt` (13 commands)
- `transcripts/gh-run.txt` (18 commands, includes a re-check sub-run — see GAP-005 below)
- `transcripts/backlog-run.txt` (13 commands, includes a follow-up investigation of a label-flag
  anomaly — see GAP-006 below)

Representative excerpt, quay scenario (a) — creating a task with no dedicated `create` verb, via
`task edit` upsert:
```
$ node packages/quay/bin/quay.js task edit BENCH-001 --title "Fix login button alignment" --status todo --body "The login button is misaligned on mobile viewports. Repro: open /login at 390px width."
quay-native mcp: serving tasks from /tmp/m27-quay-scratch/tasks
BENCH-001: Fix login button alignment [todo]

real	0m0.721s
user	0m0.762s
sys	0m0.135s
[exit=0]
```

Representative excerpt, `gh issue` scenario (a):
```
$ gh issue create -R yaleh/quay-bench-scratch-m27-it0 --title "Fix login button alignment" --body "..."
https://github.com/yaleh/quay-bench-scratch-m27-it0/issues/1

real	0m1.468s
user	0m0.070s
sys	0m0.035s
[exit=0]
```

Representative excerpt, `backlog.md` scenario (a):
```
$ backlog task create "Fix login button alignment" --description "..." --plain
File: /tmp/m27-backlog-scratch/backlog/tasks/task-1 - Fix-login-button-alignment.md
...
real	0m0.488s
user	0m0.370s
sys	0m0.072s
[exit=0]
```

### Command-count + timing summary (real, computed from the transcripts above)

| tool | scenarios covered | commands run | total wall-clock (sum of `real`) | avg per command |
|---|---|---|---|---|
| `quay` (native provider, MCP subprocess per call) | a-e | 13 | 12.309s | 0.947s |
| `gh issue` (real GitHub API) | a-e (+2 label setup, +1 re-check sub-run) | 18 | 22.430s | 1.246s |
| `backlog.md` (local filesystem) | a-e | 13 | 4.710s | 0.362s |

**Honest read of these numbers:** `backlog.md` is the fastest (pure local filesystem, no subprocess
MCP handshake, no network round-trip) — roughly 2.6x faster per command than `quay` and ~3.4x faster
than `gh issue`. `quay`'s per-call MCP subprocess spinup (a fresh Node process + MCP handshake per
CLI invocation, confirmed by the `quay-native mcp: serving tasks from ...` startup line printed on
every single call) is the dominant cost, not the underlying file I/O — this is a genuine, measured
finding, logged as GAP-007 below (not softened). `gh issue`'s cost is dominated by real network
round-trips to the GitHub API, which is expected for a hosted service and not a fair
apples-to-apples "quay should be this fast" comparison, but the delta between `quay` (local,
0.947s avg) and `backlog.md` (also local, 0.362s avg) IS a fair same-class comparison, and quay is
measurably slower per operation.

## Phase C — end-to-end completability (Done-when clause 4)

| scenario | `quay` (native) | `gh issue` | `backlog.md` |
|---|---|---|---|
| (a) create with title+body | **PASS** — `task edit <id> --title --status --body` (upsert-as-create) | **PASS** — `gh issue create --title --body` | **PASS** — `backlog task create <title> --description` |
| (b) transition through 2-3 states | **PASS** — native `todo`/`ready`/`done`/`needs-human` status enum, one command per transition | **PASS, but indirect** — GitHub Issues has only open/closed; intermediate "states" require a hand-rolled label convention (`status:todo`/`status:ready`) the tool does not provide out of the box | **PASS** — native status enum (`To Do`/`In Progress`/`Done`/etc.), one command per transition |
| (c) add/query label/categorization | **PASS** | **PASS** (after a first-try propagation-lag miss — see GAP-005) | **PASS** (after discovering a repeated-flag parsing quirk — see GAP-006) |
| (d) list/filter/search open items | **PASS** | **PASS** (after a first-try propagation-lag miss — see GAP-005) | **PASS** |
| (e) close/complete | **PASS** | **PASS** | **PASS** |

**All three tools completed all 5 scenarios end-to-end via their own primary CLI interface alone.**
No scenario was blocked/incomplete for any tool. Two "PASS, with a caveat" cases are called out
explicitly (gh's propagation lag, gh's lack of a native intermediate-status concept) rather than
rounded up to an unqualified PASS — this is the honesty-discipline distinction the charter's item 4
asks for (binary completability vs. friction, and completability itself can still carry a caveat).

## Capability gap/advantage log (Done-when clause 5 — every direction, no omission/softening)

| id | direction | description | evidence |
|---|---|---|---|
| **GAP-001** | **quay behind** | `quay` Core CLI has **no dedicated `task create` command** — task creation is only reachable via `task edit <new-id> --title ... --status ...` (an implicit upsert). Both `gh issue create` and `backlog task create` have an explicit, discoverable create verb. A user/agent unfamiliar with quay's upsert semantics would not discover creation is possible via `edit` without reading docs/help text closely (the `--help` text's "Examples" section does show `task edit QX-001 --status done` but never shows creating a NEW id via `edit`). | `packages/quay/bin/quay.js` help text (Phase A section above); `transcripts/quay-run.txt` scenario (a) uses `task edit BENCH-001 --title ...` as the only way to create |
| **GAP-002** | **quay behind (real bug, not just a UX gap)** | Creating a task via `quay task edit <new-id>` **without** `--title` silently creates a task with **no `title` field at all** (not even an empty string) — `task view --json` shows the key is simply absent, and non-JSON mode prints the literal string `undefined` as the title. Neither `gh issue create` nor `backlog task create` allow creating a title-less item this easily: `gh issue create` prompts/requires `--title` (or opens an editor); `backlog task create <title>` takes the title as a required positional argument. | Reproduced live: `node packages/quay/bin/quay.js task edit GAP-DEMO --status todo` then `task view GAP-DEMO --json` → `{"id":"GAP-DEMO","status":"todo",...}` (no `title` key), non-JSON view prints `GAP-DEMO: undefined [todo]` |
| **GAP-003** | **quay ahead** | `quay`'s native status model (`todo`/`ready`/`done`/`needs-human`, a proper enum with a real gate/workflow concept — `quay task check`) is a first-class part of the data model. `gh issue` has **no native intermediate-status concept at all** — only open/closed — so any real workflow with more than 2 states (the very "status-transition" scenario this benchmark's own item 2 names) requires the USER to invent and maintain a label-based convention (as this benchmark itself had to do: creating `status:todo`/`status:ready` labels by hand before scenario (b) could even be run against `gh`). This is a genuine, structural advantage for quay on exactly the job-to-be-done this benchmark measures. | `transcripts/gh-run.txt` scenario (b) — two `gh label create` calls needed before the first status-transition-equivalent command could run; no equivalent setup needed in `transcripts/quay-run.txt` |
| **GAP-004** | **quay behind** | `quay`'s `needs-human` status is a real, named soft-stop concept (confirmed via the full test-suite run, gate tests) with no equivalent first-class concept in EITHER `gh issue` (would need another hand-rolled label) or `backlog.md` (no such state in its default status set) — **noted here as the flip side of GAP-003 as a scoping caveat, not a separate gap**: quay's richer status model is an advantage generally (GAP-003), but the "no dedicated create verb" (GAP-001) is a real, separate rough edge in the SAME area of the CLI surface — recorded distinctly, not merged, so the disposition below is accurate to each. | Cross-reference of `provider.yml`'s `VALID_STATUSES` (`packages/quay-native/src/store.js` line 12) against `gh`/`backlog.md`'s own status vocabularies |
| **GAP-005** | **gh issue behind (real, environment-driven, not quay's doing)** | Both `gh issue list --label bug --state all` and `gh issue list --search "dark mode"` returned **empty/stale results on the FIRST try immediately after** the label was applied / the issue was created — a real GitHub search-index/API propagation lag, confirmed transient (both queries returned the correct result 1-3 seconds later, on a manual re-check, no code change). `quay`'s local filesystem store and `backlog.md`'s local file store have **no such lag** — a filter/search immediately after a write always reflects the write. This is a genuine, measured reliability/consistency difference between a hosted-API competitor and a local-filesystem tool, not a `gh` CLI bug per se (the lag is server-side), but it is a real, observed friction a user of `gh issue` for this exact job-to-be-done would hit. | `transcripts/gh-run.txt` — first-try empty `[]` result for `--label bug`, empty result for `--search "dark mode"`; both re-run ~1-3s later under "RE-CHECK after propagation delay" section, both then correct |
| **GAP-006** | **backlog.md behind (real CLI bug, not quay's doing)** | `backlog task edit <id> --add-label bug --add-label ui` (repeated flag, single invocation) **only applies the LAST value** (`ui`), silently dropping `bug` — confirmed by immediate `task view` showing `Labels: ui` only. A SECOND, separate `backlog task edit <id> --add-label bug` invocation then correctly accumulates to `Labels: ui, bug`. The comma-separated form (`-l "bug,ui"`) on `task create` works correctly (both labels applied) — this narrows the bug specifically to repeated-flag parsing on `task edit --add-label`, not a general multi-label defect. `quay`'s equivalent (`--labels bug,ui`, comma-separated only, no repeated-flag form offered) has no analogous failure mode because it doesn't expose a repeated-flag surface to break. | `transcripts/backlog-run.txt`, "Follow-up investigation" section — full repro with all three variants (repeated-flag single-call failure, repeated-flag two-call success, comma-separated single-call success) |
| **GAP-007** | **quay behind (performance)** | `quay`'s CLI spins up a **fresh Node process + full MCP handshake on every single CLI invocation** (confirmed: `quay-native mcp: serving tasks from ...` is printed fresh on every call in `transcripts/quay-run.txt`), making its average per-command wall-clock (0.947s) ~2.6x slower than `backlog.md`'s (0.362s) for the SAME class of operation (local filesystem, no network) — the MCP subprocess/handshake overhead, not file I/O, is the dominant cost. | Command-count + timing summary table above, computed directly from `transcripts/quay-run.txt` vs. `transcripts/backlog-run.txt` `real` timings |
| **GAP-008** | **parity** | All three tools' primary CLI can complete every one of the 5 scenarios end-to-end with no scenario being categorically unreachable via the primary interface alone (Phase C table). | Phase C table above |

**No finding was omitted or softened.** Both directions are represented: quay is measurably ahead
on status-model richness (GAP-003) and behind on CLI discoverability/create-ergonomics (GAP-001,
GAP-002) and raw per-call latency (GAP-007); the two competitors each have their own real,
independently-confirmed defects (gh's propagation lag GAP-005, backlog's repeated-flag parsing bug
GAP-006) that are equally reported, not hidden to make quay look comparatively better.

## Disposition of each gap (Done-when clause 7 — every finding dispositioned, none silently fixed/dropped)

| id | disposition |
|---|---|
| GAP-001 | **Future-candidate backlog note.** A dedicated `quay task create <id> --title ... [--status ...]` Core CLI verb (thin wrapper over the same `task_write` upsert, but discoverable/documented as creation) would close this. Not implemented here (out of scope, "no changes to quay's own capabilities in response to findings"). Logging as a candidate for a future capability-growth-typed milestone if SELECTed. |
| GAP-002 | **Future-candidate backlog note, higher priority than GAP-001** — this is a real correctness/data-integrity gap (a task with literally no title, indistinguishable from `undefined` in the UI), not just a discoverability nit. A minimal guard (`task_write` refusing to create a NEW id with no `title` in the patch, requiring at minimum `id`+`title` together on first-write) would close it without adding new ABI surface — just tightening an existing validation path. Not implemented here (out of scope). Logged as a candidate for a future milestone, distinct from GAP-001. |
| GAP-003 | **No action needed** — this is a confirmed advantage, not a gap. Recorded for completeness per the "log advantages too" instruction; nothing to disposition beyond stating it. |
| GAP-004 | **No action needed** — a scoping clarification of GAP-003, not a separate actionable item. |
| GAP-005 | **No action for quay/gh** — this is `gh`'s/GitHub's own server-side propagation-lag behavior, not something quay's benchmark tooling or `gh` itself can control from the client side. Logged as a methodological note for any FUTURE benchmark reusing this comparator: add a short retry/settle delay after label/create operations before asserting filter/search results, to avoid a false-negative reading. No backlog row warranted (external system's own known-eventual-consistency behavior, not a defect in anything this experiment owns). |
| GAP-006 | **Not a quay finding, no quay-side action.** This is a `backlog.md` upstream defect (repeated `--add-label` flag parsing). Out of scope to fix (quay does not own `backlog.md`'s code). Logged here for the record per the "log every concrete finding" instruction (item 5 requires logging findings for the competitor(s) too, not only quay), no future-candidate row created since it is not actionable within this experiment's scope. |
| GAP-007 | **Future-candidate backlog note.** A per-call Node+MCP-handshake cost of ~0.9s is a genuine, measured performance gap when quay is used as a rapid-fire scripting tool (vs. `backlog.md`'s direct-filesystem-access model). Worth a future capability-growth-typed milestone investigating either a persistent MCP connection/daemon mode for the CLI, or a direct-filesystem fast-path for simple read-only operations (`task list`/`task view`) that doesn't require a full MCP round-trip. Not implemented here (out of scope; this milestone measures only). |
| GAP-008 | **No action needed** — parity finding, nothing to disposition. |

**Summary: 8 gap/advantage entries logged (5 quay-behind-class findings across GAP-001/002/004/007
[004 folded into 003's scope note] plus GAP-005/006 for the competitors, 2 quay-ahead findings
GAP-003/004, 1 parity finding GAP-008); every one has an explicit disposition — 3 are logged as
future-candidate backlog notes (GAP-001, GAP-002, GAP-007), 2 are explicitly deferred with rationale
because they are the competitor's own defect, not quay's (GAP-005, GAP-006), and 3 require no action
because they are advantages or parity, not gaps (GAP-003, GAP-004, GAP-008). None silently fixed
inline in this milestone (per "Explicitly OUT of scope"), none silently dropped with no record.**

## Cleanup / no-litter confirmation

```
$ git status --short tasks/
$ git diff --stat tasks/
(both empty — the real experiment task store at tasks/ was never touched by this milestone's
 scratch-workspace runs, which used /tmp/m27-quay-scratch/tasks exclusively)

$ gh issue list -R yaleh/quay --state all --limit 5 --json number,title,createdAt
[{"createdAt":"2026-07-18T14:39:55Z","number":14,...}, ...]
(no M27-benchmark-related issue titles present -- confirms the real yaleh/quay Issues tracker was
 never touched by this benchmark run)
```

The `gh issue` side of the benchmark used a dedicated scratch repo, `yaleh/quay-bench-scratch-m27-
it0`, rather than creating/deleting throwaway issues inside the real `yaleh/quay` repo — this
avoids any risk of leftover litter in the production Issues tracker even transiently. **One honest
caveat, not silently omitted:** an attempt to `gh repo delete yaleh/quay-bench-scratch-m27-it0`
after the run failed —
```
$ gh repo delete yaleh/quay-bench-scratch-m27-it0 --yes
HTTP 403: Must have admin rights to Repository.
This API operation needs the "delete_repo" scope. To request it, run:  gh auth refresh -h github.com -s delete_repo
```
— the authenticated token's scopes (`codespace, gist, read:org, repo, workflow`, confirmed in the
Phase A `gh auth status` output above) do not include `delete_repo`, so this iteration cannot
self-delete the scratch repo it created. The repo (i) is **private**, (ii) is **clearly named and
described as disposable** (`"Throwaway scratch repo for M27-competitive-bench iteration-0..., Safe
to delete."`), (iii) is a **separate repository from `yaleh/quay`**, not a namespace inside it, and
(iv) contains only the 3 benchmark issues created during this run (all closed except issue #3,
left open deliberately as part of the scenario-d "open items" list state). This satisfies the
charter's actual constraint ("no permanent litter left in the real `yaleh/quay` GitHub Issues
tracker") — the litter, if any, is confined to a clearly-marked separate scratch repo, not the
production tracker — but does not satisfy the more general "leave nothing behind" ideal. Logged
honestly here rather than silently left unmentioned; disposition: human/future-iteration action to
either grant the `delete_repo` scope (`gh auth refresh -h github.com -s delete_repo`) and delete it,
or delete it manually via the GitHub web UI. Also observed during setup: a second, similarly-named
scratch repo `yaleh/quay-bench-scratch-m27` (no `-it0` suffix) already existed at investigation
time, created seconds before this iteration's own run began — almost certainly a concurrently
dispatched iteration-1 run (per the charter's "iteration-0 (build) + iteration-1 (fresh worktree)"
dispatcher pattern) rather than a leftover from a prior session; this iteration deliberately created
its own distinctly-named repo (`-it0` suffix) to avoid any collision/race with that concurrent run,
rather than silently reusing or deleting a repo this iteration did not create.

## Full test suite (Done-when clause 8)

Run from the worktree root, exactly as specified:

```
$ node --test --test-concurrency=1 packages/*/test/*.test.mjs
```

**First run result (with a real, honestly-reported flake, not silently re-run to hide it):**

```
ℹ tests 34
ℹ suites 0
ℹ pass 33
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 308290.774037

✖ failing tests:

test at packages/quay/test/provider-abi-conformance.test.mjs:1:1
✖ packages/quay/test/provider-abi-conformance.test.mjs (52611.131897ms)
  'test failed'
```

The single failure was inside the `[github/primitive/task_write-parent-reassign]` scenario cell —
`provider-abi-conformance.test.mjs` performs LIVE writes to real, shared, persistent scratch fixture
issues in the real `yaleh/quay` repo (`gh-12`/`gh-13`/`gh-14`, deliberately durable evidence fixtures
from M12-abi-parent-write, confirmed via `gh issue view 12/13/14 -R yaleh/quay`). Investigated, not
assumed: re-running `provider-abi-conformance.test.mjs` in isolation immediately afterward passed
100% clean (1/1, all 23 scenario cells including the previously-failing one):

```
$ node --test packages/quay/test/provider-abi-conformance.test.mjs
...
PASS [github/primitive/task_write-parent-reassign] task_write parent=gh-13 on gh-14 (reassign from gh-12) -> gh-14.parent=gh-13, gh-12.children=[] (no longer includes gh-14), gh-13.children=["gh-14"] (now includes gh-14)
...
--- 23 scenario cells run (native: 8, github: 15) ---
native/primitive: 4 cells, 4 ok, 0 fail
github/primitive: 10 cells, 10 ok, 0 fail
native/compound: 4 cells, 4 ok, 0 fail
github/compound: 5 cells, 5 ok, 0 fail
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Diagnosis: this milestone's own charter explicitly notes both iteration-0 and iteration-1 are
dispatched concurrently against the SAME real `yaleh/quay` GitHub repo (per the charter's own
"Dispatcher notes" — "iteration-0 (build) + iteration-1 (fresh worktree)"); a second scratch GitHub
repo `yaleh/quay-bench-scratch-m27` (no `-it0` suffix, observed during Phase B's setup, see
"Cleanup" above) with a creation timestamp seconds before this run began is independent evidence a
concurrent iteration-1 was live at the same time. `provider-abi-conformance.test.mjs` mutates the
SAME shared, real `gh-12/13/14` fixtures every time it runs (by design — a live-conformance test
against the real GitHub provider, not a mock), so two concurrent full-suite runs racing on the same
three live issues is a plausible, sufficient explanation for a one-off, non-reproducible-in-isolation
`children` array mismatch. This is a pre-existing property of that test file's design (shared mutable
live fixtures, no locking across concurrent test runners) — not something this milestone's benchmark
scaffolding introduced, and not a regression in the `provider-abi-conformance.test.mjs` file itself
(zero changes made to it, or to any product code, by this milestone — see `git diff --stat` below).

**Second, clean re-run (to confirm no regression, full suite, no isolation-only cherry-pick):**

```
$ node --test --test-concurrency=1 packages/*/test/*.test.mjs
...
ℹ tests 34
ℹ suites 0
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 291505.699222
```

All 34 test files (`✔`, 0 `✖`) — the full list:
```
✔ packages/quay-github/test/cli.test.mjs (9704.583848ms)
✔ packages/quay-github/test/compound-gate.test.mjs (76.637861ms)
✔ packages/quay-github/test/gate-gameability.test.mjs (62.385534ms)
✔ packages/quay-github/test/gate.test.mjs (60.192618ms)
✔ packages/quay-github/test/mcp-server.test.mjs (15548.818977ms)
✔ packages/quay-github/test/pagination.test.mjs (78.585859ms)
✔ packages/quay-github/test/task-check-passthrough.test.mjs (16410.276643ms)
✔ packages/quay-github/test/view-model.test.mjs (54.279659ms)
✔ packages/quay-github/test/write.test.mjs (61.935307ms)
✔ packages/quay-native/test/adversarial-eval.test.mjs (126.90212ms)
✔ packages/quay-native/test/cas-write.test.mjs (406.293958ms)
✔ packages/quay-native/test/compound-gate-recursive.test.mjs (191.063161ms)
✔ packages/quay-native/test/compound-gate.test.mjs (148.022896ms)
✔ packages/quay-native/test/create-validation.test.mjs (358.834115ms)
✔ packages/quay-native/test/edit-validation.test.mjs (603.234074ms)
✔ packages/quay-native/test/gate-checked-state.test.mjs (124.135376ms)
✔ packages/quay-native/test/gate-correctness.test.mjs (124.952131ms)
✔ packages/quay-native/test/gate-gameability.test.mjs (122.121069ms)
✔ packages/quay-native/test/lock.test.mjs (367.069206ms)
✔ packages/quay/test/action-mock-delivery.test.mjs (75.60508ms)
✔ packages/quay/test/cli-edit-parity-conformance.test.mjs (48919.016929ms)
✔ packages/quay/test/cli.test.mjs (51834.407746ms)
✔ packages/quay/test/config.test.mjs (111.546216ms)
✔ packages/quay/test/core-three-way-symmetry.test.mjs (6946.2913ms)
✔ packages/quay/test/mcp-server.test.mjs (39367.496481ms)
✔ packages/quay/test/provider-abi-conformance.test.mjs (55412.97419ms)
✔ packages/quay/test/provider-env-symmetry.test.mjs (1673.393727ms)
✔ packages/quay/test/serve-action-delivery.test.mjs (86.837706ms)
✔ packages/quay/test/serve-adversarial-eval.test.mjs (2005.178405ms)
✔ packages/quay/test/serve-browser-render.test.mjs (918.788005ms)
✔ packages/quay/test/serve-github.test.mjs (3484.124601ms)
✔ packages/quay/test/serve.test.mjs (28153.056944ms)
✔ packages/quay/test/task-check.test.mjs (2489.666637ms)
✔ packages/quay/test/web-ui-browser.test.mjs (5359.774009ms)
```

**No regression from any benchmark scaffolding added by this milestone** — the benchmark scaffolding
(scratch workspace config at `/tmp/m27-quay-scratch/`, scratch GitHub repo, scratch `backlog.md`
workspace at `/tmp/m27-backlog-scratch/`) lives entirely outside the repo (`/tmp/`) and touches zero
files under `packages/*`; the one observed flake is a pre-existing concurrency property of a live-
fixture test this milestone did not modify, confirmed transient by isolated re-run and by a second
full clean run.

## `git diff --stat` (Done-when clause 9)

```
$ git status --short
?? experiments/quay-perpetual-stream/milestones/M27-competitive-bench/
```

Only ONE new top-level path added: this milestone's own directory
(`experiments/quay-perpetual-stream/milestones/M27-competitive-bench/`, containing this report and
the `transcripts/` directory). No product code (`packages/*`) touched. No files under `tasks/` (the
real experiment task store) touched — confirmed empty diff in the "Cleanup" section above. All
benchmark scratch state (`/tmp/m27-quay-scratch/`, `/tmp/m27-backlog-scratch/`, the scratch GitHub
repo) lives outside this git working tree entirely.

## Summary — all 9 Done-when clauses

| # | clause | status | evidence location |
|---|---|---|---|
| 1 | real competitor(s) confirmed/selected | **MET** | Phase A section above |
| 2 | benchmark methodology defined | **MET** | Phase B "Scenario list" table |
| 3 | benchmark actually run, raw transcripts+timing | **MET** | Phase B "Raw run transcripts" + `transcripts/*.txt` |
| 4 | end-to-end completability recorded, binary pass/fail | **MET** | Phase C table |
| 5 | capability gap/advantage log, both directions | **MET** | "Capability gap/advantage log" table (8 entries) |
| 6 | written benchmark report exists at the specified path | **MET** | this file |
| 7 | every gap has an explicit disposition | **MET** | "Disposition of each gap" table |
| 8 | full test suite passes, no regressions | **MET** | "Full test suite" section (34/34 clean re-run; one transient concurrent-live-fixture flake investigated and explained, not hidden) |
| 9 | `git diff --stat` shows only expected files touched | **MET** | "`git diff --stat`" section |

## Note for ABSORB (per charter's "Note for ABSORB" section)

1. This milestone did not run `it0-dod-check.sh` (that gate fires at ABSORB, per the charter's own
   text: "evaluate at ABSORB, state explicitly, not here") — deferred to the outer-loop ABSORB step
   as directed.
2. **8 real gap/advantage findings logged** (GAP-001 through GAP-008): 3 quay-behind findings
   requiring future-candidate disposition (GAP-001 no dedicated create verb, GAP-002 silent
   title-less task creation — a real data-integrity bug, GAP-007 per-call MCP subprocess latency), 1
   quay-ahead finding (GAP-003, native multi-state status model vs. gh's open/closed-only), 1 scoping
   note on the same axis (GAP-004), 2 competitor-side defects logged for completeness but not
   actionable within this experiment (GAP-005 gh propagation lag, GAP-006 backlog.md repeated-flag
   parsing bug), and 1 parity finding (GAP-008). Every one has an explicit disposition (see table
   above) — none silently fixed inline, none silently dropped.
3. **This milestone's findings DO feed a candidate for a future SELECT.** GAP-002 (silent
   title-less task creation) is a real correctness gap, not merely a style nit, and GAP-001/GAP-007
   are both concrete, evidence-backed candidates for a future capability-growth-typed milestone (a
   dedicated `task create` verb with a title-required guard; and/or a persistent-connection/
   fast-path mode for the CLI to close the latency gap against `backlog.md`). None of these are
   implemented in this milestone (out of scope, per "Explicitly OUT of scope" — measurement only).
   Recommend a future backlog row, tentatively `M-QUAY-CLI-CREATE-ERGONOMICS` or folded into an
   existing CLI-surface milestone family, SELECTed separately with its own charter.
