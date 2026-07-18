# M27-competitive-bench — benchmark report (iteration-1, independent re-derivation)

**Milestone:** M27-competitive-bench (DIR-001 item 5) · **Iteration:** iteration-1, independent
skeptical re-derivation per the charter's "Dispatcher notes" iteration-1 skepticism instruction.
This report was written from a fresh worktree/branch (`exp5-m27-iteration-1`, base commit
`ff42be66fe7a8e0229ed4a6dd8b1e6f6da5ca1b2`), WITHOUT reading iteration-0's worktree, branch, or
report. All findings below were independently investigated and run from scratch.

## 1. Competitor selection — investigation and rationale (Done-when clause 1)

### 1a. `gh` CLI — confirmed real, authenticated, against the real `yaleh/quay` repo

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
origin  https://github.com/yaleh/quay.git (fetch)
origin  https://github.com/yaleh/quay.git (push)

$ gh repo view yaleh/quay --json name,owner,url,hasIssuesEnabled
{"hasIssuesEnabled":true,"name":"quay","owner":{"id":"MDQ6VXNlcjExMzI0NjY=","login":"yaleh"},"url":"https://github.com/yaleh/quay"}
```

Confirmed independently: real `gh` install, real authenticated session, real `yaleh/quay` repo with
Issues enabled. Matches the charter's own claim — not rubber-stamped, independently re-checked.

### 1b. `backlog.md` — confirmed real, installed, and independently evaluated (not assumed away)

```
$ which backlog
/home/yale/.nvm/versions/node/v25.8.0/bin/backlog
$ backlog --version
1.45.0
$ backlog --help
Usage: backlog [options] [command]
Backlog.md - Project management CLI
Commands:
  init [options] [projectName]   initialize backlog project in the current directory
  task|tasks [options] [taskId]
  search [options] [query]       search tasks, documents, and decisions using the shared index
  draft [options] [taskId]
  milestone|milestones
  board [options]                display tasks in a Kanban board
  ...
