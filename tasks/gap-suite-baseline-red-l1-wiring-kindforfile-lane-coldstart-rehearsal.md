---
id: gap-suite-baseline-red-l1-wiring-kindforfile-lane-coldstart-rehearsal
title: quay-init L1 check 接线回归 + kindForFile/lowconc 泳道/cold-start rehearsal 三处
  baseline 恒红——挡住任何抽中它们的 fan-in
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** finding

## Finding

**实测（2026-09-08，当前 develop HEAD `63b600232`，与任何具体任务的 Touches 无关）**：以下 3 个测试文件的 4 项断言在 develop HEAD 上**恒定失败**，独立跑（不带任何未落地分支改动）即可复现：

1. `plugin/test/l1-delivery-surface-check.test.mjs:169` `AC5 — quay-init wiring: the L1 check ships in the derived set and is invoked beside verify_referenced_landed` — `AssertionError: quay-init must invoke the L1 check (via its resolved script path)`。`gap-complete-delivery-surface-spec-and-l1-verification`（该 AC5 判据的立案任务）已 `done`，说明这是**接线后又回归**：`plugin/scripts/quay-init.sh` 当前不再调用该 L1 check。
2. `plugin/test/known-load-sensitive.test.mjs:127` `AC1 — kindForFile resolves the root causes distinctly (no conflation)` — `actual: undefined, expected: 'nested-spawn'`。
3. `plugin/test/known-load-sensitive.test.mjs:436` `AC3 — the real repo: 27 evidenced files moved out of serial/lowconc to the default group` — `AssertionError: plugin/test/runtime-landing.test.mjs must still be in the lowconc lane (AC3)`。
4. `plugin/test/cold-start-skill.test.mjs:140` `rehearsal — a real --task-start against a quay-init --loop project writes the .workflow-events/ record the skill asserts` — `Error: Cannot find module '.../plugin/scripts/fast-mode-telemetry.ts'`（MODULE_NOT_FOUND，临时 `--loop` 项目里对该脚本的路径解析失败）。

**为什么这是一个独立缺陷而不是两个具体任务的实现问题（负控制）**：`gap-deliver-verification-trigger-orphaned-after-land-path-migration`（Touches 全在 `develop-deliver-tgz.sh`/`release-freshness-check.sh` 一带）与 `gap-webui-list-table-no-overflow-container`（Touches 全在 `serve-*.ts` 表格 CSS）各自独立 fan-in 时都撞上了同一组失败；本会话在当前 develop HEAD 上**不带任何这两个任务的改动**直接跑这三个文件同样复现全部 4 项失败 ⇒ 与两个任务的改动无关，是 baseline 本身已经红。

**代价**：任何被 full-suite 抽中跑到这三个文件的 fan-in 都会被这组无关失败挡下，耗光重试上限后误判为该任务自身有缺陷、被打上 needs-human（本次两个真实实例）。

## AC

- [x] AC1: `node --test plugin/test/l1-delivery-surface-check.test.mjs plugin/test/known-load-sensitive.test.mjs plugin/test/cold-start-skill.test.mjs` 全绿（当前 4 项失败清零），负控制：改动前贴上面 4 条 AssertionError 原文作为取假读数。
- [x] AC2: `plugin/scripts/quay-init.sh` 重新调用 L1 delivery-surface check（AC5 判据本身不回归——若是接线代码被后续改动误删，须找到具体删除点并说明为何当时未被 suite 挡住）。
- [x] AC3: `known-load-sensitive.test.mjs` AC1（`kindForFile` 对 'nested-spawn' 根因的判定）与 AC3（`runtime-landing.test.mjs` 应仍在 lowconc 泳道）两处均有明确根因说明并修复，而非放宽断言掩盖。
- [x] AC4: `cold-start-skill.test.mjs` 的 rehearsal 用例定位 `fast-mode-telemetry.ts` MODULE_NOT_FOUND 的路径解析根因（`--loop` 临时项目里该脚本引用路径为何解析不到）并修复。
- [ ] AC5: `bash scripts/test.sh` 全量 suite 绿（确认修复未引入新红，且这组失败确实是当前唯一相关的红）。（待外部）

## DoD

上述 4 项断言在 develop HEAD 上转绿，且不是靠放宽/删除断言实现；`scripts/test.sh` 全量绿。修复落地后，`gap-deliver-verification-trigger-orphaned-after-land-path-migration` 与 `gap-webui-list-table-no-overflow-container` 两个任务重新派发时不应再撞上这组失败（若仍撞上，说明本任务未修对根因）。

## Touches

- plugin/scripts/quay-init.sh
- plugin/test/l1-delivery-surface-check.test.mjs
- plugin/test/known-load-sensitive.test.mjs
- plugin/test/cold-start-skill.test.mjs
- tasks/gap-suite-baseline-red-l1-wiring-kindforfile-lane-coldstart-rehearsal.md
- docs/analysis/quay-init-closure-ratchet.baseline.json