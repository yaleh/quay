---
id: gap-in-round-suite-rerun-never-executed-in-production
title: The in-round rerun of red suite files has never run in production; this
  repo never declared loop.rerun_command
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
  role: primitive
---
## Proposal
`gap-fan-in-suite-red-no-in-round-rerun-of-red-files` (done) shipped an in-round rerun of the suite files that failed. It has three outcomes: `rerun-green`, `rerun-red`, `rerun-not-evaluated`. The rerun command is project-declared: `loop.rerun_command` in `.quay/config.yml`, read in `plugin/scripts/worker-fan-in.ts` (around lines 162-301). That task's own AC8 (the production-carrier reading) was left unticked as "待外部" (awaiting external), with the note: "本仓库侧的声明行（`.quay/config.yml` 的 `loop.rerun_command`，该文件 gitignored）尚未铺出" (this repo's declaration line in the gitignored `.quay/config.yml` has not been rolled out yet).

Production reading on 2026-10-11, from `.quay/worker-outcome.jsonl`, `mechanical_fan_in.rerun`, 2026-10-02 → 2026-10-11:
- 84/84 records are `rerun-not-evaluated`.
  - 68 have reason `no-rerun-command-declared`.
  - 16 have reason `no-failing-lines-in-suite-log`.
- 0 are `rerun-green` and 0 are `rerun-red`.
- The current main-checkout `.quay/config.yml` `loop:` section has no `rerun_command` key.

So the mechanism is implemented and its tests are green, but it has never run in production (CLAUDE.md hard rule 4, corollary 3). Meanwhile the suite false-red is the largest single reason class for needs-human→todo retreats (33 of 138 retreat records in `gate-events.jsonl`).

## Plan
1. Determine this repo's per-file rerun argv, using `scripts/test.sh`'s existing per-file entry. Its header comment is the source of truth. Use the `{worktree}` and `{files}` whole-element placeholders, and do not concatenate strings.
2. Find where `.quay/config.yml` is provisioned. It is gitignored, so the declaration must reach both the main checkout and task worktrees through whatever mechanism provisions the rest of `loop:`, or through the `quay init` / config template if that is the source. Record which one, and why.
3. Investigate the 16 `no-failing-lines-in-suite-log` records. List them, and say whether the parser misses a real failing-line shape or the logs truly had none. Report only; if it is a parser defect, file a follow-up task rather than widening this one.

## Findings

### Plan 1 — this repo's per-file rerun argv

`scripts/test.sh`'s header comment (the named source of truth) documents the per-file entry as:

```
scripts/test.sh <file...>                         # just the given file(s), same default concurrency
```

so the declared argv template is:

```yaml
rerun_command: ["bash", "{worktree}/scripts/test.sh", "{files}"]
```

- `{worktree}` is substituted per argv element; `{files}` is a **whole-element** placeholder that is *spliced* (one element → N elements), never concatenated — `applyFileTemplate` (`worker-fan-in.ts`) is literally `if (a === "{files}") out.push(...vars.files)`. That is why the template's third element is the bare `{files}`: an embedded form such as `--files={files}` would be left as a literal.
- The failing paths come from the suite log, repo-relative (`parseSuiteLogFailures`; absolute tokens are mapped through `path.relative(root, …)`), and `scripts/test.sh` `cd`s to its own repo root (`scripts/test.sh:237-238`) before doing anything else. So the spawn cwd — which `mechSh` leaves unset, i.e. it inherits the driver's cwd — cannot misplace them.
- Budget: `RERUN_TIMEOUT_MS = 300_000` (`worker-fan-in.ts:1655`). Measured wall for one named file: **32s** (the per-file entry also runs the full static-check set, ~25s of fixed overhead) ⇒ a handful of named files fits with wide margin.

Read through the real production path (`readLoopFanInContract` + `resolveRerunCommand`, imported from `plugin/scripts/worker-fan-in.ts`, no fixture):

```
declared : {"state":"declared","value":["bash","{worktree}/scripts/test.sh","{files}"]}
resolved : {"kind":"run","argv":["bash","/data/home/yale/work/quay/scripts/test.sh","plugin/test/a.test.mjs","packages/quay/test/b.test.mjs"]}
```

### Plan 2 — where `.quay/config.yml` is provisioned