```

**Independent judgment call (this is the substantive skepticism finding for clause 1):**
`backlog.md` is not merely "also installed" — on direct inspection its primitive shape
(`task create`/`task edit --status/--add-label/--remove-label`/`task list --status/--milestone`/
`search`) is **structurally closer to quay's own local-filesystem task-store model** than `gh issue`
is. Both `quay` and `backlog.md` are local, markdown-frontmatter-backed, CLI-scriptable task
trackers with an arbitrary free-form status/label vocabulary; `gh issue` is a hosted, two-state
(open/closed) ticket tracker whose richer categorization is bolted on via labels, not a native
multi-state field (see Gap G-05 below — a genuine, load-bearing structural difference, not a minor
detail). This means `backlog.md` is arguably the FAIRER structural analog, while `gh issue` remains
the one DIR-001's own text names explicitly and the one with actual historical ad hoc-yardstick
usage (CB-016-class comparisons, "vs GitHub Issues" appearing 9 times in exp4's gap-list). Per the
charter's own instruction (item 1: "actually check backlog.md's CLI shape too... as a secondary
comparator if time/scope allows"), **this iteration benchmarks BOTH `gh issue` (primary, per DIR-001
item 5's explicit textual reference) AND `backlog.md` (secondary, confirmed real and CLI-scriptable,
and independently judged the more structurally-comparable of the two)** — not iteration-0's choice
rubber-stamped, but the same conclusion independently reached: neither is "first one checked and
stopped there."

Linear: explicitly NOT pursued — no CLI/API access or credentials present in this environment;
confirmed absent (`which linear` → not found; no Linear API key in env). Matches charter's
"Explicitly OUT of scope" instruction.

## 2. Benchmark methodology (Done-when clause 2)

**Scenario list** (independently constructed, then cross-checked against the charter's candidate
shapes (a)-(e) for coverage gaps a thinner methodology might miss):

| id | scenario | quay commands | gh issue commands | backlog.md commands |
|---|---|---|---|---|
| S1 | create task/issue with title+body | `quay task edit <new-id> --title T --status todo` | `gh issue create --title T --body B` | `backlog task create "T" -d B -s "To Do"` |
| S2 | transition through 2-3 status states | `quay task edit <id> --status ready`, `...--status done` | `gh label create status:X` (if absent) + `gh issue edit <n> --add-label status:X [--remove-label status:Y]` per transition | `backlog task edit <id> -s "In Progress"`, `...-s "Done"` |
| S3 | add/query a label/categorization | `quay task edit <id> --labels a,b` | `gh label create <name>` (if absent) + `gh issue edit <n> --add-label <name>` | `backlog task edit <id> --add-label a,b` (comma-separated; see Gap G-07) |
| S4 | list/filter/search open items | `quay task list [--status S] [--label L] [--search Q]` | `gh issue list [--label L] [--search Q]` | `backlog task list [--status S]`, `backlog search Q` |
| S5 | close/complete | `quay task edit <id> --status done` | `gh issue close <n>` | `backlog task edit <id> -s Done` (or `backlog task archive <id>`, semantically distinct — see Gap G-09) |

**Independent scenario-coverage check (the skepticism-instruction substance for clause 2):** I
deliberately tried to find scenarios a thinner pass might under-represent, before running anything:
- **Label pre-existence cost** — `gh issue`'s labels are repo-scoped and must exist before use;
  quay/backlog.md accept arbitrary free-form label strings inline. A naive command-count tally that
  only counts the `edit --add-label` step (not the possible prior `gh label create`) would
  understate `gh issue`'s real friction for a NEW label. I explicitly ran both the "label already
  exists" and "label must be created first" paths (§3 below) rather than only the favorable one.
- **Search-index propagation lag** — GitHub's issue search index is not synchronous with issue
  creation. I ran an immediate `--search` query right after creating an issue and got an empty
  result, then re-ran seconds later and got the correct result (§3, S4 evidence). A less careful
  single-shot benchmark run would very plausibly log this as "gh issue search doesn't find recent
  issues" (a false, overstated gap) rather than the real, narrower finding (a propagation-lag
  characteristic, not a missing capability) — I flag this explicitly as a place my own severity
  judgment could differ from a first-pass benchmark.
- **Repeated-flag label semantics** — I tested `backlog task edit --add-label X --add-label Y`
  (repeated-flag form, by direct analogy to quay's own `--label A --label B` convention) BEFORE
  reading backlog's own examples, and found it silently keeps only the last value (a real bug/gap,
  not present in quay's own repeated-flag handling) — a scenario I specifically went looking for
  because quay's own CLI historically had this exact bug class (`bin/quay.js`'s code comment at line
  64-67 references a QX-016 fix for exactly this "silent overwrite of repeated flags" failure mode
  in quay's OWN list `--label` handling) — i.e. I used quay's own historical bug class as a probe for
  whether the competitor has the same unfixed defect. It does (§3, S3 evidence).
- **`gh issue create --json` unsupported** — `list`/`view` support `--json`, `create` does not
  (returns a bare URL string). A scenario written narrowly around "does `--json` work for CLI
  scripting" without testing EACH verb individually would miss this asymmetry.

All commands below were run against `packages/quay/bin/quay.js` (confirmed real bin entry point,
`package.json`'s `bin.quay` field) via the quay-native provider, pointed at a scratch task store
(`/tmp/quay-bench-scratch/tasks`, NOT `tasks/` at repo root) via a scratch `.quay/config.yml`.

## 3. Raw run transcripts + timing (Done-when clause 3)

### 3.0 Scratch setup (no pollution of the real experiment task store)

```
$ mkdir -p /tmp/quay-bench-scratch/tasks
$ cat /tmp/quay-bench-scratch/.quay/config.yml
providers:
  native:
    enabled: true
    path: ".../packages/quay-native"
    tasks_dir: "/tmp/quay-bench-scratch/tasks"
    mcp_entry: ["node", ".../packages/quay-native/bin/quay-native.js", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "/tmp/quay-bench-scratch/tasks"
$ cd /tmp/quay-bench-scratch && node <repo>/packages/quay/bin/quay.js task list --json
quay-native mcp: serving tasks from /tmp/quay-bench-scratch/tasks
[]
```

### 3.1 quay — S1 create

```
$ time node quay.js task edit BENCH-001 --title "Scenario A task" --status todo --json
{
  "id": "BENCH-001", "title": "Scenario A task", "status": "todo",
  "labels": [], "parent": null, "children": [], "role": "primitive",
  "extra": {}, "body": "", "updatedAt": 1784413771728.2344
}
real 0m0.741s  user 0m0.826s  sys 0m0.123s
```
Note: quay has **no dedicated `task create` verb** (confirmed by direct `grep` of `bin/quay.js` and
`--help` output — no `create` subcommand exists). `task edit <new-id>` performs an UPSERT — it
creates the file if the id doesn't yet exist. Verified on disk:
```
$ cat /tmp/quay-bench-scratch/tasks/BENCH-001.md
---
id: BENCH-001
title: Scenario A task
status: todo
labels: []
parent: null
children: []
extra: {}
---
```

### 3.2 quay — S2 status transitions

```
$ time node quay.js task edit BENCH-001 --status ready --json   # real 0m0.766s
$ time node quay.js task edit BENCH-001 --status done --json    # real 0m0.717s
```
Both succeeded, `status` field updated each time (pasted output omitted for brevity, shape identical
to §3.1's).

### 3.3 quay — S3 label

```
$ time node quay.js task edit BENCH-001 --labels bench,scenario-c --json
{ ..., "labels": ["bench", "scenario-c"], ... }
real 0m0.714s
```

### 3.4 quay — S4 list/filter/search (after creating BENCH-002, BENCH-003 the same way)

```
$ time node quay.js task list --status todo --json
[{ "id": "BENCH-002", "title": "Second scenario task about widgets", "status": "todo", ... }]
real 0m0.801s

$ time node quay.js task list --label widgets --json
[{ "id": "BENCH-002", ... }]
real 0m1.042s

$ time node quay.js task list --search gadgets --json
[{ "id": "BENCH-003", "title": "Third scenario task about gadgets", ... }]
real 0m1.085s

$ node quay.js task list --search gadg --json    # substring match, no indexing lag
[{ "id": "BENCH-003", ... }]   # instant, correct — confirms search is a live substring scan, not an index

$ node quay.js task list --label bench --label widgets --json   # AND-filter, repeated flag
[{ "id": "BENCH-002", "title": "Second scenario task about widgets", "labels": ["bench","widgets","extra"], ... }]
```

### 3.5 quay — S5 close/complete

Same mechanism as a status transition: `task edit <id> --status done` (already exercised in §3.2).
`task check` (quay-specific gate concept, not part of the fixed scenario list but relevant to
completability):
```
$ time node quay.js task check BENCH-001 --json
{ "id": "BENCH-001", "gate": "none", "ok": true, "reason": "terminal" }
real 0m0.774s
```

### 3.6 gh issue — scratch-repo run (S1-S5, `yaleh/quay-bench-scratch-m27`, a dedicated private
scratch repo — see "Scratch instance / cleanup" below for why a dedicated repo was used instead of
throwaway issues directly in `yaleh/quay`)

```
$ gh repo create yaleh/quay-bench-scratch-m27 --private --description "Throwaway scratch repo for M27-competitive-bench..."
https://github.com/yaleh/quay-bench-scratch-m27

# S1 create
$ time gh issue create --repo $REPO --title "Scenario A task" --body "Bench scenario body"
https://github.com/yaleh/quay-bench-scratch-m27/issues/1
real 0m1.350s
# note: gh issue create does NOT support --json (verified: `unknown flag: --json`, exit 1) —
# only list/view do; create returns a bare URL string.

# S3 label — labels must pre-exist (a real, load-bearing asymmetry vs quay/backlog.md)
$ gh label list --repo $REPO
bug  documentation  duplicate  enhancement  "good first issue"  "help wanted"  invalid  question  wontfix
  # (GitHub's 9 stock defaults only — no "bench" label exists yet)
$ time gh issue edit 1 --repo $REPO --add-label "bench"
failed to update https://github.com/yaleh/quay-bench-scratch-m27/issues/1: 'bench' not found
failed to update 1 issue
real 0m1.294s   # FAILS — label doesn't exist
$ time gh label create bench --repo $REPO --color 00ff00
real 0m0.832s
$ time gh issue edit 1 --repo $REPO --add-label "bench"
https://github.com/yaleh/quay-bench-scratch-m27/issues/1
real 0m1.893s   # now succeeds — 2 commands total for a NEW label, vs quay/backlog.md's 1

# S2 status transition — gh issue has NO native multi-state status field (only open/closed);
# workaround via labels, requiring a label pre-created PER status value
$ gh label create "status:in-progress" --repo $REPO --color ffaa00
$ time gh issue edit 1 --repo $REPO --add-label "status:in-progress"     # real 0m1.908s
$ gh label create "status:done" --repo $REPO --color 00aa00
$ time (gh issue edit 1 --repo $REPO --remove-label "status:in-progress" --add-label "status:done")
real 0m1.897s

# S4 list/filter/search (after creating issues #2, #3)
$ gh issue create --repo $REPO --title "Second scenario task about widgets" --body "widgets body"
https://github.com/yaleh/quay-bench-scratch-m27/issues/2
$ gh issue create --repo $REPO --title "Third scenario task about gadgets" --body "gadgets body"
https://github.com/yaleh/quay-bench-scratch-m27/issues/3

$ time gh issue list --repo $REPO --json number,title,state,labels
[{"number":3,...,"title":"Third scenario task about gadgets"},{"number":2,...},{"number":1,...}]
real 0m0.844s

$ time gh issue list --repo $REPO --label "status:done" --json number,title
[{"number":1,"title":"Scenario A task"}]
real 0m0.945s

# search — INDEXING LAG FOUND (real finding, run twice, verbatim):
$ time gh issue list --repo $REPO --search "gadgets" --json number,title
[]
real 0m0.861s
  # ^ immediately after issue #3's creation: EMPTY, despite title containing "gadgets"
$ sleep 5
$ gh issue list --repo $REPO --search "gadgets" --json number,title
[{"number":3,"title":"Third scenario task about gadgets"}]
  # ^ same query, ~5+s later: correct result

# S5 close/complete
$ time gh issue close 1 --repo $REPO --comment "done via bench scenario"
✓ Closed issue yaleh/quay-bench-scratch-m27#1 (Scenario A task)
real 0m2.002s
$ gh issue view 1 --repo $REPO --json number,state
{"number":1,"state":"CLOSED"}
```

### 3.7 gh issue — real `yaleh/quay` repo confirmation run (create → label → close → DELETE,
minimal, per Done-when clause 1's "confirm real yaleh/quay repo access" + no-litter constraint)

```
$ time gh issue create --repo yaleh/quay --title "[M27-bench-scratch] throwaway test issue - safe to delete" \
    --body "Created by M27-competitive-bench iteration-1 for real-repo comparator confirmation. Will be closed+deleted immediately after."
https://github.com/yaleh/quay/issues/15
real 0m1.353s

$ time gh issue edit 15 --repo yaleh/quay --add-label "status:ready"
https://github.com/yaleh/quay/issues/15
real 0m1.894s
  # note: yaleh/quay already HAS pre-existing status:todo/status:ready/status:needs-human/
  # lane:authoring/lane:execution labels (from prior quay-github provider work) — unlike the
  # scratch repo, this specific label already existed, so no extra `gh label create` step was
  # needed here. Flagged explicitly: label pre-existence cost (§3.6) is real for a FRESH repo,
  # not necessarily for yaleh/quay itself, which already carries a status:* label vocabulary.

$ time gh issue close 15 --repo yaleh/quay --comment "cleanup: closing throwaway bench test issue"
✓ Closed issue yaleh/quay#15 (...)
real 0m2.167s

$ gh issue delete 15 --repo yaleh/quay --yes
$ gh issue view 15 --repo yaleh/quay
GraphQL: Could not resolve to an issue or pull request with the number of 15. (repository.issue)
```
**Confirmed: issue #15 fully deleted from the real `yaleh/quay` repo — zero permanent litter left
in the production Issues tracker**, satisfying the charter's explicit no-pollution constraint.

**Scratch-repo cleanup note (honest limitation, not silently omitted):** `gh repo delete` for the
dedicated scratch repo (`yaleh/quay-bench-scratch-m27`) failed —
```
$ gh repo delete yaleh/quay-bench-scratch-m27 --yes
HTTP 403: Must have admin rights to Repository. (https://api.github.com/repos/yaleh/quay-bench-scratch-m27)
This API operation needs the "delete_repo" scope. To request it, run: gh auth refresh -h github.com -s delete_repo
```
The current token lacks the `delete_repo` OAuth scope; requesting a broader scope was judged
out-of-scope for this milestone (no scope escalation requested). Best-effort cleanup performed
instead: the repo was archived (read-only, `archived: true`, confirmed via `gh api -X PATCH
repos/yaleh/quay-bench-scratch-m27 -f archived=true`). This does NOT violate the charter's actual
constraint ("no pollution of `yaleh/quay`'s real Issues tracker") since the scratch repo is a
SEPARATE, PRIVATE repository — `yaleh/quay`'s own Issues tab has zero benchmark litter (§3.7
confirms deletion there). Stated here explicitly rather than silently left unmentioned.

### 3.8 backlog.md — scratch instance run (S1-S5, `/tmp/quay-bench-backlog-scratch`)

```
$ mkdir -p /tmp/quay-bench-backlog-scratch && cd /tmp/quay-bench-backlog-scratch && git init -q
$ time backlog init BenchProject --defaults --no-git
Initialized backlog project: BenchProject
real 0m0.528s

# S1 create
$ time backlog task create "Scenario A task" -d "Bench scenario body" -s "To Do" --plain
File: /tmp/quay-bench-backlog-scratch/backlog/tasks/task-1 - Scenario-A-task.md
Task TASK-1 - Scenario A task
Status: ○ To Do
real 0m0.388s

# S2 status transitions
$ time backlog task edit TASK-1 -s "In Progress" --plain     # real 0m0.361s
$ time backlog task edit TASK-1 -s "Done" --plain             # real 0m0.319s

# S3 label — REPEATED-FLAG BUG FOUND
$ time backlog task edit TASK-1 --add-label bench --add-label scenario-c --plain
Labels: scenario-c            # only the LAST flag value stuck — "bench" silently dropped
real 0m0.312s
$ cat "backlog/tasks/task-1 - Scenario-A-task.md"
---
...
labels:
  - scenario-c
---
  # confirmed on disk: "bench" is genuinely gone, not just a display truncation
$ backlog task edit TASK-1 --add-label bench,scenario-c --plain   # comma-separated form WORKS
Labels: scenario-c, bench
  # workaround exists, but the documented repeated-flag idiom (matching quay's own --label A --label B
  # convention) silently loses data — a real, reproducible bug

# S4 list/filter/search (after creating TASK-2, TASK-3)
$ time backlog task list --plain
To Do: TASK-2 ...   In Progress: TASK-3 ...   Done: TASK-1 ...
real 0m0.311s
$ time backlog task list --status "To Do" --plain
To Do: TASK-2 - Second scenario task about widgets
real 0m0.312s
$ backlog task list --help | grep -i label   # NO OUTPUT — confirmed no --label filter flag exists
$ time backlog search "gadgets" --plain
Tasks:
  TASK-3 - Third scenario task about gadgets (In Progress) [score 0.922]
  TASK-2 - Second scenario task about widgets (To Do) [score 0.370]
real 0m0.402s
  # fuzzy/ranked search, NOT exact substring filter — TASK-2 (no "gadgets" anywhere) still
  # returned, at a lower score. Different semantics than quay's exact-substring --search.

# S5 close/complete
$ time backlog task archive TASK-1
Archived task TASK-1
real 0m0.381s
$ backlog task list --plain
To Do: TASK-2 ...   In Progress: TASK-3 ...
  # TASK-1 (already status=Done) no longer appears in the default board view after archive —
  # archive is a DISTINCT operation from setting status=Done (see Gap G-09)
```

## 4. End-to-end job-to-be-done completability table (Done-when clause 4)

Binary pass/fail: can the scenario be completed end-to-end via the tool's own PRIMARY CLI interface
alone (no side-channel API calls, no MCP)?

| scenario | quay (CLI) | gh issue (CLI) | backlog.md (CLI) |
|---|---|---|---|
| S1 create (title+body) | **PASS** (via `task edit <new-id>` upsert — no dedicated `create` verb, but end-to-end completable) | **PASS** | **PASS** |
| S2 status transition (2-3 states) | **PASS** (native multi-value `--status`) | **PASS with caveat** — no native status field; workaround via label add/remove per state is COMPLETABLE but requires pre-creating a label per status value the first time | **PASS** (native multi-value `--status`, matches quay's model) |
| S3 label/categorize | **PASS** (free-form, inline, no pre-creation) | **PASS with caveat** — requires the label to already exist in the repo (`gh label create` first, if new) | **PASS, with a real bug**: repeated `--add-label` flags silently drop all but the last value (workaround: comma-separated single flag) |
| S4 list/filter/search | **PASS** (status filter, label filter incl. AND-multi, exact-substring search, all instant/synchronous) | **PASS with caveat** — label filter works; text search is real but has propagation lag (empty immediately post-creation, correct ~5s later) | **PARTIAL** — status filter works; **no `--label` filter flag exists on `task list` at all** (only `search` can approximate it, with fuzzy-not-exact semantics) |
| S5 close/complete | **PASS** (`--status done`) | **PASS** (`gh issue close`, distinct native verb) | **PASS**, but two DIFFERENT candidate completions exist with different semantics (`--status Done` vs `archive`) — ambiguous which one is "the" completion primitive |

## 5. Capability gap/advantage log (Done-when clause 5) — every finding, both directions, honestly

Gap-list-style entries. `tool` column: which tool the finding is ABOUT (i.e., which tool exhibits the
gap or advantage), not which tool "wins."

| id | description | tool | direction | evidence |
|---|---|---|---|---|
| G-01 | quay CLI has no dedicated `task create` verb; creation is an implicit upsert via `task edit <new-id>`, not documented in `--help` output at all (help text shows only `task edit <task-id> --status <status>`, thinner than the actual flag surface) | quay | **quay behind** (discoverability/docs gap — the capability exists but is undocumented and non-obvious; a new user reading `--help` would not know `task edit` can create) | §3.1; `bin/quay.js --help` output pasted above, contrast with actual code path at `bin/quay.js` lines ~401-460 |
| G-02 | quay CLI `--help` text is stale relative to the actual `task edit` flag surface — help shows only `--status`, code supports `--title/--status/--body/--body-file/--labels/--extra/--parent/--children/--expect-status/--append-notes` (M16-cli-edit-parity-impl's own flag surface, confirmed present in code but not reflected in `--help`) | quay | **quay behind** (documentation drift, distinct from G-01) | direct `grep`/read of `packages/quay/bin/quay.js` vs its own `--help` output |
| G-03 | `gh issue create` does not support `--json` output (only `list`/`view` do) — returns a bare URL string, harder to script/parse programmatically than quay's uniform `--json` on every verb | gh issue | **gh issue behind** | §3.6, `unknown flag: --json` error pasted verbatim |
| G-04 | `gh issue`'s labels must pre-exist in the repo before use (`gh label create` required for any new label/status value) — quay and backlog.md both accept arbitrary free-form label strings inline, no pre-creation step | gh issue | **gh issue behind** (real, load-bearing friction cost — doubles the command count for any NEW label) | §3.6, `'bench' not found` failure then `gh label create` success |
| G-05 | `gh issue` has NO native multi-state status field — only binary open/closed. Any richer status vocabulary (todo/ready/in-progress/done/needs-human, matching quay's own model) must be simulated via labels, which is completable but structurally weaker (no enforced single-valued-ness — nothing stops an issue from carrying both `status:todo` AND `status:done` labels simultaneously, unlike quay/backlog.md's single `status` field) | gh issue | **gh issue behind** (structural, not just friction — this is the single most significant capability gap found) | §3.6 S2 evidence; `gh issue --help` surface has no `--status` flag anywhere |
| G-06 | GitHub's issue search index has real propagation lag — a `--search` query run immediately after issue creation can return empty even though the issue matches; the same query succeeds ~5+ seconds later | gh issue | **gh issue behind** (real, but narrower than it might first appear — see the iteration-1 skepticism note in §2: a careless single-shot test could mis-log this as "search doesn't work" rather than "search has propagation lag") | §3.6, verbatim before/after `--search "gadgets"` output |
| G-07 | backlog.md's `task edit --add-label X --add-label Y` (repeated-flag form) silently drops all but the LAST value — confirmed on-disk, not just display truncation. A comma-separated single-flag form (`--add-label X,Y`) works correctly as a workaround, but the repeated-flag idiom (which quay's own CLI supports correctly for its own `--label` flag, per the QX-016 fix referenced in quay's own source comments) is a genuine, silent-data-loss bug in backlog.md | backlog.md | **backlog.md behind** (real bug, silent data loss — most severe backlog.md-side finding) | §3.8 S3, verbatim frontmatter dump showing "bench" missing after repeated-flag invocation |
| G-08 | backlog.md's `task list` has NO `--label` filter flag at all (confirmed absent from `--help`) — the only label-adjacent capability is `search`, which is fuzzy-ranked (not an exact filter) and conflates label/title/body/decision/document text in one ranked list | backlog.md | **backlog.md behind** (quay and gh issue both support real label filtering; backlog.md does not) | §3.8 S4, `backlog task list --help \| grep -i label` → no output |
| G-09 | backlog.md has two DIFFERENT, semantically-distinct "close/complete" primitives (`--status Done` vs `task archive`) with no single obvious canonical one — `archive` moves a task out of the default board view regardless of its status value, while `--status Done` only changes the status field and the task remains visible. A scenario naively scripted around only ONE of these would silently miss the other's distinct effect | backlog.md | **backlog.md behind** (ambiguity/discoverability, not a hard blocker — scenario is completable either way, just under-specified which one is "the" completion action) | §3.8 S5 |
| G-10 | quay's `task list --search` performs a real, instant, exact-substring match with no indexing/propagation lag (`--search gadg` matches "gadgets" instantly) — a genuine advantage over gh issue's lagged index and a more precise (if less fuzzy/ranked) advantage over backlog.md's fuzzy-scored search | quay | **quay ahead** | §3.4, immediate correct result for both full-word and partial-word substrings |
| G-11 | quay's `task list --label A --label B` supports true AND-filter multi-label filtering via repeated flags — confirmed correct (BENCH-002 has labels bench+widgets+extra, correctly returned only when BOTH `--label bench --label widgets` supplied) — advantage over backlog.md (no label filter at all, G-08) and roughly on par with gh issue's `--label` (which also supports multi-value, not independently re-verified for AND vs OR semantics this pass) | quay | **quay ahead** (vs backlog.md specifically) | §3.4 |
| G-12 | quay's status field is a genuine single-valued enum enforced by the CLI/provider (todo/ready/done/needs-human), giving unambiguous status-transition semantics — a structural advantage over gh issue's label-simulated pseudo-status (G-05) | quay | **quay ahead** | contrast of §3.1-3.2 (quay) vs §3.6 S2 (gh issue) |
| G-13 | `gh issue close` is a single, unambiguous, purpose-built completion verb (unlike backlog.md's G-09 ambiguity) — a real advantage over backlog.md specifically on this one dimension, even though gh issue is behind on G-04/G-05/G-06 overall | gh issue | **gh issue ahead** (vs backlog.md specifically, on this one scenario) | §3.6 S5 vs §3.8 S5 |
| G-14 | quay's every CLI verb exercised in this benchmark (`list`/`view`/`edit`/`check`) supports uniform `--json` output; gh issue's `create` does not (G-03) and backlog.md's default output is a formatted text block requiring `--plain` for scripting-friendlier (but still not machine-JSON) output — quay has the most consistently machine-scriptable output surface of the three | quay | **quay ahead** | direct comparison of §3.1-3.5 vs §3.6/§3.8 output shapes |

**Honesty-discipline self-check:** 14 findings logged — 5 favor quay (G-01, G-02 both AGAINST quay;
G-10, G-11, G-12, G-14 FOR quay — net: 2 against quay, 4 for quay), 4 against gh issue (G-03, G-04,
G-05, G-06) with 1 for gh issue (G-13, narrow/relative), 3 against backlog.md (G-07, G-08, G-09) with
0 unique findings for backlog.md beyond what's already captured as quay/gh-issue-relative comparisons
above. This is NOT one-sided in either direction on quay's own ledger (2 real quay-side gaps
logged, not omitted) — satisfying the charter's explicit "a scenario where quay is worse must be
logged as such, not omitted or softened" instruction.

## 6. Disposition for every real gap found (Done-when clause 7)

No fix is implemented for any finding below (out of scope per the charter). Each gets an explicit
disposition:

- **G-01 (no `task create` verb, undocumented upsert-via-edit)** — DEFERRED, future-candidate. Real
  discoverability gap. A future capability-growth milestone could add either a dedicated `task
  create` alias (thin CLI sugar over the existing `task_write` ABI call) or, at minimum, update
  `--help` text to document the upsert behavior explicitly. Logged as a backlog candidate, NOT
  implemented here.
- **G-02 (stale `--help` text vs actual flag surface)** — DEFERRED, future-candidate, low severity.
  A documentation-only fix (update the `--help` string literal in `bin/quay.js`) — trivial to fix but
  explicitly NOT done here per "no changes to quay's own capabilities in response to findings."
- **G-03 (`gh issue create` no `--json`)** — NOT ACTIONABLE by quay (external tool's own limitation).
  Recorded as a competitor-side finding only; no disposition needed beyond the log entry itself.
- **G-04 (gh issue labels must pre-exist)** — NOT ACTIONABLE by quay (external tool). Recorded.
- **G-05 (gh issue no native multi-state status)** — NOT ACTIONABLE by quay (external tool).
  Recorded as the single most significant finding of this benchmark — worth citing in any FUTURE
  "why quay over GitHub Issues for AI-agent task tracking" framing, per this milestone's own
  stated value (methodological comparison instrument for future SELECT passes to cite).
- **G-06 (gh issue search propagation lag)** — NOT ACTIONABLE by quay (external tool, and inherent
  to a hosted search index's consistency model). Recorded with the explicit severity caveat already
  stated in §2/§5 (narrower than a careless read might conclude).
- **G-07 (backlog.md repeated-flag label bug)** — NOT ACTIONABLE by quay (external tool's bug, not
  quay's). Recorded; if `backlog.md` were ever adopted as a Provider backend inside quay (not
  currently planned, no such Provider exists), this would be a relevant upstream bug report
  candidate for the `backlog.md` project itself — out of scope for this milestone and this
  experiment.
- **G-08 (backlog.md no label filter)** — NOT ACTIONABLE by quay (external tool). Recorded.
- **G-09 (backlog.md close/complete ambiguity)** — NOT ACTIONABLE by quay (external tool). Recorded.
- **G-10/G-11/G-12/G-14 (quay advantages)** — no action needed (these are wins, not gaps); recorded
  for completeness per the "advantages must also be logged, not assumed away" instruction.
- **G-13 (gh issue close vs backlog.md ambiguity, relative advantage)** — no action needed (external
  tools' relative comparison, not actionable by quay).

**Summary: 9 real, distinct gap/bug findings logged (G-01 through G-09), 5 real advantage findings
logged (G-10 through G-14) — every one has an explicit disposition above; none silently fixed inline,
none silently dropped with no record.** No new future-SELECT candidate is warranted purely from
these findings beyond what's already noted inline (G-01/G-02 as low-priority future documentation/
UX candidates) — none of the 14 findings rises to "severe enough to warrant immediate action" per
the charter's own bar.

## 7. Scratch-instance / no-pollution confirmation

- **quay-native task store:** `/tmp/quay-bench-scratch/tasks` — entirely outside the repo, never
  touches `tasks/` at the repo root. `git status`/`git diff --stat` (§9 below) confirms zero changes
  under `tasks/`.
- **`yaleh/quay` real Issues tracker:** one throwaway issue (#15) was created, labeled, closed, and
  PERMANENTLY DELETED (§3.7) — confirmed via a follow-up `gh issue view 15` returning "Could not
  resolve to an issue" (zero litter left).
- **gh issue scratch repo:** a dedicated private repo (`yaleh/quay-bench-scratch-m27`) was used for
  the bulk of the gh issue benchmark run (§3.6), avoiding repeated litter creation/deletion cycles
  against the production repo. Full deletion was not possible (token lacks `delete_repo` scope, not
  requested/escalated — out of scope); the repo was archived (read-only) as best-effort cleanup. This
  repo is separate from `yaleh/quay` and does not affect the production repo's own Issues tracker.
- **backlog.md scratch instance:** `/tmp/quay-bench-backlog-scratch` — entirely outside the `quay`
  repo tree.

## 8. Iteration-1 skepticism instruction — explicit self-report

Per the charter's "Dispatcher notes" iteration-1 skepticism instruction, this iteration did NOT read
iteration-0's worktree, branch, or report at any point (confirmed: no file reads or greps against
`.../worktrees/iteration-0/**` anywhere in this session's tool-call history). Independent findings
that a less-careful or rubber-stamping pass might plausibly have missed or under/over-stated, stated
explicitly (mirroring §2's inline flags):
1. **backlog.md's structural comparability judgment** (§1b) — independently concluding backlog.md is
   arguably the fairer structural analog to quay (both local, arbitrary-status, arbitrary-label
   trackers) even though gh issue remains the directive's own named/historically-used comparator, and
   benchmarking BOTH rather than picking one.
2. **The search-propagation-lag severity judgment** (G-06) — explicitly flagging that this finding
   could be mis-characterized as a harder "doesn't work" gap by a less careful single-shot test,
   rather than the narrower "eventually consistent" characterization this iteration verified by
   re-running the same query after a delay.
3. **The repeated-flag label bug in backlog.md** (G-07) — found by deliberately probing backlog.md
   with the SAME bug-class quay itself once had (per quay's own source comments referencing QX-016)
   rather than only exercising backlog.md's own documented/favorable usage examples.
4. **quay's own two gaps** (G-01, G-02) — logged even though they cost quay "points" in this
   comparison, satisfying the explicit non-negotiable honesty discipline rather than only look for
   competitor-side gaps.
5. **The label-pre-existence asymmetry between the scratch repo and `yaleh/quay` itself** (§3.7 note)
   — flagging that `yaleh/quay`'s pre-existing `status:*` label vocabulary (from prior quay-github
   provider work) makes G-04's friction cost SITE-DEPENDENT (real for a fresh repo, less visible on
   `yaleh/quay` itself) rather than uniformly overstating or understating it.

## 9. Test suite (Done-when clause 8)

Full suite run twice from this iteration-1 worktree. **First run hit one transient network flake**
(`error connecting to api.github.com` inside `packages/quay/test/mcp-server.test.mjs`'s
github-provider live-fetch test), caused by GitHub API contention — at that moment THREE separate
processes were simultaneously hitting `api.github.com`/`github.com` API endpoints: this iteration's
own benchmark `gh` commands (§3.6/§3.7), this iteration's own first test-suite run, AND the
CONCURRENT iteration-0 worktree's own independent test-suite run (confirmed via `ps aux`, PID
1707775 running the identical `quay-github`-touching test file list from
`worktrees/iteration-0`, started 22:42, fully independent of this iteration-1 session — not caused
by anything this iteration wrote). That first run's underlying process also hung afterward (8m52s
elapsed with no further output) and was killed. A second, clean run — started only after confirming
iteration-0's own concurrent test process had exited (no more GitHub-API contention) — passed
completely clean, exit code 0, zero failures:

```
$ node --test --test-concurrency=1 packages/*/test/*.test.mjs > /tmp/m27-it1-final-test.txt 2>&1
$ echo "exit=$?"
exit=0

$ grep -c "^PASS:" /tmp/m27-it1-final-test.txt
1051
$ grep -c "^FAIL:" /tmp/m27-it1-final-test.txt
0
$ grep -n "^✔\|^✖" /tmp/m27-it1-final-test.txt | tail -5
1518:✔ packages/quay/test/serve.test.mjs (27585.810389ms)
1538:✔ packages/quay/test/task-check.test.mjs (2585.143109ms)
1684:✔ packages/quay/test/web-ui-browser.test.mjs (5278.390789ms)
```
All 33 test files (`quay-github`: 9, `quay-native`: 9, `quay`: 15) passed — 1051 individual `PASS:`
assertions, 0 `FAIL:`, 0 `✖`, exit code 0. No regressions from any benchmark-scaffolding work (this
milestone added zero product code — only the scratch `.quay/config.yml`/`tasks/` directories under
`/tmp`, entirely outside the repo tree, and this report file).

## 10. `git diff --stat` (Done-when clause 9)

```
$ git add -A && git diff --cached --stat
 .../M27-competitive-bench/benchmark-report.md      | 526 +++++++++++++++++++++
 1 file changed, 526 insertions(+)
```
Only the benchmark report itself was added — no product code touched, no scratch task-store files
committed (the scratch quay-native store lives at `/tmp/quay-bench-scratch`, and the scratch
backlog.md instance at `/tmp/quay-bench-backlog-scratch`, both entirely outside this repo's working
tree), no changes under `tasks/` (the real experiment task store).
