# M29-cli-create-ergonomics — iteration-1 report (independent skeptical verification)

**Worktree:** `experiments/quay-perpetual-stream/milestones/M29-cli-create-ergonomics/worktrees/iteration-1`
**Branch:** `exp5-m29-iteration-1` (based on `exp5-outer-driver` HEAD `f7b3a0bf8aba98ee8e4d3f52eeedf93795a95fb4` at charter-authoring time; NOT merged to `exp5-outer-driver`/`master` from here)
**Independence discipline:** this iteration did NOT read iteration-0's worktree, branch, or
`report.iteration-0.md` at any point. All RED-test authorship, fix implementation, timing
measurement, and gap-hunting below were independently re-derived from the charter text and direct
source inspection.

## 1. Independent re-derivation of the mechanism

Confirmed directly against source in my own fresh worktree (not copied from the charter's prose,
though it matches):

- `grep -n 'sub === "' packages/quay/bin/quay.js` (pre-fix): only `list`, `view`, `edit`, `check`
  existed under `cmd === "task"` — no `create` verb (GAP-001 re-confirmed).
- `packages/quay/bin/quay.js` lines 401-467 (pre-fix): `task edit`'s handler builds `patch` from
  whichever flags are supplied, requires only "at least one patch-producing flag" (not `--title`
  specifically), and calls `client.taskWrite({ id, ...patch })` unconditionally — no existence
  check.
- `packages/quay-native/src/store.js` lines ~307-352: `write(id, {...})`, when `existingRaw ===
  null` (id does not exist yet), builds `frontmatter = { id, title, status, ... }` straight from
  the destructured `title` parameter. If the CLI never supplied `--title`, `title` is `undefined`
  at this point, and `YAML.stringify` (line 182) omits `undefined`-valued keys from the emitted
  frontmatter — this is GAP-002's exact mechanism, independently re-traced to the same three call
  sites the charter names.
- `packages/quay-github/src/github-client.js`'s `taskWrite` gates every field write on
  `Object.prototype.hasOwnProperty.call(fields, "title")` against an ALREADY-EXISTING issue — no
  create-via-write path exists there, so GAP-002 is native-provider/Core-CLI specific, confirmed.

## 2. HARD GATES

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md
```
Disposition: single file present, DIR-017, matches the charter's stated expectation ("as of last
DRAIN, DIR-017 is the only file present, correctly excluded pending human verification"). Excluded
from this milestone's scope for the same reason — no action taken on it here.

```
$ cat .manda/hub.addr
cat: .manda/hub.addr: No such file or directory
```
`.manda/hub.addr` does not exist in this worktree — inapplicable, no manda hub check performed
(consistent with a CLI-only, non-manda-dependent milestone).

```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```
Unexpected non-empty result: a dev server IS listening on :4173 on the host at the time of this
check (confirmed via `curl -s http://localhost:4173/ | head -5` — HTML page titled "Quay task list
— quay-native", i.e. some other process's `quay serve` instance, unrelated to this CLI-only
milestone and not started by this iteration). **This milestone is CLI-only with no Web UI surface
of its own** — the running server is pre-existing host state from an unrelated process (likely
another concurrent milestone/experiment activity on the same machine), not evidence of anything
this iteration built or needs to verify against.

```
$ git worktree add experiments/.../worktrees/iteration-1 -b exp5-m29-iteration-1 f7b3a0bf8aba98ee8e4d3f52eeedf93795a95fb4
Preparing worktree (new branch 'exp5-m29-iteration-1')
HEAD is now at f7b3a0b SELECT m29: M-QUAY-CLI-CREATE-ERGONOMICS (GAP-002 severity)

$ git status   # inside the worktree, before any edits
On branch exp5-m29-iteration-1
nothing to commit, working tree clean
```
Worktree created cleanly at the pinned base commit; all subsequent edits below were made inside
this worktree directory only.

## 3. RED — independent test, written from scratch