**Answer: the committed `.worktreeinclude` manifest + `scripts/worktree-include.sh`, invoked as step 2 of `plugin/scripts/dispatch-worktree-setup.sh` — a byte copy of the PRIMARY checkout's `.quay/config.yml`. NOT the `quay init` template.**

Evidence chain, in the order that fixes the answer:

1. `.quay/config.yml` is gitignored (`git check-ignore -v` ⇒ `.gitignore:515:/.quay/config.yml`). No branch carries it, so there is no commit-shaped deployment surface at all — which is exactly why the Plan asks the question.
2. `.worktreeinclude` (committed) declares `/.quay/config.yml`; `worktree-include.sh` copies it and **post-conditions from disk** (exit 1 + names any absent file), so "provisioned" is a claim about the worktree's contents rather than about `cp` having been issued.
3. The copy **source is the primary checkout** — observed live while provisioning this worktree (`worktree-include: copied .quay/config.yml -> <wt>/.quay/config.yml`), and the worktree's copy stayed at the **pre-edit** content until refreshed.
4. `quay init` is **not** the source: `plugin/skills/init/SKILL.md` ("The `loop:` fan-in contract keys") states that these argv-list keys are deliberately not written by init on either arm — the engine's version table carries only the keys the validator requires (`board`, `gates`) plus `doc_surfaces` and the fork baseline. There is no template line to change.

⇒ The declaration is written into the **main checkout's** `.quay/config.yml`; every worktree then receives it by copy. **Non-obvious consequence, recorded because it is the trap:** the direction is one-way (main → worktree), so deploying this key is **not a git operation**. It took effect the moment the main-checkout file was written; this task's fan-in ff-merge carries nothing for it. There is no diff to review and nothing to find in `git log`.

Propagation verified in both directions:

- a worktree **created after the edit** and provisioned by `dispatch-worktree-setup.sh` carries the key and resolves it against its own path:
  `147:  rerun_command: ["bash", "{worktree}/scripts/test.sh", "{files}"]` /
  `{"kind":"run","argv":["bash","/data/…/zz-provision-proof-rerun-command/scripts/test.sh","plugin/test/x.test.mjs"]}`;
- the same probe against the **pre-edit** worktree copy yields `{"state":"absent"}` → `{"kind":"not-evaluated","reason":"no-rerun-command-declared"}` — i.e. it reproduces the exact production reading in the Proposal. That is the negative control: the probe discriminates, rather than returning the new value unconditionally.
- already-existing worktrees converge without re-provisioning, because `scripts/test.sh` re-refreshes `<worktree>/.quay` from the main checkout on every real run (`refresh-worktree-quay.sh`).

