---
id: gap-shipped-entry-test-treats-every-shebang-plugin-script-as-entry
title: shipped-entry-runnable 测试把每个带 shebang 的随包 plugin 脚本判为「入口」⇒ 约 200
  条违规、develop 全量套件现在恒红、往后每次 fan-in 都在 suite 步烧掉
status: todo
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

**现状（实测，2026-09-10 23:4xZ）**：`gap-shipped-entry-files-not-runnable` 已 done 落 develop（提交 `497d97a67`），它新增的 `plugin/test/shipped-entry-runnable.test.mjs` 带 `// @test-group product`（在套件 engine 泳道里，`scripts/test.sh` 头注释 `:84` 逐字「the rest of plugin/test」）。**该测试现在是红的**——经**套件入口** `bash scripts/test.sh plugin/test/shipped-entry-runnable.test.mjs` 复现（⛔ 不是只用 `node --test` 手搓路径复现）：

```
AssertionError [ERR_ASSERTION] at plugin/test/shipped-entry-runnable.test.mjs:137
actual: [ 'plugin/gate-scripts/audit-independence-check.sh: packed + entry-like but NOT a declared bin',
          … , '... 101 more items' ]
expected: []
```

违规分布（按前缀计数）：`plugin/scripts/` **274** 命中、`plugin/gate-scripts/` **24**、`plugin/vendor/` **2**。

⇒ **develop 的全量套件现在恒红，往后每一次 fan-in 都会在 suite 步失败。** 这比刚修好的 git-graph 间歇红更严重：那条是数据依赖的间歇红，这条是**确定性**的。

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

第三条把**任何带 shebang 的随包文件**都判为「入口」。而 `packages/quay` 的 `files` 含 `"plugin"`（**故意如此**——plugin bundle 就是产品的交付面），其中每个 `*.sh` 都有 shebang、多数还有可执行位 ⇒ 全部落进「entry-like」⇒ 因为它们都不是 `package.json` 的 `bin`（`bin` 只有 `{"quay": "./dist/quay.js"}`）⇒ 全部报违规。

**但它们本来就不该是 npm `bin`**：`plugin/scripts/*.sh` 是由 driver / gate 按路径调用的插件机件（`capability-catalog.sh` 的整张表就是它们），不是给用户敲的命令。⇒ **判据的「入口」定义过宽**，把「交付面里所有可执行的东西」等同于「用户入口」。

**AC-233 的本意没有错，被误伤的是范围**：原缺陷是 `bin/quay.js` + `bin/quay.ts`「长得像入口、却在安装位置下结构上不可运行」。修法（`files` 里加 `!bin/quay.js` / `!bin/quay.ts` / `!bin/node-version-check.cjs` 三条否定模式）是**对的且已验证安全**——`dist/quay.js` 对 `node-version-check` 零引用，三个被排除的文件构成闭集；本仓库 `packages/quay/bin/quay.ts` 仍在，`host-repo-surface-ratchet` 仍绿（19/25/5 exit 0）。**要收窄的只是测试的枚举面。**

**为什么它带着红落了地（待查，⛔ 不预设成因）**：该任务经机械 fan-in 落地，而 fan-in 有 suite 步；23:38 之后的 fan-in suite 日志里 `grep -c "packed + entry-like"` = **0**，`worker-outcome.jsonl` 同样 0 命中 ⇒ 那次 fan-in 的 suite **没有跑到这条断言**。可能的方向（**均未验证，实现者须先取读数再下结论**）：scoped-gate 预验证缓存跳过了全量 suite（`--write-scoped-gate-cache` 路径）；或 worktree 里 `plugin/scripts/dist/` 等 gitignored 产物不存在导致 `npm pack --dry-run` 的文件集更小。⛔ 不要照着某一条猜测去改。

## Plan

