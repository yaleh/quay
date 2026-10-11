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

## Acceptance Criteria
- [ ] `grep -n rerun_command .quay/config.yml` in the main checkout shows the declared argv template. A task worktree created after landing shows the same key.
- [ ] Dry run: run the declared command, with `{files}` substituted, on one known-green test file. It exits 0. On a temporary copy of that file with one assertion flipped, it exits non-zero. Paste both outputs.
- [ ] A count of the 16 `no-failing-lines-in-suite-log` records, each with task id and ts, plus a one-line finding per record, or a grouped finding with the first 3 samples.
- [ ] Production carrier (counts only records with ts after this task lands): at least 1 `worker-outcome.jsonl` record has `mechanical_fan_in.rerun.state` in {`rerun-green`, `rerun-red`}. If no suite red occurs in the window, leave this AC unticked and write "未读到" (not read), not "satisfied". （待外部）

## Definition of Done
- AC1–AC3 ticked with output pasted.
- AC4 read from the production carrier, or explicitly recorded as not yet read.

## Touches
- tasks/gap-in-round-suite-rerun-never-executed-in-production.md
- .quay/config.yml
