---
id: gap-reliable-send-crystallize-the-five-failure-modes-into-a-script
title: F closed send-keys-verified but D only covers the classify/wait half — the
  SENDING half (5 measured delivery-failure modes) has no owner; crystallize
  the reliable-send algorithm into a script
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者交办（人要求把今晚反复出现的手工修法结晶为脚本）。依据
`orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md`（记录 5 个独立送达故障模式，每条有实测证据，
并给出完整算法）。

**现状缺口**：`send-keys-verified.sh` 的哈希判据已被 F 判定 superseded；F 指向 D
（`gap-pane-state-is-hashed-not-classified-...`，已 done）。但 **D 的范围只是「分类器本体 + 接线」
（判断目标在不在等输入），不覆盖「发送」这一半**——5 个故障模式全部发生在发送侧，D/B 都不管。
**F 关掉后这块地是空的。**

### 5 个故障模式（每条今晚实测，非推断）

| # | 故障 | 关键证据 | 修法 |
|---|---|---|---|
| 1 | `C-u` 只清当前行（readline kill-line），多行残留清不掉 | 1554 字节长消息实测需**连续 30 次 C-u** | 循环 C-u + capture-pane 查空（上限 50，超限 fail loud） |
| 2 | 长文本后紧跟 Enter，接收端渲染未完成时回车不生效 | 隔离探针字节级：tmux/pty 投递正确（Enter 晚 58ms、顺序不乱），真实会话没提交 | 发文本后轮询 capture-pane 连续两次一致（渲染稳定）再发 Enter |
| 3 | 即使空闲 + 等稳定，Enter 仍可能不生效 | 空闲会话 C-u 清空 + sleep 0.8 后 Enter 未提交；补发独立 Enter 才落 transcript | **必须验证真实送达**，未达则补发一次独立 Enter，仍不达报失败 |
| 4 | 「已提交」与「落进 transcript」之间有排队延迟 | 发送时外层正忙，输入框立即清空但 transcript 30 秒后才出现 | 送达确认 = 有界轮询（60s 超时），不是单次检查 |
| 5 | 三种「看起来送达」的信号全不可靠；唯一可信 = 目标 transcript | 哈希 exit0 / 输入框为空 / SESSION-RESUMED 全被证明会误报 | 送达判据只认：目标 `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` 新增一条内容匹配的真实 user message |

### 选定机制

**新脚本 `plugin/scripts/send-keys-reliable.sh`**，实现文档 §5 的 5 步算法（清空→发送→稳定→提交→
验证）。**不重写 `send-keys-verified.sh`**（其名字承载哈希语义，已被 F 判死；新脚本零哈希）。

**关键设计：验证逻辑（步骤 5）是纯函数**——`checkTranscriptDelivered(transcriptFragment, sentText) ->
{delivered, matchedLine}`，无副作用、不调 tmux。于是脚本的 tmux 触碰面很薄（步骤 1–4），而最容易出
错的送达判据是纯函数，测试不需要假 TUI（与裁定 E 同一设计：危险测试面结构性不存在）。

**步骤 3 的「稳定判断」可复用 D 的 `classifyPaneState` 或简单连续两次 capture-pane 等值**——不重新
发明一套（文档 §5 明写）。

## Acceptance Criteria

- [ ] AC1: `plugin/scripts/send-keys-reliable.sh` 实现步骤 1——循环 `C-u` + capture-pane 查空，
      上限 N=50，**超限 fail loud**（报失败退出非 0，不静默继续）
- [ ] AC2: 实现步骤 3——发送文本后轮询 capture-pane 连续两次一致（渲染稳定），有界超时（如 10s）
- [ ] AC3: 实现步骤 5——**有界轮询**目标 transcript jsonl 直到出现内容匹配的真实 user message
      （60s 超时）；单次超时 → 补发一次独立 Enter 重新计时；二次超时 → **fail loud**（needs-human，
      不假装成功）
- [ ] AC4: **送达判据是纯函数**——`checkTranscriptDelivered` 无副作用、不调 tmux、不读文件以外
      的源；测试直接 import（不需要 tmux server / pty / 假 TUI）
- [ ] AC5: **负控制**——给一份不含该消息的 transcript 片段 + 发送文本 ⇒ `checkTranscriptDelivered`
      必须报未送达；含但内容不匹配 ⇒ 报未送达（两次实跑贴任务体）
- [ ] AC6: **正控制（真实对象）**——脚本对**真实 tmux 会话**完成一次发送，验证通过真实 transcript
      判定送达（非构造夹具）；实跑输出贴任务体
- [ ] AC7: **零哈希**——脚本与测试文件里 `md5sum|sha1sum|cksum` 出现 0 次（F 判死的哈希判据不得
      借尸还魂）；`grep -c` 输出贴任务体
- [ ] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC8 全部勾上；AC5/AC6/AC7 的实跑输出逐字贴进本任务体
- [ ] 一次真实跨会话发送被真实 transcript 判定送达（AC6 的对象，DIR-026 real-object）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）
- [ ] `orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md` 已跟踪（提交时）

## Touches

- plugin/scripts/send-keys-reliable.sh (new)
- plugin/scripts/transcript-delivery-check.ts (new，纯函数，可单测)
- plugin/test/send-keys-reliable.test.mjs (new)
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（跟踪 + 结果回写）

## Contract

measure   delivered = `node --experimental-strip-types plugin/scripts/transcript-delivery-check.ts --check <jsonl> --text <text>` stdout 的 delivered 字段
band      delivered = true（内容匹配的真实 user message 出现）
invariant hash_uses = 0（脚本/测试里 md5sum|sha1sum|cksum 出现 0 次，F 判死的哈希不借尸还魂）
invoke    `scripts/test.sh plugin/test/send-keys-reliable.test.mjs`
control   负控制（不含消息/不匹配的 transcript ⇒ 未送达）；正控制（真实会话 + 真实 transcript ⇒ 送达）
resume    纯函数与脚本分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-04T16:1xZ
changed: 外层受管理者交办立案。四处收紧：
(1) **判断=新建任务而非并入**——D/B 已 done 且明写不覆盖发送侧；并入 R2 会变杂烩（R2 管通道内容
纪律，本任务管发送机制本身）；
(2) **送达判据抽成纯函数（AC4）**——最容易错、最需要测试的是验证逻辑，不是 tmux 触碰；纯函数使
测试不需要假 TUI（裁定 E 同款设计，危险测试面结构性不存在）；
(3) **零哈希是 invariant（AC7）**——F 判死的是哈希判据本身，任何把它带回来的实现都是倒退；
(4) **DoD 要求真实对象**——AC6 必须对真实会话+真实 transcript 判定送达，构造的夹具不够。
status: todo——不紧急（文档明写不阻塞当前批次），排当前批之后。
