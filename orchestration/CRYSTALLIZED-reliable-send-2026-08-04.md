# 结晶：跨会话可靠发送——今晚 5 个独立故障模式的算法化

**日期**：2026-08-04（管理者，人要求把反复出现的手工修法固化到脚本）
**背景**：`send-keys-verified.sh` 的哈希判据已被 F 判定 superseded，指向 D
（`gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable`，已 done）。
**但 D 的范围只是「分类器本体 + 接线」**（判断目标在不在等输入），**不覆盖「发送」这一半**——
本文档记录的 5 个故障模式，全部发生在发送侧，D/B 都不管。**F 关掉后这块地是空的。**
**同源标注（2026-08-05）**：D 的「单一代理信号不足以判定状态」原则在这里还有第二个实例——
`gap-outer-heartbeat-source-inverts-under-incident-handling`（外层心跳源从 tick-log 单源改为多源
max mtime；红窗处置写 queue-state + 提交但不写 tick-log，单源会把「越认真处理事故」读成「心跳越旧」）。

以下每一条都是今晚真实发生、非推断的故障，附证据。

---

## 故障 1：`C-u` 只清当前行，多行残留清不掉

**证据**：AC3b 那条 1554 字节的交办文本发送失败后重发，第一次 `C-u` 后 pane 仍显示大半段原文，
出现 `Ctrl+Y to paste deleted text` 提示（readline kill-line 语义——只杀到光标所在行行首）。
**实测需要连续 30 次 `C-u` 才清空**一条约 20 视觉行的长消息。

**修法**：循环 `C-u` + `capture-pane` 检查是否已空，**不是盲发固定次数**——次数因消息长度而异，
应有上限（如 50 次）防止死循环，超限则报失败而非静默继续。

## 故障 2：长文本后紧跟 `Enter`，接收端处理不完时回车不生效

**证据**：隔离探针字节级验证——1554 字节文本 + `Enter`，tmux/pty 层**投递完全正确**
（`Enter` 字节在最后一个文本字节后 58ms 到达，顺序不乱）。但发到真实 outer 会话时**没有提交**，
文本原样留在输入框。这排除了 tmux 丢键，问题在接收端（TUI 处理长文本渲染未完成时回车落空）。

**修法**：发送文本后，**轮询 `capture-pane` 直到连续两次内容一致**（渲染已稳定）再发 `Enter`，
不是发完文本立即发 `Enter`。稳定判断可复用 D 的分类器已有的「形状 + 持续性」概念。

## 故障 3：即使空闲、即使等了渲染稳定，`Enter` 仍可能不生效

**证据**：AC3b 第二次重发，外层**空闲**（无 `esc to interrupt`），`C-u` 清空验证过、`sleep 0.8` 等过，
`Enter` 仍未提交；补发一个**独立的 `Enter`** 后才真正落进 transcript。

**修法**：**必须验证真实送达**（见故障 5），未达则补发一次独立 `Enter`，仍未达则报失败，
不能假设「发过 Enter」= 「已提交」。

## 故障 4：确认"已提交"和"真正落进 transcript"之间可能有排队延迟

**证据**：假阳性核实消息发送时外层正忙，`Enter` 发出后输入框立即清空，但 transcript 里
**30 秒后**才出现那条消息——推断是进了排队而非立即处理。若在这 30 秒窗口内就判「失败」并重发，
会造成重复提交或错误诊断。

**修法**：送达确认必须是**有界轮询**（如 60 秒超时），不是单次检查；用 Monitor 工具的
until-loop 承载这个等待，不要用短 sleep 硬编码猜测延迟。

## 故障 5：三种"看起来送达"的信号，全部被证明不可靠——唯一可信的是接收方 transcript

| 信号 | 可靠性 | 证据 |
|---|---|---|
| `send-keys-verified.sh` 的哈希 exit 0 | ❌ | 文字进框会改哈希，提交也会改哈希，分不清两者——F 已判定 |
| 输入框显示为空 | ❌ | 故障 4：空了但还没真正提交（在排队） |
| `SESSION-RESUMED` 监视器事件 | ❌ | 多次核实过是其它原因触发（如别的会话恢复活动），不代表这条消息被处理 |
| **目标会话自己 transcript jsonl 里出现真实 user message，内容匹配** | ✅ | 本仓唯一在今晚被反复验证成立的信号 |

**修法**：送达判据只认最后一条——`grep`/解析目标 `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`，
确认新增了一条 `message.content` 匹配（或包含）发送内容的 `user` 消息。

---

## 故障 6：gray ghost-suggestion 无法硬清空——C-u/C-a+C-k 循环都清不掉，直接输入覆盖

