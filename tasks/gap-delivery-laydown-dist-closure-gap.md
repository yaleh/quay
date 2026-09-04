---
id: gap-delivery-laydown-dist-closure-gap
title: "quay-init 闭包正则未随 package.sh 的 dist 改写更新——dist/transcript-delivery-check.js + pane-state-classify.js 不进 laydown 集（B/C 双机冷启动 fail loud）"
status: done
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
6. **范围扩展（外层 2026-08-16 C 机补强证据，判据须覆盖更宽形态）**：C=ad-arm1 上**整个 `.ts` 源码层缺失**——tgz 只装 `dist/*.js`，`plugin/scripts/*.ts` 一个都没有。SKILL.md 前置条件引用 `fast-mode-telemetry.ts`（.ts），node `--experimental-strip-types` 对 `.js` 后缀不生效（SyntaxError）。subagent 补铺 .ts 源码层 + 规范 .sh 包装（引用 .ts）才满足。⇒ 不止 send-keys 的 2 个 dist 文件——**整个「SKILL.md 前置引 .ts、bundle 只装 dist/.js」的形态**在干净安装上必须人工补铺。判据需覆盖：打包后所有 SKILL.md/tick-doc 前置条件引用的 `.ts` 都要在安装后有对应可执行形态（.ts 或可被 strip-types 处理的 .js）。

## Acceptance Criteria

- [x] AC1: 闭包正则 + closure 检查正则覆盖两段 `dist/X.js` 路径（打包形态下）。
- [x] AC2: `dist/transcript-delivery-check.js` + `dist/pane-state-classify.js` 进 laydown 集（打包 + quay-init 后落地）。
- [x] AC3: 负控制成立——`dist/ghost.js` 引用 fail loud；真实两个文件引用进集。
- [x] AC4: 既有 laydown/referenced-not-landed 测试全绿 + 新增 dist 路径用例。
- [x] AC5: 打包后所有 SKILL.md/tick-doc 前置条件引用的 `.ts` 都有对应可执行形态（.ts 或可被 strip-types 处理的 .js）——C 机「整个 .ts 层缺失」形态归零。

## Definition of Done

- [x] 打包形态下 dist/*.js 依赖进 laydown 集；B/C 同款安装不再 fail loud；负控制 + 既有测试绿。

## Evidence

**实现形态（改哪一层）**：改的是**源树 `plugin/scripts/quay-init.sh` 的闭包/closure 检查正则**（L983/L1179 段）——打包产物由 `package.sh` 从源树生成，`rewriteShell(isQuayInit=true)` 不触碰这两行 ⇒ 源树改动自动同步进打包副本。多段字符类 `[a-zA-Z0-9._/-]*` 是单段的严格超集：源树 `${SCRIPT_DIR}/X.ts` 与打包 `${SCRIPT_DIR}/dist/X.js` 两形态都能解析；sed 从 basename-strip `s#.*/##`（会把 `dist/X.js` 截成 `X.js`）改为仅剥 `${SCRIPT_DIR}/`/`$SCRIPT_DIR/` 前缀，保留 scripts/-relative 路径。

