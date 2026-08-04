---
id: gap-task-write-accepts-a-title-that-breaks-its-own-frontmatter
title: "task_write accepts a title containing ## or : and writes frontmatter
  that will not parse — it fails hours later, at render time"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

2026-08-03 的线上 500（详见姊妹任务 [[gap-one-unparseable-task-takes-down-the-whole-board]]）
有两层缺陷。**本任务是写入侧那一层**：

> **没有任何东西阻止写出这种标题。它在写入时不报错，只在渲染时炸，
> 而写入者与渲染者之间隔着几小时。**

具体：外层通过 `task_write` 建任务，标题里写了 `## Contract`（**这是自然的写法**——
标题就是在说那个块）。写入侧原样落盘、不加引号，YAML 里**空格后的 `#` 是注释起始** ⇒
title 被截断成 `The`，续行失去可续对象 ⇒ 该文件从此不可解析。
**写入返回成功，几小时后人在浏览器上撞到 500。**

### 危害面：44% 的标题落在这条雷上（外层用真解析器实测）

```
tasks/ 全部 605 个 frontmatter，yaml.parse:  0 failures（止血后）
title 含 " #" 或 ": " 的:                    265  （44%）
```

**⇒ 它们今天没炸，只是因为写的时候碰巧加了引号。** 缺陷不是「有人写错了一次」，
是**正确性依赖写入者每次都记得加引号，而机器完全可以代劳**。

### 判据方向（人给的，双向）

- **写入侧**：`task_write` 时就**拒绝或自动加引号**
- 渲染侧：一个坏任务只坏它自己那一行 ⇒ **姊妹任务**

**外层的判断：自动加引号优于拒绝。** 理由：拒绝会把一个纯粹的序列化细节推给调用者，
而调用者（人或 agent）想表达的标题本身没有任何问题；
**序列化的正确性是写入侧的职责，不是内容作者的职责**。
但**拒绝路径仍需保留给真正无法安全序列化的输入**（若存在），并给出可执行的修改建议。

## Contract

```
measure roundtrip_ok = `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task get <id> --json` 输出的 title 与写入值是否逐字节相同的布尔字段
measure parse_ok = `node -e '<yaml.parse of the written file>'` 的成功布尔字段
band roundtrip_ok = true
invariant 写入侧负责序列化正确性；标题内容不被改写（只加引号/转义，不删字符）
invoke `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task edit <id> --title '<hazardous>'`
control 写入含 `## X` 与含 `: ` 的标题 ⇒ 文件可解析且读回逐字节相同；去掉修复 ⇒ 至少一个方向失败
resume 先加写入侧引号/转义，再补测试覆盖各类危险字符
```

## Chosen mechanism

1. **`task_write` / `task edit` 在写 frontmatter 时对 `title`（及其它字符串标量）做 YAML 安全序列化**——
   需要引号就加引号，需要转义就转义。**用序列化库的能力，不要手写正则拼字符串**
   （手写引号规则正是这类缺陷的来源）。
2. **内容一字不改**：只改变它在文件里的**表示**，读回必须与写入逐字节相同（AC1 的往返判据）。
3. **危险字符集用真解析器推导，不靠列举**：对候选字符逐个写入 → 解析 → 读回，
   **由测试确定哪些需要引号**，而不是凭印象列一张表。

**不做**：不改已有任务文件（止血已完成）；不在写入侧做内容校验或改写标题；
不做渲染侧容错（姊妹任务）。

## Acceptance Criteria

- [x] AC1: **往返判据**——写入含 `## Contract` 的标题 ⇒ 文件 `yaml.parse` 成功，
      读回的 title 与写入值**逐字节相同**（实跑输出贴任务体）
- [x] AC2: 同上，标题含 `: `（如 `god-package: gate/ has fanOut=62`）
- [x] AC3: **负控制**——移除该序列化修复后，AC1/AC2 中至少一个**必须失败**
      （证明测试真的在测这条路径，而不是恰好通过）
- [x] AC4: 危险字符集**由测试推导**（逐字符写入-解析-读回），结论写进文件头；不得只列一张手写表
- [x] AC5: 全库回归——修复后重跑真解析扫描仍 **0 失败**，且 **265 个含 `#`/`: ` 的既有标题读回不变**
- [x] AC6: 测试用 `node:test` 且带 `// @test-group product`（`task_write` 是 Provider ABI 面）

## Definition of Done

- [x] AC3 的负控制实跑输出贴进任务体——**一个从未失败过的往返测试，与没有测试不可区分**
- [x] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [x] 任务体记录：触发这次故障的标题是**自然写法**，
      **缺陷在于系统把序列化正确性的责任推给了内容作者**

### invoke 实跑证据（task-contract-check 消费者：done 任务必须展示 invoke 入口路径）

`packages/quay-native/bin/quay-native.ts task edit <id> --title '<hazardous>'`（Contract invoke：写入含 `##`/`: ` 的危险标题 ⇒ 文件可解析且读回逐字节相同，即 AC1/AC2 往返判据）——由 `scripts/test.sh packages/quay-native/test/store.test.mjs` 覆盖 → ℹ tests 5 / pass 5 / fail 0 / cancelled 0 / skipped 0。
全量 quay-native 58/58 通过；live-GitHub conformance 探针含 2 条新增 hazardous-title 样本，全部通过。
批量 fan-in 全量：tests 2298 / fail 0 / cancelled 0 / skipped 27。

## Touches

- packages/quay-native/src/store.ts
- packages/quay-native/test/store.test.mjs
- packages/quay/test/cli-edit-parity-conformance.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T15:35:00Z
changed: 人给的判据是双向的（写入侧拒绝或自动加引号 / 渲染侧只坏一行），
**外层拆成两个任务**：不同包、可并发、各自独立可落地。
**并在两条路里选了自动加引号**：拒绝会把一个纯序列化细节推给调用者，
而调用者想表达的标题本身没问题——**序列化正确性是写入侧的职责**；
拒绝路径保留给真正无法安全序列化的输入。
**危害面用真解析器量过**：605 个 frontmatter 现 0 失败，但 **265 个（44%）标题含 `#` 或 `: `**，
**它们今天没炸只是因为当时加了引号** ⇒ 缺陷不是「有人错了一次」，
是**正确性依赖每次都记得**。
**AC3 是防自证的负控制**：移除修复后往返测试必须失败，否则无法与「恰好通过」区分。
**AC4 要求危险字符集由测试推导**而非手写列表——手写引号规则正是这类缺陷的来源。