**证据**：2026-08-04 外层驱动内层修复 ready-pool-check overshoot 缺陷时，输入框残留一行
「修 ready-pool-check…」。`C-u` 循环 5 次 + `C-a`/`C-k`/`C-u` 组合**全部无法清除**
（pane 内容逐字不变，与故障 1 的「C-u 清不掉多行残留」不同——这里连单行都清不掉）。

**判据**：**C-u/C-a+C-k 循环 N 次后 pane 内容逐字不变 ⇒ 判定为 gray ghost-suggestion**
（ADR-016 已记载：自动建议文本，显示但 **Enter 不提交、C-u 不清**），不是真残留。

**修法**：**不再尝试清空——直接输入目标文本覆盖它**（输入会替换 ghost 占位），Enter 提交，
然后用 **transcript 核实**（故障 5 的唯一可信信号）。与故障 1 的区分：故障 1 是「真残留但 C-u 只清
当前行」，循环 C-u 最终能清空；故障 6 是「ghost 显示」，循环 C-u 永不生效——**判定靠「循环后 pane
内容是否逐字不变」**。

> **已被环境配置从源头消除（2026-08-05 立案 / 2026-08-06 实跑验证，
> `gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false`）**：
> 启动规范（`.claude/launch.settings.json` + `plugin/scripts/quay-launch.sh`）已把
> `--prompt-suggestions false` + `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` 列为**必带参数（REQUIRED）**，
> 输入框不再渲染灰色占位建议 ⇒ 故障 6 不再出现。**运行时判定逻辑（直接输入覆盖）保留作历史兜底**——
> 不删（防未来版本行为变化 / 非本仓启动的会话仍可能带 ghost）。
**2026-08-06 标注（gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false）**：
故障 6 **已被环境配置从源头消除**——`--prompt-suggestions false` +
`CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`（冷启动 REQUIRED 参数，人裁定非可选）从根上关掉
输入框的灰色占位建议，故障 6 不再出现（throwaway 双向验证：带配置 ⇒ 输入框 `❯` 后无建议；
不带配置 ⇒ `❯ Try "edit <filepath> to..."` 灰色建议出现，见任务体 AC1/AC2）。
**运行时判定逻辑（直接输入覆盖）保留作历史兜底**——防未来版本行为变化（例如 flag/env 失效、
新形态 ghost），不删。

**2026-08-06 标注（AC7，gap-residue-check-crystallized-as-tool-mode）**：故障 6 的**运行时判定逻辑
现由工具承载**——`plugin/scripts/pane-state-classify.ts --check-residue` 把「框里有字 vs 真的提交了」
从角色目测结晶成命令产物：对目标 pane 循环 C-u + capture，`C-u 后输入行变空 ⇒ real-unsubmitted-text`、
`C-u 循环 N 次 pane 逐字不变 ⇒ ghost-suggestion-only`（有界 N=50、判不了 fail-loud 报 unknown）。
本节的判据（「循环后 pane 内容是否逐字不变」）是纯函数 `classifyResidueFromCaptures` 的唯一判据，
夹具三态为 2026-08-06 真实录制。**源头消除后此工具仍作历史兜底**：flag/env 失效或新形态 ghost 再出现
时，发送前的 residue 检查会先于故障 6 的「直接输入覆盖」把它机械地判出来，不靠人目测。

## 故障 7：全新会话的 welcome 屏占位符——C-u 循环清不掉、直接覆盖也卡（第六种送达失败模式）

**证据**：2026-08-05 archguard 外层首次驱动自己的内层时，send-keys-reliable.sh 在**全新 welcome 屏**
上卡死：第 1 步的 C-u 清屏循环**清不掉 TUI 的 ghost placeholder**（那句 `Try "how do I log an
error?"` 的灰色占位提示），clear 循环跑满 N=50 上限后 fail loud 退出，驱动发不出去。archguard 外层
改用手动序列（`-l` 发送 → 等稳定 → Enter）成功，并用 transcript `76bbb31e` 核实了 1648 字节驱动文本
确实作为 user 消息落地。

**同一根因的另一面（meta-cc 独立观测吻合）**：06:59Z 驱动 meta-cc 时撞到**长文本被 TUI 折叠成 paste
块**，pane 底部显示 `paste again to expand`，看起来像没送出去——但 transcript 核实是**送到了**。
合起来是同一个根因的两个表现：**全新会话的 TUI 处于一个 C-u 语义与已用过的会话不同的状态**
（占位符不是 readline 缓冲内容，C-u 对它无效），而清屏循环把「清不掉」当成了失败。

