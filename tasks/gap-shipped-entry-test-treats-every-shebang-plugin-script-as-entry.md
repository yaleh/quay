---
id: gap-shipped-entry-test-treats-every-shebang-plugin-script-as-entry
title: shipped-entry-runnable 测试把每个带 shebang 的随包 plugin 脚本判为「入口」⇒ 主检出下约 300
  条违规恒红，而同一测试在 fan-in 的 worktree 环境不触发 ⇒ 判据结果依赖运行环境
status: ready
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-233
---
## Proposal

**现状（实测，2026-09-10 23:4x–23:5xZ）**：`gap-shipped-entry-files-not-runnable` 已 done 落 develop（提交 `497d97a67`），它新增的 `plugin/test/shipped-entry-runnable.test.mjs` 带 `// @test-group product`。**该测试在主检出下是红的**——经**套件入口** `bash scripts/test.sh plugin/test/shipped-entry-runnable.test.mjs` 复现：

```
AssertionError [ERR_ASSERTION] at plugin/test/shipped-entry-runnable.test.mjs:137
actual: [ 'plugin/gate-scripts/audit-independence-check.sh: packed + entry-like but NOT a declared bin', … ]
expected: []
```

违规分布（按前缀计数）：`plugin/scripts/` **274**、`plugin/gate-scripts/` **24**、`plugin/vendor/` **2**。

**⚠️ 但它在 fan-in 的 worktree 环境里【不触发】——判据结果依赖运行环境**（立条时我先判「develop 全量套件恒红、每次 fan-in 都会被烧」，**该判断已被下列读数推翻**，如实更正）：

- `gap-sufficiency-verdict-nondeterministic-on-identical-input` 的机械 fan-in 在该测试落地**之后**跑满全量 suite（`suite-start 23:39:10 → suite-end 23:42:59`，`exit=0 ok=True`）并成功 ff 落地。
- 同期 `gap-ac207-e2e-producer-section-never-landed-on-develop` 的 fan-in suite 日志（240 232 字节、**1510 条测试结果行**）中 `grep -c "packed + entry-like"` = **0**。
- ⇒ **同一份代码，主检出红、worktree 绿。** 这与刚修好的 `gap-git-graph-lane-colour-assertion-assumes-contiguous-columns` 同族：**一个判据的红绿取决于它在哪里跑**，而不是取决于被判对象。

⇒ 严重性据此下调：**不是「所有 fan-in 立刻被烧」**，而是「一条会随环境翻转的判据进了 product 泳道」——它随时可能在某个环境下把无关任务的 fan-in 烧掉，且**在主检出做任何本地全量验证的人都会看到一片红**。

**根因（位置判定，逐行）**——`plugin/test/shipped-entry-runnable.test.mjs:74-80`：

```js
function isEntryLike(packedFile, shebangPrefix) {
  const { path: rel, mode } = packedFile;
  if (rel.split("/")[0] === "bin") return true;
  if ((mode & 0o111) !== 0) return true;
  if (shebangPrefix === "#!") return true;     // ← 这一条
  return false;
}
```

第三条把**任何带 shebang 的随包文件**都判为「入口」。而 `packages/quay` 的 `files` 含 `"plugin"`（**故意如此**——plugin bundle 就是产品交付面），其中每个 `*.sh` 都有 shebang、多数还有可执行位 ⇒ 全部落进「entry-like」⇒ 因为都不是 `package.json` 的 `bin`（`bin` 只有 `{"quay": "./dist/quay.js"}`）⇒ 全部报违规。**但它们本来就不该是 npm `bin`**：`plugin/scripts/*.sh` 是 driver/gate 按路径调的机件（`capability-catalog.sh` 的整张表就是它们），不是用户命令。

**环境差异的成因【未知，⛔ 不预设】**：`packedFiles()`（`:48-55`）跑 `npm pack --dry-run --json`，其文件集在 worktree 与主检出可能不同（gitignored/已构建产物如 `plugin/scripts/dist/*.js` 在新 worktree 中可能缺席）。**这是一个未验证的方向，不是结论**——实现者须先在两个环境各取一次 `npm pack --dry-run --json` 的文件计数与差集，再下判断。