New file: `packages/quay/test/gap002-create-ergonomics.test.mjs` (13 tests, written without
reading iteration-0's test file — config-fixture shape pattern only cross-checked against the
pre-existing `packages/quay/test/cli.test.mjs`/`cli-edit-parity-conformance.test.mjs` fixtures for
correct `.quay/config.yml` field names, since a first draft of my own fixture used only
`provider.tasks_dir` and silently fell back to a wrong dir — see section 7 self-caught bug below).

Pre-fix RED run (`node --test packages/quay/test/gap002-create-ergonomics.test.mjs`), raw output:
```
X GAP-002 exact shape: task edit <new-id> --status todo (no --title) must not silently upsert a titleless record (1156.232094ms)
X variant: task edit <new-id> --body-only (no --title, no --status) on non-existent id must also refuse (1190.304045ms)
X variant: task edit <new-id> --labels-only (no --title) on non-existent id must also refuse (1006.771821ms)
X variant: task edit <new-id> --parent-only (no --title) on non-existent id must also refuse (1046.464387ms)
X variant: task edit <new-id> --extra-only (no --title) on non-existent id must also refuse (1110.258711ms)
OK variant: task edit <new-id> --append-notes-only (no --title) on non-existent id must also refuse (851.681635ms)
OK control: task edit <new-id> --title <t> --status todo on non-existent id is allowed (create-via-upsert with title) (800.471862ms)
OK control: task edit <existing-id> --status done (no --title) still works (guard is existence-gated only) (1731.57095ms)
X task create <id> --title <title> succeeds and produces a real title (376.804847ms)
OK task create <id> with no --title hard-fails (usage error, no provider call, no file written) (390.350723ms)
OK task create <id> with empty --title ("") hard-fails, not just missing --title (381.160066ms)
X --help lists task edit's full flag surface and the new task create verb (402.553564ms)
tests 12
pass 5
fail 7
```
(13th test, the deep-look empty-title case, was added AFTER the first fix pass — see section 5.)

Raw failure detail for the exact-shape reproduction (pre-fix):
```
AssertionError [ERR_ASSERTION]: expected non-zero exit refusing the titleless create; got exit=0, stdout={
    "id": "GAP2-EXACT-1",
    "status": "todo",
    "labels": [],
    "parent": null,
    "children": [],
    "role": "primitive",
    "extra": {},
    "body": "",
    "updatedAt": 1784419277531.5293
}
```
Note: no `title` key at all — matches the charter's stated symptom exactly (not a weaker/different
bug shape).

I also directly reproduced both symptom shapes named in the charter via raw shell invocation
(non-test, exploratory, own throwaway `/tmp` scratch store):
```
$ quay task edit GAP2-RAW-1 --status todo
GAP2-RAW-1: undefined [todo]     # non-JSON path: literal string "undefined"
$ quay task view GAP2-RAW-1 --json
{ "id": "GAP2-RAW-1", "status": "todo", ... }   # JSON path: no "title" key at all
```
Both confirmed independently, matching the charter's mechanism description verbatim.

## 4. Variant reproduction shapes tried (charter items b/h)