**Observation, deliberately NOT filed here (outside this task's `## Touches`, which is 2 files):** the `quay init` skill's loop-contract table documents only 3 of the 4 declared keys — `suite_runner` / `scoped_command` / `doc_check_command`; `rerun_command` is absent from that table in `plugin/skills/init/SKILL.md`. A project initialised from that table never learns the key exists, which reproduces *this task's* defect one level up (a capability that is implemented and tested but declared nowhere, so it never runs in production). Recorded, not widened into.

### Plan 3 — the 16 `no-failing-lines-in-suite-log` records

**Finding: not a parser defect. In all 16 cases the red round genuinely had no failing test file — it was a static-check (gate) red with zero tests run.** The parser is not missing a failing-line shape.

The 16 records (`ts` = the `worker-outcome.jsonl` record; "paired round" = the durable round in `.quay/verification-round.jsonl` for the same task with the greatest `startedAt` ≤ `ts`):

| # | ts | task | paired round startedAt | gate | tests | fail | perFile |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-02T02:23:44.760Z | `gap-goal-round-records-unreachable-drafts` | 2026-10-02T02:22:59.812Z | `static-check` | 0 | 0 | 0 |
| 2 | 2026-10-03T08:08:18.806Z | `gap-goal-branch-reaper-accepts-preview-serve` | 2026-10-03T08:07:56.935Z | `static-check` | 0 | 0 | 0 |
| 3 | 2026-10-03T08:10:14.101Z | `gap-goal-branch-ff-merge-source-param` | 2026-10-03T08:09:37.777Z | `static-check` | 0 | 0 | 0 |
| 4 | 2026-10-03T08:10:37.673Z | `gap-goal-branch-antidrift-two-line-base` | 2026-10-03T08:10:16.069Z | `static-check` | 0 | 0 | 0 |
| 5 | 2026-10-03T08:19:18.722Z | `gap-goal-branch-data-model-and-lifecycle` | 2026-10-03T08:18:42.036Z | `static-check` | 0 | 0 | 0 |
| 6 | 2026-10-03T16:09:49.251Z | `gap-goal904-merge-drill-record-doc` | 2026-10-03T16:09:25.214Z | `static-check` | 0 | 0 | 0 |
| 7 | 2026-10-05T12:13:32.044Z | `gap-release-bundle-embeds-dev-version-after-stamp` | 2026-10-05T12:13:04.861Z | `static-check` | 0 | 0 | 0 |
| 8 | 2026-10-05T12:17:59.676Z | `gap-config-provider-path-frozen-to-versioned-cache-dir` | 2026-10-05T12:17:15.629Z | `static-check` | 0 | 0 | 0 |
| 9 | 2026-10-05T14:45:56.337Z | `gap-dispatch-worktree-setup-links-node-modules-for-pnpm-projects` | 2026-10-05T14:45:16.410Z | `static-check` | 0 | 0 | 0 |
| 10 | 2026-10-05T15:03:41.010Z | `gap-goal-branch-active-branch-mode-goal-without-branch-never-self-heals` | 2026-10-05T15:03:02.238Z | `static-check` | 0 | 0 | 0 |
| 11 | 2026-10-06T06:53:58.902Z | `gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it` | 2026-10-06T06:53:25.574Z | `static-check` | 0 | 0 | 0 |
| 12 | 2026-10-07T06:13:21.035Z | `gap-init-cli-lays-full-closed-set-and-detects-project-values-without-the-shell-script` | 2026-10-07T06:12:28.173Z | `static-check` | 0 | 0 | 0 |
| 13 | 2026-10-08T03:15:21.036Z | `gap-goal030-preview-runs-branch-code` | 2026-10-08T03:14:40.608Z | `static-check` | 0 | 0 | 0 |
| 14 | 2026-10-08T03:24:42.294Z | `gap-goal030-preview-runs-branch-code` | 2026-10-08T03:24:01.951Z | `static-check` | 0 | 0 | 0 |
| 15 | 2026-10-08T15:04:15.309Z | `gap-goal031-selfhost-evidence-and-arch-layer-review` | 2026-10-08T15:03:32.514Z | `static-check` | 0 | 0 | 0 |
| 16 | 2026-10-10T18:54:25.713Z | `goal-036-dispatch-exclusion-single-source` | 2026-10-10T18:53:43.959Z | `static-check` | 0 | 0 | 0 |

Grouped reading (one line covers all 16 — every row is the same in kind): **16/16 pair with a round whose `gate` is `static-check` and whose `tests` / `fail` / `perFile` are all 0.** The runner's own durable record says the suite never executed a single test, so there is no file to name and `no-failing-lines-in-suite-log` is the factually correct value (hard rule 3b: an honest "there was nothing to re-run" must not be flattened into "a rerun ran and stayed red").

Two supporting facts, each independently checkable:

- **Why the raw logs could not be consulted:** `pruneTaskSuiteLogs` deletes `fan-in-suite-<task>~*` logs at landing (`worker-fan-in.ts:1517`, called at `:2312`), and all 16 tasks later landed ⇒ all 16 logs are gone (`ls .quay/fan-in-suite-<task>*` ⇒ nothing). The round ledger survives precisely because the logs do not; reading the ledger is the durable-carrier route, not a workaround.
- **Why a static-check red has no per-file line at all:** `full-suite-runner.ts:3199-3206` appends its own TAP-form summary, with `summaryFail = green ? 0 : tapFail > 0 ? tapFail : finalFailures.length`. In a static-check red `tapFail === 0`, so `# fail N` counts **non-TAP** failures (static-check / gate entries) and no `__PERFILE__ … passed=false` line is ever emitted. That is also why the fan-in `reason` on these records reads `# fail 45` / `# fail 72` / `# fail 84`: `extractFirstFailureLine` picked the runner's own summary line, not an assertion.

**Negative control (the other half of the predicate — a failing file *does* produce files):** the other 68 `rerun-not-evaluated` records carry `mechanical_fan_in.failedTestFiles.evaluated: true` with 1–4 named files, and the same tasks' later rounds are ordinary test reds (`gap-goal904-merge-drill-record-doc` at 2026-10-03T16:20 holds `tests 10055 / fail 10 / perFile 934`). So the two reason tokens separate cleanly: the parser finds files when files exist, and reports zero only when the round truly ran zero tests.

**Related observation, recorded and not filed:** a static-check red — the shape of *all 16* — is structurally unreachable by a per-file rerun (there is no test file to re-run), and static-check reds are the largest non-test red class here. So the in-round rerun can never help that class. That is a design question about `rerun_command`'s scope, not a defect in the declared line, and it is noted here so the next reader does not have to re-derive it.

## Acceptance Criteria
- [x] `grep -n rerun_command .quay/config.yml` in the main checkout shows the declared argv template. A task worktree created after landing shows the same key.

  ```
  $ grep -n "^  rerun_command:" /data/home/yale/work/quay/.quay/config.yml
  147:  rerun_command: ["bash", "{worktree}/scripts/test.sh", "{files}"]

  # a worktree CREATED AFTER the edit, provisioned by dispatch-worktree-setup.sh:
  $ git worktree add /data/home/yale/work/quay-worktrees/zz-provision-proof-rerun-command -b task/zz-provision-proof-rerun-command develop
  $ bash plugin/scripts/dispatch-worktree-setup.sh /data/home/yale/work/quay-worktrees/zz-provision-proof-rerun-command
  dispatch-worktree-setup: fork-point PASS — HEAD contains develop (c010f023a78b3634ed204d9bb23a0a90417a267e)
  worktree-include: copied .quay/config.yml -> /data/home/yale/work/quay-worktrees/zz-provision-proof-rerun-command/.quay/config.yml
  worktree-include: done — 5 file(s) copied into /data/home/yale/work/quay-worktrees/zz-provision-proof-rerun-command
  $ grep -n "^  rerun_command:" /data/home/yale/work/quay-worktrees/zz-provision-proof-rerun-command/.quay/config.yml
  147:  rerun_command: ["bash", "{worktree}/scripts/test.sh", "{files}"]
  $ node --experimental-strip-types /tmp/check-rerun-decl.ts <that worktree> plugin/test/x.test.mjs
    declared  : {"state":"declared","value":["bash","{worktree}/scripts/test.sh","{files}"]}
    resolved  : {"kind":"run","argv":["bash","/data/home/yale/work/quay-worktrees/zz-provision-proof-rerun-command/scripts/test.sh","plugin/test/x.test.mjs"]}
  ```

  (The proof worktree was removed immediately afterwards; `git worktree list | grep -c zz-provision-proof` ⇒ `0`.)
  Note the config is gitignored, so this is a **workspace write, not a branch landing** — see Findings/Plan 2. "After landing" is satisfied in the operative sense (any worktree provisioned after the write carries the key), and the word "landing" does not otherwise apply to a key that no branch can carry.

- [x] Dry run: run the declared command, with `{files}` substituted, on one known-green test file. It exits 0. On a temporary copy of that file with one assertion flipped, it exits non-zero. Paste both outputs.

  Both arms run in this task's worktree, with the argv taken verbatim from the declared template (`{worktree}` → the worktree path, `{files}` → the single named file).

  **Arm 1 — known-green file** (`plugin/test/goal-needs-human-blocking.test.mjs`):

  ```
  $ bash <wt>/scripts/test.sh plugin/test/goal-needs-human-blocking.test.mjs
  ✔ VALID_GOAL_STATUSES 含 needs-human（词表侧） (0.566227ms)
  ✔ goalAchievedFromRecords: 全 achieved ⇒ true（正控制） (0.167766ms)
  ✔ goalAchievedFromRecords: 含 needs-human AC ⇒ false（负控制） (0.072428ms)
  ✔ goalAchievedFromRecords: achieved + needs-human ⇒ false（needs-human 在域且阻塞，非零在域兜底） (0.066088ms)
  ℹ tests 4
  ℹ pass 4
  ℹ fail 0
  ℹ cancelled 0
  EXIT=0    WALL=32s   (RERUN_TIMEOUT_MS=300s)
  ```

  **Arm 2 — temporary copy with ONE assertion inverted** (`cp` to `plugin/test/rerun-dryrun-flip.test.mjs`, then `assert.ok(VALID_GOAL_STATUSES.includes('needs-human'))` → `assert.ok(!VALID_GOAL_STATUSES.includes('needs-human'))`):

  ```
  $ bash <wt>/scripts/test.sh plugin/test/rerun-dryrun-flip.test.mjs
  ✔ goalAchievedFromRecords: 全 achieved ⇒ true（正控制） (0.223925ms)
  ✔ goalAchievedFromRecords: 含 needs-human AC ⇒ false（负控制） (0.109017ms)
  ✔ goalAchievedFromRecords: achieved + needs-human ⇒ false（needs-human 在域且阻塞，非零在域兜底） (0.077828ms)
  ℹ tests 4
  ℹ pass 3
  ℹ fail 1
  ℹ cancelled 0

  ✖ failing tests:

  test at plugin/test/rerun-dryrun-flip.test.mjs:21:1
  ✖ VALID_GOAL_STATUSES 含 needs-human（词表侧） (0.924008ms)
    AssertionError [ERR_ASSERTION]: DRYRUN: assertion deliberately inverted for the negative arm
  EXIT=1
  ```

  The exit code discriminates in exactly the way `runInRoundRerun` consumes it (`r.status === 0 ? "rerun-green" : "rerun-red"`), and the negative arm reds **only** on the inverted assertion — no static-check noise polluting the signal. The temporary copy was deleted immediately after; `git status --porcelain` in the worktree is empty.

- [x] A count of the 16 `no-failing-lines-in-suite-log` records, each with task id and ts, plus a one-line finding per record, or a grouped finding with the first 3 samples.

  Count: **16/16 of the `no-failing-lines-in-suite-log` records are static-check reds with zero tests run.** Full table and grouped finding in Findings/Plan 3 above; the grouped finding plus the first three samples, in one line each:

  1. `2026-10-02T02:23:44.760Z` `gap-goal-round-records-unreachable-drafts` — paired round `2026-10-02T02:22:59.812Z` is `gate=static-check, tests=0, fail=0, perFile=[]` ⇒ the red was the static-check phase, no test file exists to name.
  2. `2026-10-03T08:08:18.806Z` `gap-goal-branch-reaper-accepts-preview-serve` — paired round `2026-10-03T08:07:56.935Z`, same shape (`gate=static-check`, `tests=0`, `perFile=[]`).
  3. `2026-10-03T08:10:14.101Z` `gap-goal-branch-ff-merge-source-param` — paired round `2026-10-03T08:09:37.777Z`, same shape.

  All 16 rows in the table are identical in kind, so the per-record line is the same line; the count is 16 and none of them is a parser miss.

- [ ] Production carrier (counts only records with ts after this task lands): at least 1 `worker-outcome.jsonl` record has `mechanical_fan_in.rerun.state` in {`rerun-green`, `rerun-red`}. If no suite red occurs in the window, leave this AC unticked and write "未读到" (not read), not "satisfied". （待外部）

  **未读到.** This worker's branch has not yet been ff-merged into `develop` at the time of writing, so the AC's window — "records with ts after this task lands" — is empty by construction and cannot be read yet. Not "satisfied", not "unticked because no red occurred": simply not read. Re-read after landing with:

  ```
  jq -r 'select(.ts > "<landing-ts>") | .mechanical_fan_in.rerun.state // "no-rerun-key"' .quay/worker-outcome.jsonl | sort | uniq -c
  ```

  Expected reading if the declaration took effect: `no-rerun-command-declared` disappears from the distribution, replaced by `rerun-green` / `rerun-red` / `rerun-aborted` / `no-failing-lines-in-suite-log` (the last still expected for static-check reds — see Findings/Plan 3).

## Definition of Done
- AC1–AC3 ticked with output pasted.
- AC4 read from the production carrier, or explicitly recorded as not yet read.

## Touches
- tasks/gap-in-round-suite-rerun-never-executed-in-production.md
- .quay/config.yml
