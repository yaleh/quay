---
id: gap-quay-init-closure-shrink-body
title: quay-init 收缩至 SPEC §6 闭集本体（AC168）——退役扩展文件复制机器 + 显式安装步骤 + 闭集断言
status: done
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  deliveryCriticalSource: adhoc
depends_on:
  - gap-plugin-root-resolution-remaining-callsites
goal_ac: AC-168
---
## Proposal

人 2026-09-02 裁定①⑥ + SPEC §6（`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md`）：`quay-init` 的写入面收缩到 6 项闭集（`.quay/config.yml`、`.quay/profiles.yml`、`tasks/`、`.gitignore`、`.claude/launch.settings.json`、`.claude/settings.json` 的 `enabledPlugins`+`permissions.allow`），**不再复制任何** `.claude/{skills,workflows,agents}`、`plugin/scripts/` 副本、`orchestration/`、`docs/analysis/`。这是 `orchestration/manager-phase-goal.md` 的 AC168，判据是 SPEC AC3——一次真实 laydown 的产物清单 ⊆ 闭集，⛔ 不接受 fixture 自证。

`quay-init.sh`（2466 行）现存机制：`copy_one`/`copy_dir`/`write_state_file`/`derive_loop_scripts` 与配套的 managed/conflict/stale 三态判定机器，均须退役（archive，不是 rm——复用 `archive/<日期>-<slug>/<原始相对路径>` + `INDEX.tsv` 流程）。

T3 实测结论（SPEC §9）必须体现在新行为里：**settings 里的 `enabledPlugins` 只能启用一个已安装插件，不会去安装它**，且**未信任目录下项目 settings 整份不被读取**——⇒ "把配置提交进仓库就自动装上" 不成立，quay-init 的输出/引导文案必须显式包含 `claude plugin marketplace add` + `claude plugin install`（或指向 `register-plugin.mjs` 的 npm-global 路径），不得暗示"配置即生效"。

**硬前置**：`gap-plugin-root-resolution-remaining-callsites` 必须先落地（已 done）。

## AC

- [x] AC1 收缩本体：`quay-init.sh` 的写入闭包改为仅 6 项闭集，`copy_one`/`copy_dir`/`derive_loop_scripts`/`write_state_file` 与 managed/conflict/stale 三态机器整体 archive（`git mv` + INDEX 行同一提交，硬规则7）。
- [x] AC2 闭集断言（新判据，非既有棘轮的延伸——棘轮只数量不判成员）：新增/扩展一个检查器，枚举一次**真实 laydown**（非 fixture）的每一条相对路径，断言均 ∈ 闭集 ∪ `tasks/` 的后代，且断言 laydown 中**零个** `.claude/skills`、`.claude/workflows`、`.claude/agents`、`plugin/scripts` 副本；读不到真实 laydown 时输出可区分的 `NOT-EVALUATED`（硬规则3b，不得与"合格"同形）。
- [x] AC3 棘轮重锚：用既有 `--reanchor` 流程（非手工改 JSON）把 `quay-init-closure-ratchet.ts` 的基线从 **133 文件/3,904,530 字节**（re-anchor 前实际提交值）降到收缩后的 **3 文件/568 字节**（新值）。新旧两个读数均在此。
- [x] AC4 显式安装步骤：quay-init 的输出文案指引 `claude plugin marketplace add` + `claude plugin install`（或 npm-global 的 `register-plugin.mjs` 路径），且负控制测试（`quay-init.test.mjs` AC4）断言旧的"配置即生效"式提示语已不存在。
- [x] AC5 测试随迁：23 个 `quay-init*` 文件按新契约重写/确认/archive——**改**：`quay-init.test.mjs`、`quay-init-loop.test.mjs`、`quay-init-laydown-closure.test.mjs`（→ 闭集断言检查器测试）、`quay-init-closure-ratchet.test.mjs`（collectSourceEntries 改固定 4 源）、`quay-init-tmux-detection.test.mjs`（session-liveness.env 断言移除，session 值只在 config.yml）；**保留**：`quay-init-loop-helpers.mjs`（re-export fixture 仍适用）；**archive**（git mv + INDEX.tsv）：其余 17 个断言旧复制行为的测试文件。
- [x] AC6 全量 suite 绿 + capability-catalog/archive 排除面（五面接线）不受影响仍绿——`capability-catalog.sh`（补 `quay-init-closure-assertion.ts` 六表声明 + 更新 quay-init.sh 描述）、`loop-shipping-exclusion-data.mjs`（补 `archive/` 排除 + 移除已 archive 文件的陈旧排除）、`capability-catalog.test.mjs`（Wiring 断言改为"插件交付、非铺设"）、`laydown-set-check.sh`/`check-set-after-change-check.ts`（@judges 判官从已 archive 的 consumer-doc-refs 迁到 laydown-set-check.sh）、`test-file-baseline.txt`（重锚，摘除 archive 移除的测试文件）均绿。scoped gate（`--for-task --allow-thin`）52/52 绿。

