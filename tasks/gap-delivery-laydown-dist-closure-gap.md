---
id: gap-delivery-laydown-dist-closure-gap
title: "quay-init 闭包正则未随 package.sh 的 dist 改写更新——dist/transcript-delivery-check.js + pane-state-classify.js 不进 laydown 集（B/C 双机冷启动 fail loud）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**判据正本（直接引用，勿转述）**：无独立 manager-phase-goal 段——本任务由 inner 2026-08-16 立案，源证 = AC88③ B/C 双机冷启动 fail loud + Explore agent 直接量调查。

**实测（B=orangevps / C=ad-arm1 双机独立干净安装，同形复现）**：
```
B/C 上 plugin/scripts/send-keys-reliable.sh 运行时报「缺少校验器/缺少分类器」——
引用的 dist/transcript-delivery-check.js + dist/pane-state-classify.js 未落地
（plugin/scripts/fast-mode-telemetry.ts 也只有 dist/.js，.ts 缺）
```

**根因（Explore agent 实读代码，非猜测）**：
1. **源树无缺口**：`plugin/scripts/send-keys-reliable.sh` 引用 `.ts`（`${SCRIPT_DIR}/transcript-delivery-check.ts`，L57）——闭包单段正则能解析。
2. **打包形态改写**：`package.sh` 经 `build-plugin-dist.mjs` 打包，把 `.sh` 里的 `.ts` 引用改写成 `${SCRIPT_DIR}/dist/X.js`（两段路径）；源 `.ts` 删除。
3. **闭包正则未同步**：`build-plugin-dist.mjs` `rewriteShell(isQuayInit=true)` 只改了 (a) 派生正则 + refs 正则以容忍 `dist/` 路径（L210-213），**漏改 (d) 闭包正则 + closure 检查正则**——quay-init.sh L976/L1165 的 `[a-zA-Z0-9._-]*` 仍是单段（不含 `/`）。打包后 `$SCRIPT_DIR/dist/pane-state-classify.js` 被截成 `dist`（目录），`[ -f "$PLUGIN_ROOT/scripts/dist" ]` 为假 → 不进 laydown 集。
4. **verify_referenced_landed 漏检**：closure 检查用同一单段正则截出 `sd=dist`，`[ -e "$ws/plugin/scripts/dist" ]` 因**其它 dist/*.js 确实被铺**（fast-mode-telemetry.js 等被改写后的 SKILL.md 按路径引用）而通过 → 目录存在，漏掉目录内具体缺失的两个 .js。
5. 附带：`transcript-delivery-check.ts` 在 cold-start SKILL.md 里是裸名引用（L80-84/402/416-418），`rewriteMarkdown` 不处理裸 .ts token，打包后裸 .ts 已删，`bare_resolved_scripts` 无法救回。

**⇒ 这是「rewrite 与下游机制不同步」的 referenced-not-landed 缺陷**：build-plugin-dist.mjs 改写引用为 dist 路径，但 quay-init 的闭包/检查正则没跟上。

**⛔ 范围边界**：缺口 2（`plugin/skills/cold-start/SKILL.md` 未铺）**不属本任务**——skills 是 plugin 注册机制（/quay:cold-start），本就不 per-project laydown，未铺是设计正确（Explore 结论）。

## Plan

1. 实读 `packages/quay/scripts/build-plugin-dist.mjs` 的 `rewriteShell(isQuayInit=true)`——确认 (d) 闭包正则和 closure 检查正则的具体位置。
2. 修 quay-init.sh L976（derive_loop_scripts 闭包）与 L1165（verify_referenced_landed closure 检查）的正则：从单段 `[a-zA-Z0-9._-]*` 扩到含 `/`（两段 `dist/X.js`）。⚠️ 改的是**打包产物**（package.sh 产出的 quay-init.sh 副本），源树不用改——需确认改哪个形态、怎么同步（build-plugin-dist.mjs 的 rewrite 或打包后副本）。
3. **负控制**：构造 `$SCRIPT_DIR/dist/ghost.js` 引用 ⇒ 必须 fail loud（不进 laydown 集）；`dist/transcript-delivery-check.js` + `dist/pane-state-classify.js` 引用 ⇒ 必须进 laydown 集。
4. 验证：B/C 同款打包 + quay-init --loop 后，两个 dist 文件落地；send-keys-reliable.sh 不再报缺。
5. **一体两面（外层 2026-08-16 数据点，须一并判断）**：`plugin/skills/cold-start/SKILL.md:26` 前置条件要求 `<root>/plugin/scripts/fast-mode-telemetry.ts` 存在（裸名 .ts），但 tgz 只装 `dist/fast-mode-telemetry.js`——判断它是①同根 dist 闭包缺陷（前置条件应引用打包后实际存在的 .js，或裸 .ts 引用应被 rewriteMarkdown 处理）还是②SKILL.md 前置条件本身过时。判断结论写入任务体 Evidence。

## Acceptance Criteria

- [ ] AC1: 闭包正则 + closure 检查正则覆盖两段 `dist/X.js` 路径（打包形态下）。
- [ ] AC2: `dist/transcript-delivery-check.js` + `dist/pane-state-classify.js` 进 laydown 集（打包 + quay-init 后落地）。
- [ ] AC3: 负控制成立——`dist/ghost.js` 引用 fail loud；真实两个文件引用进集。
- [ ] AC4: 既有 laydown/referenced-not-landed 测试全绿 + 新增 dist 路径用例。

## Definition of Done

- [ ] 打包形态下 dist/*.js 依赖进 laydown 集；B/C 同款安装不再 fail loud；负控制 + 既有测试绿。

## Touches

- packages/quay/scripts/build-plugin-dist.mjs（rewriteShell isQuayInit 的闭包正则同步）
- packages/quay/scripts/package.sh（如正则逻辑在此）
- plugin/scripts/quay-init.sh（打包副本的闭包/closure 检查正则——确认改哪个形态）
- plugin/test/*（对应测试，dist 路径用例）
- tasks/gap-delivery-laydown-dist-closure-gap.md（自身）