Beyond the exact `--status`-only shape M27 used, I independently tried, on a fresh non-existent id
with no `--title`:
- `--body`-only -> RED pre-fix (silently created, titleless)
- `--labels`-only -> RED pre-fix
- `--parent`-only -> RED pre-fix
- `--extra`-only -> RED pre-fix
- `--append-notes`-only -> already GREEN pre-fix (this path has its own pre-existing `taskGet`/"no
  such task" guard, unrelated to my fix — confirmed by reading that code branch directly)
- `--expect-status`-only (added later, see section 7) -> already GREEN pre-fix, because
  `store.js#write()`'s own CAS logic fails closed for a non-existent id regardless of title
  (`ConflictError` thrown when `expectedStatus !== undefined` and `existingRaw === null`) —
  confirmed this is a pre-existing, independent guard, not something my fix needed to add.

This confirms the pre-fix bug was genuinely present across every non-title flag combination that
reaches the generic `taskWrite` path (not just the one shape M27 happened to test), i.e. a
narrowly-patched `--status`-only fix would NOT have been sufficient — a `--body`-only or
`--labels`-only caller would have remained silently vulnerable.

## 5. GREEN — combined fix, implemented independently

`packages/quay/bin/quay.js` changes (all inside the `cmd === "task" && sub === "edit"` and new
`cmd === "task" && sub === "create"` handlers):

1. **`task edit` guard**: before the final `client.taskWrite({ id, ...patch })` call (the
   non-`--append-notes` path — append-notes already had its own existence check), added:
   ```js
   if (patch.title === undefined || String(patch.title).trim() === "") {
     const existing = await client.taskGet(id);
     if (!existing) {
       console.error(`quay task edit: task ${id} does not exist yet; creating a new task requires --title (or use 'quay task create')`);
       process.exitCode = 1;
       return;
     }
   }
   ```
   This is existence-gated (an existing task can still be edited with no `--title`, unaffected)
   and covers every non-title flag combination, because the precondition is
   (missing-or-empty-title, non-existent-id) alone — independent of which other flags accompany it.

2. **New `task create <id> --title <title> [...]` verb**: parses `--title` first, hard-fails
   (usage error, `process.exitCode = 1`, **return before `withProvider()` is ever called** — no
   provider connection, no MCP subprocess spawned, no file written) if `--title` is missing or
   empty-string. Supports `--status/--body/--body-file/--labels/--parent/--children/--extra/--json`
   for feature parity with `task edit`'s own flag surface (mutual-exclusion check for
   `--body`/`--body-file` mirrored from `task edit`).

Post-fix GREEN run, raw output:
```
OK GAP-002 exact shape: task edit <new-id> --status todo (no --title) must not silently upsert a titleless record (1549.253992ms)
OK variant: task edit <new-id> --body-only (no --title, no --status) on non-existent id must also refuse (1551.191009ms)
OK variant: task edit <new-id> --labels-only (no --title) on non-existent id must also refuse (1686.074571ms)
OK variant: task edit <new-id> --parent-only (no --title) on non-existent id must also refuse (907.096664ms)
OK variant: task edit <new-id> --extra-only (no --title) on non-existent id must also refuse (810.939979ms)
OK variant: task edit <new-id> --append-notes-only (no --title) on non-existent id must also refuse (867.747751ms)
OK deep-look: task edit <new-id> --title "" (empty string) --status todo on non-existent id must also refuse, not just missing --title (870.396376ms)
OK control: task edit <new-id> --title <t> --status todo on non-existent id is allowed (create-via-upsert with title) (844.695965ms)
OK control: task edit <existing-id> --status done (no --title) still works (guard is existence-gated only) (1733.959559ms)
OK task create <id> --title <title> succeeds and produces a real title (825.039514ms)
OK task create <id> with no --title hard-fails (usage error, no provider call, no file written) (356.225528ms)
OK task create <id> with empty --title ("") hard-fails, not just missing --title (451.784487ms)
OK --help lists task edit's full flag surface and the new task create verb (455.230733ms)
tests 13
pass 13
fail 0
```

## 6. G-02 fix — stale `--help` text

Pre-fix `node packages/quay/bin/quay.js --help` Usage block listed only `quay task edit <task-id>
--status <status> [--json]` — confirmed stale (missing `--title/--body/--body-file/--labels
/--extra/--parent/--children/--expect-status/--append-notes`, all already implemented since
M16-cli-edit-parity-impl), reproducing the charter's G-02 finding independently.

Fix: rewrote the Usage block and added two new "Options for task create:" / "Options for task
edit:" sections listing the full real flag surface (including the new `--title`-mandatory-for-create
semantics text) and an example line for `task create`. New test (`--help lists task edit's full
flag surface and the new task create verb`, part of the same file) asserts every flag string
literal (`--title`, `--body`, `--body-file`, `--labels`, `--extra`, `--parent`, `--children`,
`--expect-status`, `--append-notes`) and the string `task create` all appear in `--help` output.
GREEN, shown in section 5 above (last line).

