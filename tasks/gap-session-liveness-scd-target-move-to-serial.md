---
id: gap-session-liveness-scd-target-move-to-serial
title: session-liveness scd-* 全家 + target 移 serial（probe 在 lowconc 持续 flaky 误杀无关任务）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

session-liveness 的 scd-* 全家 8 个 + `target` + `signals-thresholds-edge` 共 10 个测试是「真实 tmux server + claude-probe 进程」测试（头注释 `@load-sensitive wall-clock` / `KNOWN-LOAD-SENSITIVE (wall-clock tmux probe)`），在 lowconc 并发下**持续 flaky**（probe 建立不稳 / 饿死）。反复误杀「碰不到它们的无关任务」：

- `gap-mechanical-fan-in-writes-no-complete-gateevent`（Touches worker-driver.ts）fan-in suite red 在 `session-liveness-scd-busy`；
- `gap-test-file-snapshot-worktree-drops-realinstall`（Touches test.sh）fan-in suite red 在 `session-liveness-target`。

两者反复 exited-not-landed → retry cap → needs-human（各 4+ 次），根因不是它们自身缺陷，而是这两个 flaky 测试。

人 2026-09-02 裁定「probe（真实 tmux server + claude-probe 进程）在 lowconc 不稳，就把它改到 serial 相」，`gap-session-liveness-bclass-move-to-serial`（done）只把 `signals-*` 等 7 个移了 serial，scd-*/target 仍留 lowconc（`gap-scd-load-sensitive-bucket-isolation` 的「SCD 放 lowconc」是过时裁定，实践证明它们会 flaky 误杀）。本轮人裁定「要么调相，要么加强可靠性/鲁棒性」——scd-*/target 尚未调相，**取调相**（移 serial，与 bclass 移 signals-* 同法）。若移 serial 后仍不稳，按 bclass DoD 裁定的下一步转「修测试本身」鲁棒性。

## Plan

1. 把 10 个测试文件的 `@test-group lowconc` 改为 `@test-group serial`（复用 bclass 移 signals-* 的做法，不改并发旋钮、不改 waterline）。
2. 移后验证：mechanical-fan-in + test-file-snapshot 重派不再因 scd-busy/target flaky 而 suite red。

## Acceptance Criteria

- [x] AC1（能取假，机制级）：grep 这 10 个测试文件 `@test-group serial`（不再 lowconc）；（⛔ 仍 lowconc ⇒ 假）。
- [ ] AC2（生产载体）：移 serial 之后，mechanical-fan-in + test-file-snapshot 的 fan-in suite 不再因 session-liveness 失败而 red；N 只计移 serial 之后的时间窗（硬规则 4 推论三）。（待外部）
- [ ] AC3（既有不回归）：全量 suite 绿；serial 相不因新增 10 个测试而超时。（待外部）

## Definition of Done

scd-* 全家 + target + signals-thresholds-edge 的 `@test-group` 为 serial；mechanical-fan-in + test-file-snapshot 不再因 session-liveness flaky 误杀（fan-in suite red 里的 session-liveness 失败归零）；全量 suite 绿。

## Touches

- plugin/test/session-liveness-scd-busy.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-scd-fire.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-scd-inflight-changing.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-scd-multitask.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-scd-progress.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-scd-config-gates.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-scd-develop-active.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-scd-unsaturated.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-target.test.mjs（@test-group lowconc→serial）
- plugin/test/session-liveness-signals-thresholds-edge.test.mjs（@test-group lowconc→serial）
- docs/analysis/test-file-baseline.txt（test-file-snapshot 基线重生成，吸收 lowconc→serial 改标）
- tasks/gap-session-liveness-scd-target-move-to-serial.md（自身）
