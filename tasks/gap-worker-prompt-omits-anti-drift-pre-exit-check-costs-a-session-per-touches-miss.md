---
id: gap-worker-prompt-omits-anti-drift-pre-exit-check-costs-a-session-per-touches-miss
title: "cross-project: worker prompts never run the anti-drift Touches check
  before exit ⇒ every out-of-Touches write costs a whole extra worker session
  (162 bounces in 6 projects)"
status: todo
labels:
  - gap
  - defect
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
**Cross-project Quay Finding (semantic dogfooding, 2026-10-13).**

Mechanical fan-in runs `anti-drift-touches-check.ts` as a pre-merge HARD gate (`plugin/scripts/worker-fan-in.ts:~1975`): any file the task branch changed outside the task's `## Touches` fails the landing. The worker never learns about this gate before it exits:
- `buildWorkerPrompt`, `buildContinueWorkerPrompt` and the pre-merge note in `plugin/scripts/worker-driver.ts` contain no Touches or anti-drift instruction.
- The worker's pre-exit routine is merge + scoped gate only.

So each out-of-Touches write is discovered only AFTER the session ends. The task is recorded `exited-not-landed`, and a whole new LLM worker session is spent on what is almost always a one-line fix: add the file to `## Touches`. Example: cantus commit `3317423` adds `tools/samples/layout.mjs` and `package.json` to Touches, then the next run lands.

**Evidence (`"step":"anti-drift"` records in `<project>/.quay/worker-outcome.jsonl`, read 2026-10-13):**

| project | anti-drift records / all outcomes |
|---|---|
| quay | 70 / 3064 (latest 2026-10-12T11:25Z) |
| claudecodeui | 63 / 1283 |
| archguard | 20 / 106 (e.g. `TASK-89`: "ANTI-DRIFT HARD FAIL: task TASK-89 — 1 violation(s)") |
| cantus | 5 / 98 (`gap-monorepo-runtime-skeleton`: "out-of-declared: task wrote pnpm-lock.yaml") |
| quay-fleet | 3 / 86 |
| meta-cc | 1 / 21 |

That is 162 bounces across 6 projects. An independent read of the host subset estimated ~970 worker-minutes on claudecodeui + archguard + cantus + meta-cc + quay-fleet alone.

**Host cause excluded:**
- It recurs in 6 projects with different languages and layouts.
- The hosts set no `anti_drift.exempt`, and most offending files are real source files, so the `gap-anti-drift-touches-project-configurable-exempt-globs` exemption (done) does not cover them.
- The retry worker widens Touches itself with no human, so the round-trip is not a deliberate human checkpoint.

**Dedup:** no open task. `gap-worker-dispatch-prompt-ac-check-instruction` (done) added the AC-check instruction to the dispatch prompt, the same shape of fix for a different gate. That makes this a sibling it did not cover (hard rule 5b).

**Scope boundary:** the gate itself stays a hard pre-merge gate, unchanged. This task only moves the worker's discovery of a violation to BEFORE it exits, so the fix happens inside the same session.

## Plan
1. The first-dispatch and continue worker prompts gain one pre-exit step: run the anti-drift check against the worker's own worktree with the exact argv the fan-in uses (`--task <id> --worktree <dir> --merge-target <ref>`). The driver resolves the kernel path the same way `worker-fan-in.ts` `gateArgv` does, so the command works in host projects that run the plugin `dist` kernel, not only in quay's source checkout.
2. On a violation, the prompt tells the worker to choose one of two options:
   - (a) declare the file in `## Touches` if the write is genuinely part of the task, through the task ABI, not a hand edit, so the declaration reaches fan-in;
   - (b) revert the stray write.
3. Factor the step into one shared helper used by both prompt builders, so the two prompts cannot drift apart.

## Acceptance Criteria
- [ ] AC1: a unit test shows `buildWorkerPrompt` and `buildContinueWorkerPrompt` output both contain the resolved anti-drift argv for the given task and worktree. Negative control: remove the helper call from one builder ⇒ red. Paste both runs.
- [ ] AC2: the argv embedded in the prompt is executable. Run it verbatim on a fixture worktree with one out-of-Touches write ⇒ exit 1 naming the file. After adding it to Touches ⇒ exit 0. Paste both.
- [ ] AC3: the argv resolves under a plugin `dist` layout too. A fixture with `QUAY_PLUGIN_ROOT` pointing at a dist-shaped tree yields a path that exists. Paste it.
- [ ] AC4 production reading on quay's own `.quay/worker-outcome.jsonl`: among outcomes of tasks first dispatched after the landing commit, over ≥ 40 outcomes, the share with `"step":"anti-drift"` is below 1% (baseline 70/3064 ≈ 2.3%; paste numerator and denominator)（待外部）

## Definition of Done
- `scripts/test.sh --for-task <this task>` green; `tsc` clean on touched `.ts`.
- AC1–AC3 checked with pasted readings; AC4 stays `（待外部）` until its window fills.
- The anti-drift gate behaviour in fan-in is unchanged (no new exemption, no softening).

## Touches
- tasks/gap-worker-prompt-omits-anti-drift-pre-exit-check-costs-a-session-per-touches-miss.md
- plugin/scripts/worker-driver.ts
- plugin/scripts/worker-fan-in.ts
- plugin/test/worker-driver.test.mjs