## 7. Skepticism self-report — what I independently verified vs. assumed, and divergences found

**Self-caught bug in my own scratch-fixture setup** (not a product-code bug): my first draft of
`makeWorkspace()` in the new test file set only `provider.tasks_dir` in the generated
`.quay/config.yml`, mirroring what I assumed was the config shape. When I manually shell-reproduced
GAP-002 outside the test harness for the raw-output capture in section 3, I discovered
`quay-native mcp: serving tasks from .../worktrees/iteration-1/tasks` — i.e. it silently fell back
to a worktree-relative default path, NOT my scratch dir, because
`packages/quay/src/provider-env.js`'s `resolveProviderEnv()` only reads `provider.env` entries, not
`provider.tasks_dir` directly. This briefly wrote 8 stray files into **this worktree's own
checked-out `tasks/` directory** (a git worktree of the shared repo — NOT the shared repo root's
`tasks/`, confirmed via `git -C /home/yale/work/quay status --short -- tasks/` returning empty
throughout). Caught immediately, cleaned via `git clean -fd tasks/` inside the worktree, and the
test fixture was corrected to also set `provider.env.QUAY_NATIVE_TASKS_DIR` explicitly (the pattern
actually used by the existing `cli.test.mjs` fixture, cross-checked after the fact). Re-ran RED
with the corrected fixture and got identical results. **Real repo-root `tasks/` was never touched
at any point** (confirmed clean via `git -C /home/yale/work/quay status --short -- tasks/` both
before and after this incident, and again at report time).

