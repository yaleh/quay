---
id: gap-suite-bucket-attribution-pathjoin-run-header-blind-spot
title: "桶归因盲区——path.join 构造路径不可见 + Run: 头注释 scripts/test.sh 字面误当 subject ⇒ M
  机制测试归成 S 单例，M 触发静默跳过（166 文件受影响）"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`suite-bucket-attribution.ts`（AC120）只认字面相对路径（`./x`、`../x`、`scripts/test.sh` 子串）作为 subject 证据。**两个结构性盲区**合谋，把「测 M 机制」的测试误归成 S 单例，M 触发的 bucket 运行静默跳过它们：

1. **path.join 构造路径不可见**：测试用 `path.join(REPO_ROOT, "plugin", "scripts", "fan-in-ff-merge.sh")` 引用脚本时，fragments 是分散的 quoted 字符串，没有 `./`/`../` 相对路径形态 → 归因解析不出 M 信号。
2. **Run: 头注释的字面 `scripts/test.sh` 误当 subject**：测试文件头部 `Run: scripts/test.sh <file>` 是「怎么跑」不是「测什么」，但归因把 `scripts/test.sh` 子串匹配成 S 桶证据（`S_PREFIX = /scripts\/test\.sh/` 裸子串匹配）。头注释提到 `scripts/test.sh` ⇒ 归 S。

**实证**：`fan-in-workflow-lock.test.mjs` 归因返回 `S`（直接跑 classify 验证），但它的真 subject 是 `fan-in-ff-merge.sh`（M 机制，path.join 构造 ⇒ 不可见）；`fan-in-ff-merge.test.mjs` 的 AC121 重归因被 pin 成 `S`（mechanism=S+M，signal=concurrency）。`gap-fan-in-workflow-lock-stale-runid-detached-holder` 触发 M 桶时，这两个**直接测被改文件**的测试不在 M 桶里（`full=0 buckets=M files=250`，paths-only 无这两个文件）——**任务改了测试文件但 fan-in 的 M 桶不跑它**。

**规模**：全仓 258 个测试文件含 `scripts/test.sh` 字面串；其中 plugin/test 下 **166 个**同时用 path.join 构造脚本路径 = 同款误分类类。M 触发的 fan-in 系统性跳过它们。结构性——新测试沿用惯用写法（Run: 头 + path.join）即自动加入。

## Plan

1. **归因解析 path.join 构造路径**：`suite-bucket-attribution.ts` 提取 quoted string 时，把连续 `path.join(` 内的 string fragments 拼成候选相对路径（`path.join(ROOT, "plugin", "scripts", "foo.ts")` → `plugin/scripts/foo.ts`）；命中 M/P 前缀即算 subject 证据。保守：只认字面 `path.join(` + 字符串 fragments 全为相对段（无 `..` 越界、无变量插值）。
2. **Run: 头注释排除出 subject 判定**：头注释区（`//` 注释，尤其 `Run:` 行）里的 `scripts/test.sh` 不构成 S 证据。把 S_PREFIX 匹配限定到代码区（跳过 `//` 注释行），或只认真正 spawn 的 `scripts/test.sh` 形态（`spawnSync("bash", [..., "scripts/test.sh"` 等）。
3. **复核 fan-in-ff-merge.test.mjs 的 AC121 重归因**：它测的是 M 文件，`judgment:S` 可能是与 ①② 同源的误判（`signal:concurrency` 不足以 pin S）；重归因记录按新归因结果更新。
4. **AC123 both-sides 自带**：M 信号一旦不丢，{S,M} 交叉桶在 M 触发时自然选中（无需改选择规则）。

## Acceptance Criteria

- [ ] AC1（能取假，M 信号不丢）：`suite-bucket-attribution` 对 fan-in-workflow-lock.test.mjs 返回含 M 的桶集（⛔ 仍返回 S 单例 ⇒ 假）。
- [ ] AC2（能取假，Run: 头不算 subject）：把 `Run: scripts/test.sh` 加进一个仅测 M 机制的测试头部，归因不受 S 影响（⛔ 头注释仍归 S ⇒ 假）。
- [ ] AC3（能取假，选择修复）：`suite-bucket-select --task gap-fan-in-workflow-lock-stale-runid-detached-holder --paths-only` 输出含 fan-in-workflow-lock.test.mjs + fan-in-ff-merge.test.mjs（⛔ 仍排除 ⇒ 假）。
- [ ] AC4（能取假，负控制）：一个真 S-only 测试（subject 真是 scripts/test.sh）保持 S 归因（⛔ 修复把 S 信号也丢了 ⇒ 假）。

## Definition of Done

归因能解析 path.join 构造路径；Run: 头注释不构成 subject 证据；M 触发的 bucket 包含被改测试文件；真 S-only 测试归因不变；AC1-AC4 全勾；全量 bucket 归因对既有 166 个误分类测试重算后不引入新回归。

## Touches

- plugin/scripts/suite-bucket-attribution.ts（path.join fragments 合并 + Run: 注释排除 subject）
- plugin/test/suite-bucket-attribution.test.mjs（path.join 构造路径归因 + Run: 头负控制测试）
- plugin/scripts/suite-bucket-select.ts（若选择侧需同步；首选不动——AC123 both-sides 应自带）
- .quay/suite-bucket-reattribution.jsonl（fan-in-ff-merge.test.mjs 的 S pin 复核）
- tasks/gap-suite-bucket-attribution-pathjoin-run-header-blind-spot.md（自身）