**与故障 6 的区分**：故障 6 是**已用过的会话**的 gray ghost-suggestion（`Enter` 不提交、`C-u` 不清，
直接输入覆盖可解）；故障 7 是**全新 welcome 屏**的 placeholder（`C-u` 无效且**直接覆盖后仍可能显示
不清**，清屏循环把「清不掉」当成失败）。**为什么重要**：它专门打在**冷启动**上——恰恰是第一次驱动
一个新项目的时刻，也就是 cold-start 的 INNER-DRIVEN 判据要用这个脚本的时刻。前五种模式全在**已用过
的会话**上测出来，第六种只在新会话出现，此前测不到。失败形态是 fail-loud（这点是好的），但后果是
**冷启动被卡住**——而冷启动正是要产品化的东西。

**修法（外层裁定方向）**：清屏循环的终止条件不应是「输入框内容为空」，而应是「**输入框不含用户输入
的内容**」——占位符是 TUI 渲染的提示文本，不是待清除的输入。可判据做法：记录 welcome 屏的占位符
文本，清屏循环把它当成空等价物；**更省事**：把「fresh session（transcript 不存在或零条 user 消息）」
当成一个已知分支，**跳过清屏直接发**——后者更简单且正好覆盖冷启动场景。修法实现归内层
（`gap-reliable-send-crystallize-the-five-failure-modes-into-a-script` 或 re-open）。

## 故障 8：判空把 NBSP 当非空白——【任何】输入框的空盒判定都坏（不只是 welcome 屏）

**证据（2026-08-05，archguard 报 + 管理者独立验证扩大范围）**：**任何** Claude Code 输入框空闲时
`❯` 之后的字节是 `c2 a0`（NBSP U+00A0），而脚本判空用 `case ... in *[![:space:]]*)`——bash 的
`[:space:]` 在 **C locale 下不含 NBSP** ⇒ NBSP 被当非空白 ⇒ **永远判「非空」** ⇒ clear 循环必然跑满
CLEAR_MAX=50 后 fail loud（脚本第 109 行）。逐字节验证：quay-0:outer 与 meta-cc-3:outer 两个【真正空的】
输入框，`❯` 后全部字节就是 `c2 a0`，脚本判「非空」；外层当场复现（对真空输入框输出「输入框在 50 次 C-u
后仍未清空——fail loud」）。

**与故障 7 的关系**：故障 7 是「welcome 屏 placeholder 清不掉」；故障 8 是「判空把 NBSP 当非空白」——
后者**对任何输入框都生效**，是故障 7 的放大版根因（即使没有 placeholder，空盒也判不空）。**三个消费者
（quay/meta-cc/archguard）全部静默绕过本脚本**（改用手动序列 `send-keys -l` → sleep → Enter），所以坏了
数小时无人报。既有测试全绿正是因为它们只覆盖用法错误 + transcript 纯函数，**从不起带真实提示符的 tmux
pane**——clear 循环对真实 TUI 的行为恰是唯一坏掉的部分（命中 CLAUDE.md 测试分层判据：用户面契约需 ≥1
真实 e2e）。

**修法（实现：`gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box`）**：判空显式剥离
NBSP——bash 参数展开 `nbsp=$'\302\240'; after="${after//$nbsp/}"` 精确删掉两字节 NBSP 序列后再走
`[:space:]` 判空，**不依赖 locale 行为**。真空输入框（`❯` + `c2 a0`）立即判空，clear 循环不再跑满
CLEAR_MAX。配套真端到端测试：起一个渲染 `❯`+NBSP 提示符的夹具 tmux pane，驱动一次、transcript 核实
送达，并用 `RELIABLE_CLEAR_MAX=2` 证明 clear 循环快速退出（回归则 fail-loud，RED 已证）。

## 算法（交给外层判断具体实现位置——新脚本，或重写 `send-keys-verified.sh`）

```
输入: target(tmux 目标), text, target_session_jsonl(目标会话的 transcript 路径)

0. 分支（故障 7）：fresh session（target transcript 不存在 或 零条 user 消息）⇒ **跳过清屏直接进
   步骤 2**——全新 welcome 屏的 placeholder 不是可清除的输入，清屏循环只会 fail-loud 卡死冷启动。

1. 清空目标输入框（仅已用过的会话——故障 7 分支在步骤 0 已分流）：
   loop up to N=50:
     send-keys target C-u
     if capture-pane(target) 已空: break
   若循环到上限仍未空 → 报失败（fail loud），不静默继续
   终止条件 = 「不含用户输入的内容」，不是「逐字为空」（placeholder 是渲染提示非输入）

2. 发送文本：
   send-keys target -l text   # 三次分开调用里的第二次，ADR-016 既有规矩

3. 等待渲染稳定：
   loop with bounded timeout (如 10s):
     a = capture-pane(target); sleep 0.3; b = capture-pane(target)
     if a == b: break   # 连续两次一致 = 稳定

4. 提交：
   send-keys target Enter

5. 验证真实送达（有界轮询，如 60s，用 Monitor 承载）：
   until grep 目标 session jsonl 中出现内容匹配的真实 user message:
     sleep 5
   若命中 → 成功，退出
   若单次超时（如 15s）仍未命中 → 补发一次独立 Enter（故障 3 的修法），重新计时等待
   若二次超时仍未命中 → 报失败（needs-human / 显式失败），不能假装成功
```