**AC-233 的修法本身没错，被误伤的只是枚举面**：原缺陷是 `bin/quay.js` + `bin/quay.ts`「长得像入口、却在安装位置下结构上不可运行」。修法（`files` 加 `!bin/quay.js` / `!bin/quay.ts` / `!bin/node-version-check.cjs` 三条否定模式）**已独立核实安全**——`dist/quay.js` 对 `node-version-check` 零引用、三个被排除文件构成闭集；本仓库 `packages/quay/bin/quay.ts` 仍在，`host-repo-surface-ratchet` 仍绿（19/25/5 exit 0）。

## Plan

1. **先量环境差异**：在主检出与一个全新 task worktree 各跑一次 `npm pack --dry-run --json`，比对文件集，写出差集与结论。⛔ 不跳过这步直接改断言——否则改完仍可能只在一个环境绿。
2. **收窄「入口」定义**。候选（择一并写明理由）：
   - (a) 只把 `bin/` 下的文件视为入口候选（回到 AC-233 的真实缺陷面）；
   - (b) 保留 shebang/exec 判据，但排除 `capability-catalog.sh` 已声明为机件的路径——用既有机件做真相源（硬规则①），⛔ 不新写 allowlist；
   - (c) 保留全枚举，把「不是 declared bin」从**违规**降为**可区分的第三态**（如 `shipped-mechanism`），只有「declared bin 却跑不起来」与「`bin/` 下形如入口却跑不起来」才算违规。
   **建议 (c)**：保留枚举完整性（硬规则③），又不把交付面里正常的机件误判成缺陷。
3. **保住原判据的取假能力**：收窄后必须仍能对 AC-233 的原缺陷取假——把 `!bin/quay.js` / `!bin/quay.ts` 从 `files` 去掉 ⇒ 测试必须**变红**。⛔ 缺这条负控制等于把测试改成恒绿。

## Acceptance Criteria

- [ ] AC1 缺陷存证（改前读数）：贴主检出经**套件入口**的失败摘要与三个前缀计数（`plugin/scripts/` 274 / `plugin/gate-scripts/` 24 / `plugin/vendor/` 2），以及 `:74-80` `isEntryLike` 原文。
- [ ] AC2 环境依赖已量化：贴主检出与新 worktree 各一次 `npm pack --dry-run --json` 的文件计数与差集摘要，并说明它是否解释了「主检出红 / worktree 绿」；若不解释，写出实际成因与支撑读数。
- [ ] AC3 两个环境都绿：改后在**主检出**与**一个新建 worktree**各经套件入口跑该文件，两次 exit 0；贴两次命令与退出码——⛔ 退出码取自 `test.sh` 本身，不得取自管道末段（`[[pipe-exit-code-last-segment-only]]`）。
- [ ] AC4 原缺陷仍能取假（最关键的负控制）：临时从 `packages/quay/package.json` 的 `files` 移除 `!bin/quay.js` 与 `!bin/quay.ts` ⇒ 测试**变红**并逐字点名这两个文件；还原后转绿。贴两次输出与还原后 `git diff` 为空。
- [ ] AC5 交付机件不再被误判：改后违规列表中 `plugin/scripts/` / `plugin/gate-scripts/` / `plugin/vendor/` 三个前缀命中数**均为 0**；贴计数命令与输出。
- [ ] AC6 三态可区分（若采纳 (c)）：输出能区分「declared bin 且可跑」/「declared bin 但跑不起来」/「随包机件（非入口）」，各贴一条实例。若采纳 (a)/(b)，改为贴出被排除路径集合及其真相源，并说明该来源为何不会漂移。
- [ ] AC7 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

`plugin/test/shipped-entry-runnable.test.mjs` 在**主检出与新 worktree 两个环境**下经套件入口均 exit 0（⛔ 只在一个环境绿不算——环境依赖正是本条要治的病），且对 AC-233 的原缺陷仍能取假（AC4 双向控制实测通过）；`plugin/**` 下随包交付的机件不再被计为违规。⛔ 把该断言删掉或改成恒绿 ⇒ 不算达成（把误报换成没有保证）；⛔ 把 `plugin` 移出 `files` 来「消除违规」⇒ 不算达成（plugin bundle 是产品交付面，移出会砸掉下游全部机件）。

## Touches

- plugin/test/shipped-entry-runnable.test.mjs
- tasks/gap-shipped-entry-test-treats-every-shebang-plugin-script-as-entry.md