- **AC1（打包形态下闭包/检查正则覆盖两段路径）**：`plugin/scripts/quay-init.sh` L983（derive_loop_scripts 闭包）与 L1179（verify_referenced_landed closure 检查）现为 `\$\{SCRIPT_DIR\}/[a-zA-Z0-9][a-zA-Z0-9._/-]*|\$SCRIPT_DIR/[a-zA-Z0-9][a-zA-Z0-9._/-]*` + `sed -E 's#^\$\{SCRIPT_DIR\}/##; s#^\$SCRIPT_DIR/##'`。可复现：`packages/quay/test/build-plugin-dist.test.mjs` AC1 两例——(a) rewriteShell(isQuayInit=true) 保留多段正则 + 前缀-strip；(b) 端到端 shell 语义：对 `${SCRIPT_DIR}/dist/transcript-delivery-check.js` 提取出 `dist/transcript-delivery-check.js`（非 basename）。打包 install 的 `verify-referenced-landed: OK` 亦在 e2e 断言。
- **AC2（两 dist 文件进 laydown 集）**：`plugin/test/quay-init-laydown-dist-closure.test.mjs` AC2/AC1——真实 `package.sh` 同款打包（build-plugin-dist build → `.ts` 删除 → rewrite）后跑打包 `quay-init.sh --loop`，exit 0 且 `<ws>/plugin/scripts/dist/transcript-delivery-check.js` 与 `pane-state-classify.js` 均落地。
- **AC3（负控制）**：同文件 AC3——把 laid-down 的 `send-keys-reliable.sh` 的 `CHECKER` 改为 `${SCRIPT_DIR}/dist/ghost.js` 后打包 install **exit 2**，`dependency-not-landed` 且点名 `dist/ghost.js`；两个真实文件引用进集。
- **AC4（既有测试绿 + 新增用例）**：既有 `quay-init-laydown-closure`（5/5）、`quay-init.test`（5/5）、`quay-init-loop`（5/5）、`quay-init-loop-core`+`quay-init-loop-consumer-doc-refs`（19/19）全绿；新增 `packages/quay/test/build-plugin-dist.test.mjs`（6/6）与 `plugin/test/quay-init-laydown-dist-closure.test.mjs`（2/2）。`scripts/test.sh --for-task gap-delivery-laydown-dist-closure-gap` 全绿。
- **AC5（打包后前置条件 .ts 有可执行形态）**：判定为 **Plan 步 5 的① 同根 dist 闭包缺陷**（前置条件应引用打包后实际存在的 .js），非②过时。修复：`plugin/skills/cold-start/SKILL.md:26` 前置条件 `fast-mode-telemetry.ts`（裸名，rewriteMarkdown 不处理）→ 路径形式 `<root>/plugin/scripts/fast-mode-telemetry.ts`，打包后 rewriteMarkdown 改写为 `<root>/plugin/scripts/dist/fast-mode-telemetry.js`（随 (a) 派生落地）。`packages/quay/test/build-plugin-dist.test.mjs` AC5 断言：打包后前置条件表零 `.ts` 引用、引用 `dist/fast-mode-telemetry.js`。tick-doc（orchestrator-loop-tick.md「核对前置条件」节）无 `.ts` 引用，无需改动。
- **附带修复（同根「rewrite 与下游机制不同步」，verify_referenced_landed 漏检的同类）**：`packages/quay/scripts/build-plugin-dist.mjs` `rewriteInvokers` 现也重写 `plugin/workflows/*.js` 的 `plugin/scripts/X.ts` 引用（fan-in-execute.js 等字符串字面量）——打包后 workflow 不再指向已被删除的裸 `.ts`，verify_referenced_landed 的 refs 扫描（覆盖 workflows/*.js）不再把 `anti-drift-touches-check.ts` 等报为 referenced-not-landed。dev-repo `experiments/...ts` 与裸名 prose 引用刻意不重写。

## Touches

- packages/quay/scripts/build-plugin-dist.mjs（rewriteInvokers 增 workflow .js 重写 + 闭包正则同步）
- packages/quay/scripts/package.sh（如正则逻辑在此）
- plugin/scripts/quay-init.sh（源树闭包/closure 检查正则——扩到两段 dist/X.js，去 basename-strip）
- plugin/skills/cold-start/SKILL.md（前置条件 fast-mode-telemetry.ts → 路径形式，随 rewriteMarkdown 改写为 dist 形态）
- plugin/test/quay-init-laydown-dist-closure.test.mjs（新增：打包形态 e2e——AC2 落地 + AC3 负控制）
- plugin/test/quay-init-laydown-closure.test.mjs（既有闭包测试：AC4 保持绿）
- plugin/test/quay-init.test.mjs（既有 laydown 测试：AC4 保持绿）
- plugin/test/quay-init-loop.test.mjs（既有 install 测试：AC4 保持绿）
- packages/quay/test/build-plugin-dist.test.mjs（新增：rewrite 传播单元测试——AC1/AC5）
- tasks/gap-delivery-laydown-dist-closure-gap.md（自身）

## Test-Files

- plugin/test/quay-init-laydown-dist-closure.test.mjs（本任务新增：打包形态 e2e——AC2 落地 + AC3 负控制）
- plugin/test/quay-init-laydown-closure.test.mjs（既有闭包测试：AC4 保持绿）
- plugin/test/quay-init.test.mjs（既有 laydown 测试：AC4 保持绿）
- plugin/test/quay-init-loop.test.mjs（既有 install 测试：AC4 保持绿）
- packages/quay/test/build-plugin-dist.test.mjs（本任务新增：rewrite 传播单元测试——AC1/AC5）