**Genuine divergence found, independent of iteration-0**: an **empty-string `--title`** (`task
edit <new-id> --title "" --status todo`) is a DIFFERENT shape than "no `--title` at all" — a naive
guard checking only `patch.title === undefined` (which is what I first implemented, matching the
literal charter wording "no `--title` supplied") lets this slip through, because `""` is a
*defined* value. I found this by actively probing beyond my own initial 12 tests (charter item h:
"actively look for a code path your fix might miss"), confirmed it via raw shell reproduction
(wrote `title: ""` to the scratch store, non-empty file, valid YAML — not literally GAP-002's "no
title key" symptom, but the same class of defect: a newly-created task record with a useless/junk
title, which the fix's own stated intent — "refuse... instead of silently upserting a titleless
record" — should also cover). Tightened the guard to `patch.title === undefined ||
String(patch.title).trim() === ""` and added a 13th test (`deep-look: ...`) asserting this is
refused and writes no file. This mirrors `task create`'s own already-planned empty-title rejection
(item was explicit in the charter for the `create` verb but NOT explicitly spelled out for the
`edit` guard's title-emptiness case — I extended it there too, for consistency and because the
underlying defect class is identical). **This is exactly the kind of divergence the iteration-1
skepticism instruction exists to catch**: a fix that closes the literally-named reproduction path
while leaving a sibling shape (empty string vs. undefined) still silently vulnerable.

**Explicitly checked and NOT extended further** (considered and rejected, not silently skipped):
- `task edit <existing-id> --title "" ...` (blanking an EXISTING task's title) — deliberately left
  unguarded. This is existence-gated by design (the guard only fires when `existing === null`);
  blanking an already-existing record's title is a different, pre-existing, out-of-charter-scope
  editing behavior (the charter's Done-when metric is specifically about the create-via-upsert
  path, not general edit-field-validation hardening), and changing it here would be scope creep
  beyond GAP-002's stated mechanism.
- `task create <id> --title "Real Title"` (no `--status`) prints `[undefined]` in its non-JSON
  confirmation line. Verified via direct reproduction this is NOT a new bug my `task create` verb
  introduced — `task edit <new-id> --title X` (no `--status`) already has byte-identical behavior
  pre-fix (confirmed via direct shell repro), because `store.js#write()` has no default status.
  Logging this as a pre-existing, out-of-scope observation, not fixing it here (the charter's
  metric Y only concerns `title`, never `status`).
- `--expect-status`-only on a non-existent id: independently confirmed this was ALREADY refused
  pre-fix (via `store.js`'s own pre-existing "no existing record to CAS against, fail closed" logic
  for `expectedStatus`), unrelated to my new guard — no double-guard conflict, no regression.

**GAP-007 timing**: independently re-measured from scratch (not copied from any prior report) —
see section 8. Used my own scratch `backlog.md` init (`backlog init --defaults`, non-interactive),
my own scratch quay workspace, and a fresh timing loop; did not reuse any fixture path or number
from iteration-0 (never read).

**`git diff --stat` scope claim**: independently re-ran (section 9) rather than trusting any prior
claim — confirmed scope is `packages/quay/bin/quay.js` + the new test file only.

**Full test suite**: independently re-ran, pre-fix and post-fix, from a completely fresh
`node --test` invocation in my own worktree (section 9/10) — not copied from any prior pasted output.

## 8. GAP-007 re-measurement (independent)

Method: same class of measurement the charter/M27 used — a handful of `task edit`/`task view`
calls via the real Core CLI subprocess-per-call path, against a scratch native-provider store,
compared to `backlog task edit`/`backlog task` against a scratch `backlog.md` v1.45.0 project
(`backlog init --defaults`, non-interactive, own throwaway git-tracked scratch dir — never the real
quay repo).

Raw timing (10-call loop, `time` wall-clock, both post-fix):
```
=== quay task edit x10 ===
real    0m10.202s   (approx 1.020s/call)

=== backlog task edit x10 ===
real    0m3.262s    (approx 0.326s/call)

ratio: 3.13x (quay slower per call)
```
(An earlier 5-call pass gave 2.25x for edit / 1.95x for view — both passes independently confirm
quay's per-call MCP subprocess handshake is materially slower than backlog.md's direct
local-filesystem CLI, same finding class M27 reported, ~2.6x. My two independent passes bracket
that number (2.25x-3.13x), consistent with small-sample wall-clock variance, not a contradiction.)

**Disposition**: RE-CONFIRMED, NOT FIXED, per the charter's explicit judgment call. Items 1-2 (the
GAP-002/GAP-001 fix) add exactly one extra `taskGet` read on the create-via-edit non-title path
only — this does not materially change the measured per-call latency class (the dominant cost is
the fresh Node process + MCP handshake per invocation, not the number of ABI calls within a single
invocation). Future-candidate disposition unchanged from the charter: a persistent-daemon or
connection-reuse redesign of `provider-client.js`'s `connectProvider()` spawn-per-call model would
be required to close this gap, and remains explicitly out of scope for this milestone
(architecturally broad, would dilute this milestone's correctness-fix focus, per the size-gauge
judgment call already made at charter-authoring time — my independent re-measurement did not
surface anything that would change that judgment).

## 9. `quay-native`'s own id-fallback observation (NOT fixed — logged per charter)

Independently re-confirmed via direct source read: `packages/quay-native/bin/quay-native.js` lines
157-175, its own separate `task create <id> [--title ...]` verb defaults `title: flags.title ??
id` — falls back to the id string as a fake title, never `undefined`. This is a DIFFERENT bug shape
than GAP-002 (silently using the id as a placeholder title vs. silently omitting the field
entirely) and is confirmed NOT covered by `packages/quay-native/test/create-validation.test.mjs`
(only tests missing/empty `<id>`, never missing `--title`). Per the charter, this is explicitly OUT
OF SCOPE for this milestone (the fix here targets `packages/quay/bin/quay.js` exclusively) — logged
here as a future-candidate observation, not fixed. No code change was made to
`packages/quay-native/` at any point in this iteration (confirmed by `git diff --stat`, section 10
below).