---

## 与今晚其它裁定的关系

- **不依赖哈希**——与 F 的判定、D 的分类器方向一致，是同一场重构的送端补完。
- **步骤 3 的"稳定判断"复用 D 的形状/持续性概念**，不是重新发明一套。
- **这条不是紧急阻塞项**——今晚的手工修法（分步验证+补发+轮询）已经把每一次失败都救回来了，
  只是每次都要管理者/外层现场诊断。结晶的价值是**让这个诊断过程不必再重复**。

---

## 实现状态（2026-08-04 — gap-reliable-send-crystallize-the-five-failure-modes-into-a-script）

本文档的算法已结晶为可执行件（任务 `gap-reliable-send-crystallize-the-five-failure-modes-into-a-script`）：

- **`plugin/scripts/transcript-delivery-check.ts`** — 故障 5 的送达判据，**纯函数**
  `checkTranscriptDelivered(transcriptFragment, sentText) -> {delivered, matchedLine}`：
  无副作用、不调 tmux、不读文件以外的源（文件读取只在 CLI 包装层发生）。判据只认
  **真实 user message**（`type:"user"` 且 `message.role:"user"`）且其内容**包含**发送文本；
  tool_result 注入上下文、assistant 消息、整行/整屏哈希一律不认（ADR-016 Amendment boundary (c)，
  F 判死的哈希不借尸还魂）。
  CLI：`node --experimental-strip-types plugin/scripts/transcript-delivery-check.ts
  --check <jsonl> [--start <bytes>] --text <text>`；exit 0=已送达 · 1=未送达 · 2=用法或 IO 错误（fail loud）。
  `--start <bytes>` 实现故障 4 的「只看新增」基线——轮询只扫 baseline 之后追加的内容，
  旧的一模一样的历史消息不会被误判为本次送达。

- **`plugin/scripts/send-keys-reliable.sh`** — 五步算法本体（步骤 1–5 一一对应本文档 §算法）：
  1. 循环 C-u + capture-pane 查空（上限 N=50，超限 fail loud）——故障 1；
  2. `send-keys -l` 原样发送文本；
  3. 轮询 capture-pane 连续两次一致（渲染稳定，有界 10s）——故障 2；
  4. 发 Enter；
  5. 有界轮询目标 transcript jsonl（60s；首窗 15s 超时补发一次独立 Enter，故障 3；二次超时
     fail loud，不假装成功）——故障 3/4/5。

- **`plugin/test/send-keys-reliable.test.mjs`** — 纯函数夹具测试（outer ruling R3：不建/不杀任何
  tmux 会话、不调 tmux；无 tmux server、无 pty、无假 TUI）。`@test-group governance`，node:test，
  覆盖 AC4/AC5/AC7/AC8 与 ## Contract 的 measure CLI 路径。

实跑证据（2026-08-04，任务 AC5/AC6/AC7）：
- **AC6 真实对象**：真实 transcript
  `~/.claude/projects/-home-yale-work-quay/74cfbc0e-9db3-4d06-b799-8597370ba773.jsonl`，
  取其真实 user message「执行 /home/yale/work/quay/plugin/loop/fast-mode-loop-tick.md 中的 tick 指令」为发送文本
  ⇒ CLI `delivered: true`，exit 0；负控 `--text "AC6-REAL-OBJECT-NEVER-SENT-42"` ⇒ `delivered: false`，exit 1。
  （全量「跨会话真实发送」未在本环境执行——所有现存 tmux 会话均属运行中的 loop，R3 禁止建会话；
  送达判据这一侧已由真实 transcript + 真实 CLI 证明。）
- **作用域测试**：`scripts/test.sh plugin/test/send-keys-reliable.test.mjs` ⇒ 20 pass / 0 fail /
  0 cancelled，EXIT=0，全部静态检查（split-or-commit / test-framework-policy / test-isolation /
  contract / ac-carryover / ADR-016 screen-use / checker-mutation）通过。
- **AC7 零哈希**：脚本与测试文件里 `md5sum|sha1sum|cksum` 出现 0 次（grep -c 0/0）。