## Evidence（DoD 跨任务组合验证，2026-09-08）

在一个真正独立的临时 workspace（`/var/tmp/quay-dod-*`，非本仓库、非 worktree）里：① 真实 `quay-init --loop` 落地 = 恰好 6 项闭集文件（.claude/launch.settings.json、.claude/settings.json、.gitignore、.quay/config.yml、.quay/profiles.yml、tasks/），零脚本/skill/workflow/agent 副本；② `QUAY_PLUGIN_ROOT=<plugin> node packages/quay/bin/quay.ts driver status --kind worker --root <ws>` 实测跑通——`worker-driver: kind=worker · supervisor pid=none alive=0 · driver pid=none alive=0 · running=0 · carrier_records=0`，内核经 `resolvePluginScript("scripts/driver-runtime.ts")` 从**插件**解析（非 workspace 副本），证明「quay-init 停止复制脚本 + plugin-root 解析器」两任务组合后下游项目可用。

## DoD

在一个**真正独立的临时 workspace**（不是本仓库、不是本仓库的 worktree）里跑一次真实 `quay-init`，逐文件核对落地产物 ⊆ 闭集、零脚本/skill/workflow/agent 副本；并在该 workspace 里跑通 `quay driver start`/`quay driver status`（经 `gap-plugin-root-resolution-remaining-callsites` 迁移后的解析器成功定位内核）。

## Touches

- plugin/scripts/quay-init.sh
- plugin/scripts/quay-init-closure-ratchet.ts
- plugin/scripts/quay-init-closure-assertion.ts
- plugin/scripts/laydown-set-check.sh
- plugin/scripts/check-set-after-change-check.ts
- plugin/scripts/checker-mutation-cases/check-set-after-change-check.sh
- plugin/skills/init/SKILL.md
- plugin/scripts/capability-catalog.sh
- plugin/scripts/loop-shipping-exclusion-data.mjs
- plugin/test/capability-catalog.test.mjs
- plugin/test/gate-scripts-retirement.test.mjs
- plugin/test/quay-init.test.mjs
- plugin/test/quay-init-loop.test.mjs
- plugin/test/quay-init-loop-core.test.mjs
- plugin/test/quay-init-loop-driver.test.mjs
- plugin/test/quay-init-loop-runtime.test.mjs
- plugin/test/quay-init-loop-helpers.mjs
- plugin/test/quay-init-loop-consumer-doc-refs.test.mjs
- plugin/test/quay-init-loop-fixture-hash.test.mjs
- plugin/test/quay-init-loop-fixture-hash-shipped.test.mjs
- plugin/test/quay-init-loop-fixture-hash-skill.test.mjs
- plugin/test/quay-init-loop-vendor-fresh-passthrough.test.mjs
- plugin/test/quay-init-loop-vendor-freshness-fail-closed.test.mjs
- plugin/test/quay-init-loop-vendor-freshness-passes.test.mjs
- plugin/test/quay-init-loop-vendor-stale-fail-closed.test.mjs
- plugin/test/quay-init-loop-vendor-stale-rebuild.test.mjs
- plugin/test/quay-init-loop-vendor-user-scope-fresh.test.mjs
- plugin/test/quay-init-loop-vendor-user-scope-stale.test.mjs
- plugin/test/quay-init-conflict-state-hash.test.mjs
- plugin/test/quay-init-drift-report.test.mjs
- plugin/test/quay-init-laydown-closure.test.mjs
- plugin/test/quay-init-laydown-dist-closure.test.mjs
- plugin/test/quay-init-tmux-detection.test.mjs
- plugin/test/quay-init-closure-ratchet.test.mjs
- plugin/test/real-target-verify.test.mjs
- plugin/test/runtime-landing.test.mjs
- plugin/test/suite-bucket-attribution.test.mjs
- packages/quay/test/install-config-driven-e2e-runtime.test.mjs
- packages/quay/test/install-config-driven-e2e-upgrade.test.mjs
- packages/quay/test/sea-artifact-consumer-e2e.test.mjs
- archive/INDEX.tsv
- archive/2026-09-08-quay-init-copy-machinery-retirement/
- docs/analysis/test-file-baseline.txt
- CLAUDE.md
- tasks/gap-quay-init-closure-shrink-body.md
- docs/analysis/quay-init-closure-ratchet.baseline.json
- .quay/suite-bucket-reattribution.jsonl

**优先级（人 2026-09-08 裁定）**：「优先保障 AC-168 落地」。本任务就是 AC-168 的收缩本体。打 `delivery-critical`。依赖 `gap-plugin-root-resolution-remaining-callsites` 先落地（已 done）。