---
id: gap-quay-init-closure-shrink-body
title: quay-init 收缩至 SPEC §6 闭集本体（AC168）——退役扩展文件复制机器 + 显式安装步骤 + 闭集断言
status: ready
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

现状实测（`gap-quay-init-closure-assertion-first` 已建的棘轮判据基线，2026-09-05）：一次全量 `quay-init --all --loop --manager` 落地 **130 文件 / 3,822,321 字节**（已排除生成态 `.quay/`），核心是 **111-131 个机制层脚本**逐字节复制进目标项目自己的 git 历史。该任务**只建了"只许降不许升"的棘轮判据，没有做收缩本身**——本任务是收缩本体。

`quay-init.sh`（2466 行）现存机制：`copy_one`(:345)/`copy_dir`(:456)/`write_state_file`(:826)/`derive_loop_scripts`(:1272) 与配套的 managed/conflict/stale 三态判定机器，均须退役（archive，不是 rm——`gap-archive-mechanism-and-exclusion-wiring` 已把 archive 机制建好，直接复用其 `archive/<日期>-<slug>/<原始相对路径>` + `INDEX.tsv` 流程）。

T3 实测结论（SPEC §9，已完成）必须体现在新行为里：**settings 里的 `enabledPlugins` 只能启用一个已安装插件，不会去安装它**，且**未信任目录下项目 settings 整份不被读取**——⇒ "把配置提交进仓库就自动装上" 不成立，quay-init 的输出/引导文案必须显式包含 `claude plugin marketplace add` + `claude plugin install`（或指向 `register-plugin.mjs` 的 npm-global 路径），不得暗示"配置即生效"。

**硬前置**：`gap-plugin-root-resolution-remaining-callsites` 必须先落地——否则本任务一旦让 quay-init 停止复制脚本，`serve-sessions`/`ff-merge`/`mcp-server`/`precommit-guard`/`os-anchor` 这些仍靠 workspace-root 拼接定位脚本的下游入口会当场失效，与 `driver.ts` 曾经的失败模式同构。

## AC

- [ ] AC1 收缩本体：`quay-init.sh` 的写入闭包改为仅 6 项闭集，`copy_one`/`copy_dir`/`derive_loop_scripts`/`write_state_file` 与 managed/conflict/stale 三态机器整体 archive（`git mv` + INDEX 行同一提交，硬规则7）。
- [ ] AC2 闭集断言（新判据，非既有棘轮的延伸——棘轮只数量不判成员）：新增/扩展一个检查器，枚举一次**真实 laydown**（非 fixture）的每一条相对路径，断言均 ∈ 闭集 ∪ `tasks/` 的后代，且断言 laydown 中**零个** `.claude/skills`、`.claude/workflows`、`.claude/agents`、`plugin/scripts` 副本；读不到真实 laydown 时输出可区分的 `NOT-EVALUATED`（硬规则3b，不得与"合格"同形）。
- [ ] AC3 棘轮重锚：用既有 `--reanchor` 流程（非手工改 JSON——参见前次基线冲突教训）把 `quay-init-closure-ratchet.ts` 的基线从 130 文件/3,822,321 字节降到收缩后的真实新值；新旧两个读数都写入任务体。
- [ ] AC4 显式安装步骤：quay-init 的输出文案（以及它需要匹配的任何文档）必须指引 `claude plugin marketplace add` + `claude plugin install`（或 npm-global 的 `register-plugin.mjs` 路径），且一个负控制测试断言旧的"配置即生效"式提示语已不存在。
- [ ] AC5 测试随迁：`plugin/test/quay-init*.test.mjs` 全部 23 个文件按新契约重写或确认仍适用（逐个文件写明"改"或"保留"，不得留任何仍断言旧复制行为的绿测试——绿在旧契约上的测试是假阳性，同硬规则3b）。
- [ ] AC6 全量 suite 绿 + capability-catalog/archive 排除面（五面接线）不受影响仍绿。

## DoD

在一个**真正独立的临时 workspace**（不是本仓库、不是本仓库的 worktree）里跑一次真实 `quay-init`，逐文件核对落地产物 ⊆ 闭集、零脚本/skill/workflow/agent 副本；并在该 workspace 里跑通 `quay driver start`/`quay driver status`（经 `gap-plugin-root-resolution-remaining-callsites` 迁移后的解析器成功定位内核，证明两个任务组合后下游项目可用，而不是各自局部绿）。⛔ 只改 quay-init.sh 与测试、不做这个跨任务组合验证，不算达成——这正是"何时能在其它项目验证改进后的 quay-init"这个问题的落点。

## Touches

- plugin/scripts/quay-init.sh
- plugin/scripts/quay-init-closure-ratchet.ts
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
- CLAUDE.md
- tasks/gap-quay-init-closure-shrink-body.md
- docs/analysis/quay-init-closure-ratchet.baseline.json

**优先级（人 2026-09-08 裁定）**：「优先保障 AC-168 落地」。本任务就是 AC-168 的收缩本体——GOAL-003 的业务目的（插件更新即生效、配置不参与升级、下游不再背 130 个复制文件）几乎全部由它承载。打 `delivery-critical`（`extra.deliveryCriticalSource: adhoc`，DIR-130 授权）。依赖 `gap-plugin-root-resolution-remaining-callsites` 先落地。

**⊕ Touches 补 baseline（manager 2026-09-08 预防性补，非事后修）**：本任务重写 `quay-init.sh` 的铺设面，
而 `quay-init-closure-ratchet.ts` 的闸「**在 source 文件变了而 baseline 未 re-anchor 时报红**」
（脚本头注释 :29 逐字）。⇒ 收缩落地必然需要
`node --no-warnings --experimental-strip-types plugin/scripts/quay-init-closure-ratchet.ts --reanchor --root <worktree>`，
而 re-anchor 写的正是 `docs/analysis/quay-init-closure-ratchet.baseline.json`。
**该文件原本不在本任务 Touches 里** ⇒ 一旦改动足迹落到它上面，fan-in 的 anti-drift 会 HARD FAIL。
先验先例：兄弟任务 `gap-plugin-root-resolution-remaining-callsites` 只改了几个调用点就已经必须
re-anchor（其 worktree 提交 `da645981b`，该 baseline 文件 3 增 3 删）；本任务的足迹比它大一个数量级。
⛔ 冲突时不要手工并 JSON——在**合并后的树上**重跑 `--reanchor`（这是该 baseline 的既定解法）。
