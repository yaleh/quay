---
id: gap-ac354-negctl-anchor-symbol-retired
title: AC-354 判据回归：负对照把「重插旧 import」锚在 goal-store.ts 的
  `resolveAcceptanceTimeoutMs` 上，而该符号已被无关重构 411bb34c7 移除 ⇒ 恒红（exit
  1，CAUSE=negative-control-not-falsifiable）；把负对照重锚为不依赖任何符号、且能双向取假
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-354
---
**type:** execution

## Proposal

AC-354 的判据本轮**直接重跑**为假（不是台账尾巴）：`quay goal gate AC-354` → **exit 1**，同行 `CAUSE=negative-control-not-falsifiable -- re-inserting the old import into a scratch copy of goal-store.ts did not raise the count, the checker above cannot be trusted to detect a real regression`（`.quay/gate-events.jsonl` 该条 `timestamp=2026-10-12T21:09:36.859Z`、`verdict=fail`、`criterionHash=c1f3186e6c56cfd3`）。

把判据拆成 9 条断言逐条复跑（本轮实测）：**前 8 条全部通过** —— ① `packages/quay/src/kernel/gate-run-options.ts` 存在；② `gate/config/utils.ts` 已整个删除（不是 shim）；③ `gate/config/loader.ts` 与 ④ `gate/config/index.ts` 均已改口 `../../kernel/gate-run-options.ts`；⑤ `goal-store.ts` 的 `from "./gate/config/` 计数 = 0；⑥ `gate/factories/loader.ts` 不存在；⑦ `gate/factories/utils.ts` 与 ⑧ `gate/factories/goal.ts` 的 `from "../config/` 计数 = 0。**唯一转假的是第 9 条：负对照。**

根因（机械事实，非推断）：负对照把「重插那条被退休的 import」的落点，用一个正则**锚在 goal-store.ts 的某一行**上：

```
.replace(/import\s*\{\s*resolveAcceptanceTimeoutMs[^\n]*\n/, (m) => m + "import { ... } from \"./gate/config/utils.ts\";\n")
```

`replace` 匹配不到 ⇒ `scratchBefore` 与原文逐字相同 ⇒ 计数仍是 0 ⇒ 报「不可证伪」。该行今日不存在，因为它已被一次**与 GOAL-034 无关**的合法重构删除：`git log -S'./kernel/gate-run-options.ts' -- packages/quay/src/goal-store.ts` 只回两条 —— `56ba0b61b` 加入、`411bb34c7`（2026-10-13「goal-driver/meta-driver: derive the outer goal-store child bound from the record's own deadline; clean the orphaned lock on a kill」）移除。`411bb34c7` 把 goal-store 的 deadline 解析从 kernel 的 `resolveAcceptanceTimeoutMs` 换成 record-aware 的 `resolveAcceptanceTimeout`（今定义于 `gate/acceptance-runner.ts`），那个符号名于是从 goal-store.ts 消失。

**为什么上一轮的「修复」没保住**：上一轮承接 AC-354 的任务 `goal-034-edge-count-before-after-negctl`（status: **done**）是**读数/证据**任务、不改任何源码；它当时能 pass，只是因为锚点符号那时还在。它把「计数器能不能检出回归」这件**该测的事**，绑在了一个**与 AC-354 的保证无关**的符号名上 —— 任何一次合法重构都能让负对照变成恒假。这是硬规则 4c 的「空转 / 恒假」近亲：判据点名的量没有穿过中间层（别人可以合法删掉）还取得到。

**AC-354 的保证是什么、不是什么**：它的保证**只有**「`root→gate/config` 边数 1→0、`gate/factories→gate/config` 行数 5→0，且这两个读数是**可证伪的测量**」。它**不**要求 goal-store.ts 导入任何特定符号 —— 那个符号名只是写判据时的偶然。

**为什么本任务不去给 goal-store.ts 硬塞一个 `resolveAcceptanceTimeoutMs` 导入**：那是为迎合正则而改源码，且与 `411bb34c7` 的 record-aware 意图直接冲突（record 自身的 `timeoutMs` 必须继续被尊重）。真正的「goal-store 直连 kernel」保证是 **AC-353** 的，今日同样为假，已由在飞任务承接，不在本任务范围。

**修法（重锚 criterion 的负对照，先例照搬）**：`gap-ac192-reanchor-criterion-to-attemptkey`（done）与 `gap-ac296-criterion-cmdline-port-literal-stale`（done）都因「判据测错字段 / 锚点随合法重构失效」而重锚 criterion 并补双向负控制；本任务同构 —— 把负对照改成**不依赖 goal-store.ts 的任何符号**，且断言从 `>=1` 加强为**恰好 `afterRoot + 1`**（同时防漏检与重复计数）。

