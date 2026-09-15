---
id: gap-meta-driver-proposal-lacks-supersedes-field
title: gap-meta-driver-proposal-lacks-supersedes-field
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
## Finding

`plugin/scripts/meta-driver.ts` 里的 `Proposal` 接口（`export interface Proposal { goal: string; title: string; criterion: string; expect: string; origin: string; }`，约 :1014）没有 `supersedes` 字段，`writeDraftProposal()`（约 :1054）和 `parseProbeOutput()`（约 :2070，解析 LLM 输出的 `proposals` 数组）也都不支持它。这导致 meta-driver 的语义"probe"（每轮真 LLM 调用，读取跨 GOAL 的机械读数后可以在返回 JSON 里给出新 draft AC 提案）目前**没有能力表达**"这条新提案是用来替代/淘汰某条既有 AC，因为那条 AC 已经偏离 GOAL 的业务目标"这种语义。

目前系统处理"AC 偏离 GOAL 业务目标"这件事的唯一路径是 `decisions` 通道（同文件），它把处置权完全交给人工——prompt 原文（约 :1823/:1845）写死："认可某个选项 ⇒ goal-store write <id> --status active；否决 ⇒ 保持 draft 或标 superseded"，人还要自己手动去执行这个 supersede 动作，中间没有任何机制记录"新提案 X 是为了取代旧 AC Y"这层关联。

底层机制其实已经具备：`packages/quay/src/goal-store.ts` 的 frontmatter 白名单字段里已经原生包含 `"posture", "supersedes", "superseded-by", "long-term", "fidelity"`（约 :317/:2355），只是 meta-driver 的提案数据结构和写入路径没有透传这个字段。

2026-09-15 会话内证据：直接读代码确认上述接口/调用链现状（grep `Proposal`/`supersedes`/`writeDraftProposal` 定位到的行号如上，均为直接读取所得，非推测）。

## Requested action

- `Proposal` 接口新增可选字段 `supersedes?: string`（指向被取代的旧 AC id）。
- `parseProbeOutput()` 解析 LLM 输出的 `proposals` 数组时，识别可选的 `supersedes` 字符串字段（缺省 ⇒ 行为与现状完全一致，不破坏任何既有路径）。
- `writeDraftProposal()` 在 `p.supersedes` 非空时，把它作为 `--supersedes <旧id>` 传给 `goal-store write`（先确认 `goal-store` 的 CLI/`write()` 是否已经支持写入 `supersedes` 这个 frontmatter 字段本身——若尚未支持，需要一并补上这条写入路径；若已支持只是没在 meta-driver 侧透传，则只改 meta-driver 这一层）。
- ⛔ 明确的设计边界（防止过度自动化，必须在实现里体现并有测试守住）：本任务只让"新提案携带 supersedes 声明"这一件事可行——**不得**让 `writeDraftProposal` 或任何新增代码顺带机械地把被指认的旧 AC 状态翻成 `superseded`。旧 AC 的真实状态翻转仍然必须是人工动作（或未来另一条任务、经过明确审阅后再做）。也就是说，这次新提案落地后，旧 AC 在 `goals/*.md` 里的 `status` 字段必须逐字保持不变。
- probe 的规格/prompt 若有维护正文，建议追加一句提示语义半："当你判断某条既有 AC 已经偏离 GOAL 业务目标、需要被新提案取代时，可以在该 proposal 里带上 supersedes 字段指向那条旧 AC 的 id，但不要、也没有能力自己去改旧 AC 的状态——那仍然是人的决定。"

## Acceptance Criteria

- [x] `Proposal` 类型与 `parseProbeOutput()` 能正确解析可选的 `supersedes` 字段；缺省时（LLM 没给这个字段）解析结果与改动前逐字一致（需要一条回归测试覆盖"零变化路径"）
- [x] 传入 `supersedes` 的提案经 `writeDraftProposal` 落地后，读回新 AC 的 frontmatter 能看到 `supersedes` 字段（用 `goal-store list`/等价读法验证）
- [x] 负控制单测：新 AC 落地前后，被指认的旧 AC 的 `status` 字段逐字相同（断言"不变"，不是断言"变成了 superseded"——这条测试的存在本身就是在守住"不得机械翻转旧 AC 状态"这条设计边界）
- [x] 至少一条端到端单测：从"LLM 输出的 proposal JSON 带 supersedes"到"新 draft AC 文件的 frontmatter 含 supersedes 字段"全链路打通

## Definition of Done

代码落地 + 单测覆盖（含上述负控制）+ 该文件所属的 scoped 静态门/测试绿 + 不引入任何把 AC 状态自动翻成 `superseded`/`active`/其它值的新机械写路径（这类状态翻转的决定权保留在人）。

origin: 2026-09-15 与用户就 goal-driver/meta-driver 语义分工的会话内讨论（用户四点目标 design 中的第④点："如果发现 AC 和 goal 的业务目标有偏差，也应调整 AC（包括删除）"——会话内讨论结论是：新建替代性提案可以半自动化，但淘汰旧 AC 这一步应保持人工确认，`supersedes` 字段是让"半自动"这一半可行的最小改动）。

## Implementation

**Finding 的前提有一处需要更正**（实测所得，不是读 diff 推的）：`goal-store` 侧不是「已支持、只是没透传」——`write()` 早有 `supersedes?: string[]`（goal-store.ts:1913，:2002 落盘），但 **CLI 表层从来没有这个 flag**（`runGoalStoreCli` 的白名单里只有 `--superseded-by`），所以任何 CLI 写者都结构上无法携带它。任务体已预见这一支（"若尚未支持，需要一并补上这条写入路径"）⇒ 补上了。

同路径上还实测到一处**静默丢弃**（硬规则 5b 的兄弟实例：同一字段、同一写路径）：不带 `--store` 时 `cli/goal.ts` 把写请求路由到 Provider ABI，而 ABI 的 `goal_write` view-model 没有这个字段 ⇒ `quay goal write AC-008 … --supersedes AC-007` 打印 `wrote AC-008`、**exit 0**，字段却从未落盘（实测 `grep -l supersedes` 命中 0）。已把 `supersedes` 加进 `STORE_ONLY_WRITE_FLAGS`，并用同一条调用复验（字段落盘、旧 AC 仍 active）。

⛔ 设计边界是**结构性**的，不是靠约定维持：`write()` 的处置分支闸在 `isGoalRecord && nextStatus === "active"`（goal-store.ts:2322），而本 driver 只写 `AC-*` ⇒ 旧 AC 的 status 在任何路径（含 activation）上都不可达。负控制断言被指认文件**逐字未变**。

验证（三条都是真执行，不是读代码）：
- 零变化路径：把 HEAD 版 `meta-driver.ts` 与改动版**并排真跑**同一输入 ⇒ `IDENTICAL: true`（键集也相同，⛔ 不是 `supersedes: undefined`）
- 红控制 A：去掉 argv 透传 ⇒ 端到端测试变红（127 pass / 1 fail）
- 红控制 B：去掉 store 的 CLI flag ⇒ 变红（126 / 2）

## Touches

- `plugin/scripts/meta-driver.ts`
- `packages/quay/src/goal-store.ts`
- `packages/quay/src/cli/goal.ts`
- `plugin/probes/meta-driver.md`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-driver-proposal-lacks-supersedes-field.md`