1. **收窄「入口」定义**。`isEntryLike` 要区分「用户入口」与「随包交付的机件」。候选（择一并写明理由）：
   - (a) 只把 `bin/` 下的文件视为入口候选（回到 AC-233 立条时的真实缺陷面），其余随包文件不参与该断言；
   - (b) 保留 shebang/exec 判据，但**排除已被 `capability-catalog.sh` 声明为机件的路径**——用既有机件做真相源（硬规则①），⛔ 不新写一份 allowlist；
   - (c) 保留全枚举，但把「不是 declared bin」从**违规**降为**可区分的第三态**（如 `shipped-mechanism`），只有「是 declared bin 却跑不起来」与「bin/ 下形如入口却跑不起来」才算违规。
   **建议 (c)**：它保留了枚举的完整性（硬规则③：枚举不布尔），又不把交付面里正常的机件误判成缺陷。
2. **保住原判据的取假能力**：收窄后必须仍能对 AC-233 的原缺陷取假——把 `!bin/quay.js` / `!bin/quay.ts` 从 `files` 里去掉 ⇒ 测试必须**变红**。这是本任务最关键的负控制，⛔ 缺它等于把测试改成恒绿。
3. **查清它为何带红落地**（Plan 步骤 1 之前先做）：读该任务那次 fan-in 的 step-trace 与 scoped-gate 缓存，确认 suite 步是跑了还是被跳过。这决定要不要另立一条「fan-in 的 suite 可被跳过」的任务——⛔ 本任务不预判。

## Acceptance Criteria

- [ ] AC1 缺陷存证（改前读数）：贴经**套件入口** `bash scripts/test.sh plugin/test/shipped-entry-runnable.test.mjs` 的失败输出摘要与三个前缀计数（`plugin/scripts/` 274 / `plugin/gate-scripts/` 24 / `plugin/vendor/` 2）；并贴 `:74-80` `isEntryLike` 原文。
- [ ] AC2 套件转绿（直接量）：改后经**套件入口**跑该文件 exit 0；贴命令与退出码——⛔ 退出码必须取自 `test.sh` 本身，不得取自管道末段（`[[pipe-exit-code-last-segment-only]]`）。
- [ ] AC3 原缺陷仍能取假（最关键的负控制）：临时从 `packages/quay/package.json` 的 `files` 移除 `!bin/quay.js` 与 `!bin/quay.ts` ⇒ 该测试**变红**并逐字点名这两个文件；还原后转绿。贴两次输出与还原后的 `git diff` 为空。
- [ ] AC4 交付机件不再被误判：改后违规列表中 `plugin/scripts/` / `plugin/gate-scripts/` / `plugin/vendor/` 三个前缀的命中数**均为 0**；贴计数命令与输出。
- [ ] AC5 三态可区分（若采纳 (c)）：输出能区分「declared bin 且可跑」/「declared bin 但跑不起来」/「随包机件（非入口）」；贴各态各一条实例。若采纳 (a)/(b)，改为贴出「被排除的路径集合及其真相源」并说明为何该来源不会漂移。
- [ ] AC6 带红落地的成因已查清：贴该任务那次 fan-in 的 step-trace（suite 步是否执行）与 scoped-gate 缓存读数，写出结论；若确认存在「fan-in 可跳过全量 suite 而放行一条会红的测试」，**另立任务**并在此写下其 id，⛔ 不在本任务顺手改 fan-in。
- [ ] AC7 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

`plugin/test/shipped-entry-runnable.test.mjs` 经套件入口 exit 0，且对 AC-233 的原缺陷仍能取假（AC3 的双向控制实测通过）；`plugin/**` 下随包交付的机件不再被计为违规；带红落地的成因有基于读数的结论。⛔ 把该断言删掉或改成恒绿 ⇒ 不算达成（那是把一个误报换成没有保证）；⛔ 把 `plugin` 移出 `files` 来「消除违规」⇒ 不算达成（plugin bundle 是产品交付面，移出会砸掉下游全部机件）。

## Touches

- plugin/test/shipped-entry-runnable.test.mjs
- tasks/gap-shipped-entry-test-treats-every-shebang-plugin-script-as-entry.md