<!-- dedup-ref -->
与 `gap-ac353-goal-store-deadline-resolver-not-kernel`（`goal_ac: AC-353`，status: todo）是**两条独立保证**、两片不相交的 Touches：那条改源码（`goal-store.ts` / `acceptance-runner.ts` / `kernel/gate-run-options.ts`），本任务只改 goal carrier 的 `criterion` / `origin` 字段与一个抽取该判据的测试文件。两者无 `depends_on` 关系：任一条先落地，另一条成立与否不变。另：同一次 `AC-242` 事件的 reason 同时点名 `AC-353, AC-354, AC-355` 三条转假 —— `AC-353` / `AC-355` 由那条在飞任务覆盖，本任务只闭合 `AC-354`。

## Plan

1. **重锚 criterion 的第 9 条负对照**（只替换 `scratchBefore` / `negCount` 那几行及其 CAUSE 分支；判据其余 8 条断言逐字不动）。新写法前插那条退休 import、不依赖原文任何一行：

```
const NEGCTL_LINE = "import { resolveAcceptanceTimeoutMs as __negctl } from \"./gate/config/utils.ts\";\n";
const scratchWithRegression = NEGCTL_LINE + rd(path.join(src, "goal-store.ts"));
const negCount = countRootToGateConfig(scratchWithRegression);
if (negCount !== afterRoot + 1) { console.error("CAUSE=negative-control-not-falsifiable -- a scratch copy of goal-store.ts with the retired import prepended did not raise the ./gate/config/ count by exactly one (after=" + afterRoot + ", scratch=" + negCount + "); the counter cannot be trusted to detect a real regression"); process.exit(1) }
```

   - `!== afterRoot + 1`（而非 `< 1`）是**加强**：漏检（0）与重复计数（>1）都判红。
   - `live()` 只剔 `//` / `*` / `/*` 开头的行；前插行以 `import` 开头 ⇒ 保留 ⇒ 可被计数。
   - ⛔ 这段 JS 嵌在 shell 单引号 `node -e '...'` 里：新代码**不得出现单引号**（引号一律用 `\"` / `\x27`，与前文一致）。
2. **经 `quay goal write` 落库**（⛔ 不是手工 Edit goal 文件）：`quay goal write AC-354 --goal GOAL-034 --criterion "$(cat <新判据文件>)" --origin "<重锚理由，点名本缺陷：负对照曾锚在一次无关重构 411bb34c7 移除的符号上，任何合法重构都能让它恒假>" --root <主检出>`；AC 记录必须带 `goal` / `origin`（否则拒写）。随后 `quay goal show AC-354` 读回确认 `criterion` / `origin` 已更新。
   ⚠️ goal 写要打到**主检出**（`--root`），不是任务 worktree 的副本 —— goal 与 task 的写入需要两个 root 同时到位，写偏了会出现「记录写了、提交没写」。
3. **正控制（在目标树上为真）**：`node packages/quay/bin/quay.js goal gate AC-354` ⇒ **exit 0**，逐字贴 stdout 的 JSON 四键 `fork_point` / `before` / `after` / `negative_control_count_on_scratch_regression`（⛔ 不得改写数值），以及 `.quay/gate-events.jsonl` 里新增那条 `item_id=AC-354` / `verdict=pass` 事件的 `timestamp` 与 `payload.criterionHash`。
4. **负控制双向（证明判据能取假、且不是恒真）**：把新判据文本拷进临时文件，做两处**确实改变文本**的定向变异并各跑一次：① 计数函数强制返回 `0`（`const negCount = 0;`）⇒ 必须 exit 1 且 CAUSE 仍是 `negative-control-not-falsifiable`；② 计数函数改为**重复计数**（如 `const negCount = afterRoot + 2;`）⇒ 必须 exit 1（由 `!== afterRoot + 1` 捕捉）。两次都贴退出码与逐字 stderr，并各贴一条证明变异确实改动了文本的读数（否则负控制自身是空转）。
5. **补一个抽取判据的耐久夹具**（新增 `packages/quay/test/ac354-negative-control-falsifiable.test.mjs`，形态照 `packages/quay/test/ac296-criterion-address-derivation.test.mjs`）：从 `goals/AC-354-*.md` 的 frontmatter `criterion:` 块**逐字抽取**判据文本，`spawnSync("bash", [tmpfile], {cwd: <repo root>})` ⇒ 断言 exit 0；再对同一文本做「计数强制 0」变异 ⇒ 断言 exit 1 且 stderr 含 `negative-control-not-falsifiable`；并断言变异**确实改变了文本**（未改变就报红，⛔ 不静默通过）。这是对「负对照可证伪」本身的测量，不是判据的门回声（硬规则 4）。
6. **不回归 / 不越界**：`bash scripts/test.sh --for-task gap-ac354-negctl-anchor-symbol-retired`（或等价 scoped 入口）绿；`git diff --name-only develop...HEAD -- packages/quay/src` 必须**为空**（本任务不碰任何源码、不改任何 gate 的运行时行为 / 退出码 / 错误文案）。

## AC