## 10. Full test suite — pre-fix and post-fix (independently re-run)

Pre-fix baseline (`node --test --test-concurrency=1 packages/*/test/*.test.mjs`), full raw summary:
```
tests 46
pass 38
fail 8
```
8 failures = my 7 own new RED-test failures (section 3, expected, confirms RED) + 1 pre-existing
`serve-github.test.mjs` failure (see below — confirmed unrelated to this milestone).

Post-fix full-suite run 1:
```
tests 47
pass 45
fail 2
```
Failures: `packages/quay/test/provider-abi-conformance.test.mjs` and
`packages/quay/test/serve-github.test.mjs`.

Post-fix full-suite run 2 (immediate re-run, isolated re-check per Done-when clause 6's "confirmed
clean on an isolated re-run, not silently waved off"):
```
tests 47
pass 46
fail 1
```
Only `serve-github.test.mjs` failed on the second run — `provider-abi-conformance.test.mjs` passed
cleanly both in this second full-suite run AND in a standalone isolated run
(`node --test packages/quay/test/provider-abi-conformance.test.mjs`, 1/1 pass, 58s). This confirms
`provider-abi-conformance.test.mjs`'s single failure on run 1 was a transient concurrency-class
flake — this machine had a concurrent `iteration-0` worktree/process actively running its own
`node --test` suite against the same live `yaleh/quay` GitHub repo fixtures at the same wall-clock
time (confirmed via `ps aux` showing simultaneous `node --test` processes rooted in both
`worktrees/iteration-0` and `worktrees/iteration-1`), matching the exact root-cause class the
charter already documents ("concurrent live-fixture GitHub tests racing across iteration
worktrees").

`serve-github.test.mjs`'s failure (`GET / body contains the real GitHub-backed task id gh-3` /
"...gh-3's real live title") was investigated further and found to be a **different, pre-existing,
non-regression root cause**: the live `yaleh/quay` GitHub repo now has 28 total issues (`gh issue
list -R yaleh/quay --state all --limit 100` -> 28), and the test's `GET /` (list, unfiltered) check
expects `gh-3` to appear on the default rendered page — but a direct probe (custom throwaway
script, `packages/quay/src/serve.js`'s `startServer()` against the same live repo) shows the
rendered list page currently contains only `gh-9` through `gh-29` (the 20 most recent), not `gh-3`.
Issue #3 (`gh-3`) is independently confirmed still OPEN with the correct `status:ready` label via
`gh issue view 3 -R yaleh/quay --json state,title,labels`, and `GET /task/gh-3` (the detail-page
probe, a separate assertion in the same test) PASSES — only the list-page inclusion assertion
fails. **Confirmed this is NOT caused by this milestone's changes**: reproduced byte-identically
(`FAIL: GET / body contains the real GitHub-backed task id gh-3` / `FAIL: ...real live title`) on
a completely separate, pristine, throwaway worktree checked out directly at the unmodified base
commit `f7b3a0bf8aba98ee8e4d3f52eeedf93795a95fb4` (`git worktree add /tmp/quay-baseline-check
f7b3a0b...`, fresh `npm install`, same test run) — i.e. this is a real environmental drift in the
shared live-fixture GitHub repo (issue count has grown past whatever page/limit
`serve-github.test.mjs`'s fixture assumed when it was last calibrated), present identically whether
or not any of this milestone's code changes are applied. Disposition: pre-existing, out-of-scope,
not a regression introduced by this milestone — the isolated pristine-worktree re-run is the
"confirmed clean [pre-fix] on an isolated re-run" evidence Done-when clause 6 asks for regarding
this specific failure class (it is not flaky — it fails consistently both pre-fix and post-fix, for
an unrelated live-data reason, not a race).

## 11. Real-repo litter check

```
$ git -C /home/yale/work/quay status --short -- tasks/
(empty)
```
The real repo-root `tasks/` directory is unchanged. (This worktree's own checked-out copy of
`tasks/` briefly had 8 stray files from a self-caught scratch-fixture bug, section 7 — cleaned via
`git clean -fd tasks/` inside the worktree before this report was finalized; re-confirmed clean via
`git status --short tasks/` inside the worktree at report time, and was never the real repo-root
path in the first place.)

## 12. `git diff --stat` (independently re-run)

```
$ git diff --stat f7b3a0bf8aba98ee8e4d3f52eeedf93795a95fb4 -- . ':!experiments/quay-perpetual-stream/milestones/M29-cli-create-ergonomics/worktrees'
 packages/quay/bin/quay.js | 108 +++++++++++++++++++++++++++++++++++++++++++++-
 1 file changed, 106 insertions(+), 2 deletions(-)

$ git status --short
 M packages/quay/bin/quay.js
?? packages/quay/test/gap002-create-ergonomics.test.mjs

$ git add -A packages/ && git diff --stat --cached
 packages/quay/bin/quay.js                          | 108 ++++++++++-
 .../quay/test/gap002-create-ergonomics.test.mjs    | 209 +++++++++++++++++++++
 2 files changed, 315 insertions(+), 2 deletions(-)
```
Confirmed scope: `packages/quay/bin/quay.js` (the fix) + `packages/quay/test/gap002-create-ergonomics.test.mjs`
(the new independent test file) + this report. Neither `packages/quay-native/src/store.js` nor
`packages/quay-github/src/github-client.js` was touched — confirmed by their absence from the diff
stat above.

## 13. Binary Done-when — status against all 9 clauses

1. `[x]` **Pre-fix baseline** — section 10, raw output pasted (46 tests, 38 pass, 8 fail; 7 = my
   own RED tests as designed, 1 = pre-existing unrelated `serve-github.test.mjs` environmental
   drift).
2. `[x]` **RED** — section 3, raw failing output pasted, reproducing GAP-002's exact mechanism (no
   `title` key, literal `"undefined"` string in non-JSON output) independently.
3. `[x]` **GREEN — combined GAP-002+GAP-001 fix** — section 5, raw passing output pasted (13/13
   GREEN); `git diff --stat` (section 12) confirms neither `store.js` nor `github-client.js`
   modified.
4. `[x]` **G-02 fix** — section 6, help text updated, new assertion test passes (part of the 13/13
   GREEN set in section 5).
5. `[x]` **GAP-007 re-measurement** — section 8, independently re-measured (2.25x-3.13x across two
   passes, consistent with M27's ~2.6x), future-candidate disposition recorded, no code change made
   (section 12 confirms diff scope excludes any latency-architecture file).
6. `[x]` **Post-fix full suite** — section 10, two independent full-suite runs pasted; the one
   transient flake (`provider-abi-conformance.test.mjs`, run 1 only) confirmed clean on immediate
   isolated re-run (run 2, plus standalone single-file run); the one persistent failure
   (`serve-github.test.mjs`) root-caused to a genuine, pre-existing, unrelated live-GitHub-repo
   environmental drift, confirmed identical on a pristine unmodified-base-commit worktree — not a
   regression from this milestone's changes, not silently waved off.
7. `[x]` Written report exists — this file,
   `experiments/quay-perpetual-stream/milestones/M29-cli-create-ergonomics/report.iteration-1.md`.
8. `[x]` `git diff --stat` — section 12, confined to `packages/quay/` + this report; explicitly not
   empty (as expected — this is a real product-code milestone, unlike M25-M28).
9. `[x]` **No real-repo litter** — section 11, confirmed via `git -C /home/yale/work/quay status
   --short -- tasks/` returning empty; self-caught-and-cleaned stray-file incident in the
   WORKTREE's own (not the real repo root's) `tasks/` copy documented transparently in section 7,
   not hidden.

All 9 Done-when clauses independently satisfied from this fresh worktree.

## 14. Commit

Work committed on `exp5-m29-iteration-1` inside this worktree (not merged to `exp5-outer-driver` or
`master` from here, per instructions).