- [ ] **AC1（judge 已重锚且不减强度）**：`goals/AC-354-*.md` 的 `criterion`（经 `quay goal write` 落库、`quay goal show AC-354` 可读回）其负对照**不再引用 goal-store.ts 的任何符号或行**，且断言为 `negCount !== afterRoot + 1`；其余 8 条结构断言与 `expect` 语义逐字不变 —— 贴 `git diff`，只有负对照那几行与「为什么改」变化。
- [ ] **AC2（正控制：目标树上为真）**：`node packages/quay/bin/quay.js goal gate AC-354` ⇒ **exit 0**，逐字贴 stdout JSON（四键）与 `.quay/gate-events.jsonl` 新增的 `item_id=AC-354` / `verdict=pass` 事件行（含 `timestamp` 与 `payload.criterionHash`，须 ≠ `c1f3186e6c56cfd3`）。
- [ ] **AC3（负控制双向，硬规则 4 / 4c）**：① 计数强制 0 ⇒ exit 1 且 CAUSE=`negative-control-not-falsifiable`；② 计数重复计数 ⇒ exit 1。两次均贴退出码 + 逐字 stderr，并各贴一条证明变异确实改动了文本的读数。⛔ 只贴「改了判据文本」不算 —— 要贴**变异后跑出的红**。
- [ ] **AC4（结构断言一条不减）**：逐条命令可核 —— `kernel/gate-run-options.ts` 存在；`gate/config/utils.ts` 与 `gate/factories/loader.ts` **不存在**；`goal-store.ts` 的 `from "./gate/config/` 计数 = 0；`gate/factories/utils.ts` / `gate/factories/goal.ts` 的 `from "../config/` 计数 = 0。
- [ ] **AC5（耐久夹具）**：`packages/quay/test/ac354-negative-control-falsifiable.test.mjs` 存在，逐字抽取判据文本跑 exit 0、跑「计数强制 0」变异 exit 1，且变异无效时自身报红；`node --no-warnings --experimental-strip-types --test packages/quay/test/ac354-negative-control-falsifiable.test.mjs` 报 `fail 0`。
- [ ] **AC6（不回归 + 不越界）**：`bash scripts/test.sh --for-task gap-ac354-negctl-anchor-symbol-retired` 绿；`git diff --name-only develop...HEAD -- packages/quay/src` 输出为空。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是**一条真实的、能在树上前言为真的判据落了库，且其负对照双向可证伪**：

1. **落地对象**：`goals/AC-354-*.md` 的 `criterion` 经 `quay goal write` 落库（⛔ 非手工 Edit），`node packages/quay/bin/quay.js goal gate AC-354` 在目标树上 **exit 0**；重锚版随驱动的 doc→develop 同步可见（`git show develop:goals/AC-354-*.md` 显示新的负对照）——这是落地终点，不是本任务内可即时断言的前提。
2. **台账留痕**：`.quay/gate-events.jsonl` 出现 `item_id=AC-354` / `gate=goal` / `verdict=pass` 的新事件，其 `criterionHash` ≠ `c1f3186e6c56cfd3` —— 一条 dry-run 输出**不算**。
3. **负控制留痕**：两条定向变异（计数→0、计数→重复）各自的红与 `CAUSE=` 逐字留存，证明判据不是恒真（硬规则 4 推论三 / 4c）。
4. **保证不减**：AC4 的 8 条结构断言逐条命令可核；AC1 的 `git diff` 显示只有负对照与理由变化。⛔ 三种「凑绿」明令禁止：把断言放宽回 `>=1`、删掉负对照、或改 `expect` 语义。
5. **不越界**：`packages/quay/src` 零改动；AC-353 / AC-355 的保证不被本任务触碰（各有其载体）。
6. 本任务自身 `done` 并随 fan-in 落地。

## Touches

- `goals/AC-354-before-after-边数读数-可证伪负对照-root-gate-config-边数-1-0-gate-factor.md`
- `packages/quay/test/ac354-negative-control-falsifiable.test.mjs` (new)
- `tasks/gap-ac354-negctl-anchor-symbol-retired.md`

## Evidence

（filing 轮读数，供 worker 复核起点）本轮直跑 AC-354 判据：exit 1，`CAUSE=negative-control-not-falsifiable`（`.quay/gate-events.jsonl` `timestamp=2026-10-12T21:09:36.859Z`、`criterionHash=c1f3186e6c56cfd3`、`verdict=fail`）。逐条复跑：8 条结构断言全通过，第 9 条负对照转假。锚点符号消失的机械证据：`git log -S'./kernel/gate-run-options.ts' -- packages/quay/src/goal-store.ts` 只回 `56ba0b61b`（加入）与 `411bb34c7`（移除）；`grep -nE 'import\s*\{\s*resolveAcceptanceTimeoutMs' packages/quay/src/goal-store.ts` 零命中。上游 stale 读数：`.quay/gate-events.jsonl` 里 `item_id=AC-242` 的一条 `reason` 逐字写着 `stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: AC-353, AC-354, AC-355`。