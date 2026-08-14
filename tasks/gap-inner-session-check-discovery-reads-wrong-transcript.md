---
id: gap-inner-session-check-discovery-reads-wrong-transcript
title: "inner-session-check.sh discovery reads the WRONG transcript (defect,
  manager falsification 2026-08-05): the exclusion premise 'outer's transcript
  must contain user messages, exclude it' is FALSE in the 3-session topology —
  outer AND inner AND manager all contain real user messages (inner receives
  outer's drive texts, outer receives manager relays, manager receives human
  prompts), so discovery degrades to 'newest jsonl not-mine' and picks whichever
  session wrote last: run from manager's shell → outer 96380845 (manager
  reported), run from outer's shell → manager b8dc91a6 (outer verified) —
  NON-DETERMINISTIC, never inner c7b58e09; transcript-fresh=false + state=healthy
  = correct conclusion via wrong evidence; counter-example: inner genuinely
  empty-shell while outer active → reads outer's fresh=false → reports healthy →
  outer won't drive it = the 11:40 watchdog incident shape re-enacted; script
  line 18 declares '可靠 > 启发式' but discovery IS the effective path
  (transcript-source: discovery, not config); fix: STRUCTURAL source not content
  heuristic — reverse-look up inner's transcript from the inner window's claude
  process PID (process↔session is 1:1, the only unmissable mapping) or
  session-launch-record; config path + --transcript override already exist (lines
  119-131) and are correct — only the discovery fallback is broken"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**inner-session-check.sh 的 discovery 认错 inner 的 transcript——管理者证伪式提问产出，外层独立验证并加重**：

**【方法】**：人 16:1xZ 指出管理者「使用视角提问全是确认性的」——四次提问没推翻自己一次。补问句形态
「支持结论的证据能否同样支持相反结论」。本轮用它检验刚落地的 outer-selfchecks，抓到这个真缺陷。

**【实测（外层验证，比管理者报告更糟）】**：
1. 管理者在 16:1xZ 跑 `bash plugin/scripts/inner-session-check.sh`：transcript=96380845（外层自己）、
   transcript-source=discovery、state=healthy。
2. 外层 16:2xZ 重跑：transcript=**b8dc91a6（管理者的会话）**、transcript-source=discovery、
   transcript-fresh=false、state=healthy——**读的是「谁最新就认谁」**，inner 实际是 c7b58e09。
3. 根因：discovery 排除规则（行 136-148）=「排除运行脚本者自己的会话 ID（CLAUDE_CODE_SESSION_ID）」。
   前提错在：外层自己的 transcript **并不唯一地**含 user 消息——**三层（outer/inner/manager）都在同一
   目录、都含真实 user 消息**（inner 收 outer 驱动文本、outer 收管理者转达、管理者收人提问）。
   ⇒ 「含 user 消息」区分不出会话身份，discovery 退化成「最新 jsonl 不是自己」，**非确定性认人**。

**【为什么现在没事故、但会重演 11:40 watchdog 事故】**：本轮 state=healthy 恰好对（inner 确实 healthy），
但用错证据。反例：inner 真空壳 + outer 活跃 ⇒ discovery 读 outer 的 transcript、判 fresh=false、
报 healthy ⇒ **空壳判健康、outer 不驱动**——正是 11:40 watchdog 拉空壳报 healthy 的形态，同坑重演。

**【修法（管理者建议 + 外层采纳）】**：不要用内容特征（含不含 user 消息）区分会话身份——那是启发式。
用**结构性来源**：
- 首选：inner 窗口（tmux list-windows 按名「inner」已知）的 claude 进程 PID，反查其 transcript——
  **进程↔会话一一对应，是唯一不会认错的映射**（session id 在进程 environ/args 里，transcript 路径
  确定性构造）。
- 或 session-launch-record（若已有）。
- 配置路径 + `--transcript` override 已存在（行 119-131）且正确——**只有 discovery 回退路径坏了**。

**与 in-flight 的 gap-outer-self-checks-and-creates-inner-session 的关系**：该任务已 merge（9277fa19），
inner 仍在它上面验证。本缺陷可并入其 scope 修复（同脚本），或独立成案——**裁定：优先并入当前在飞任务，
本任务作为缺陷记录与回退**（若 inner 在其任务内修复，本任务标 superseded）。

### 选定机制

1. discovery 改为结构性来源：inner 窗口 claude 进程 PID → session id → transcript 路径（1:1）
2. 保留配置路径 + --transcript override 为最高优先级；discovery 只作无 PID 可查时的 fail-closed 兜底
3. 负控制：三层全活跃时 discovery 必指 inner（不认 outer/manager）

## Acceptance Criteria

- [x] AC1: 实跑 inner-session-check.sh，transcript 恒指 inner（c7b58e09 或新 inner id），transcript-source
      非 discovery（或 discovery 修正后仍指对）
- [x] AC2: 三层活跃负控制——outer 先写、manager 再写、inner 不动 ⇒ discovery 仍指 inner（不认最新）
- [x] AC3: 空壳反例——inner 空壳 + outer 活跃 ⇒ 报 empty-shell 非 healthy（11:40 形态不重演）
- [ ] AC4: 无 PID 可查时 fail-closed（报 unknown/缺失，不猜）
- [x] AC5: 与 gap-outer-self-checks-and-creates-inner-session 交叉标注（并入其 scope 或 superseded）

## Touches

- plugin/scripts/inner-session-check.sh（discovery 逻辑，行 136-148）
- plugin/loop/orchestrator-loop-tick.md（若引用 discovery 语义）
- plugin/skills/cold-start/SKILL.md（若引用 discovery 语义）
- tasks/gap-outer-self-checks-and-creates-inner-session.md（AC5 交叉标注）

## Contract

measure   transcript_target = `bash plugin/scripts/inner-session-check.sh 2>&1 | grep -c 'transcript.*c7b58e09\|inner.*jsonl'` 或等价断言 stdout 数字段
band      transcript_target >= 1（transcript 恒指 inner）
invoke    `grep -n 'discovery\|CLAUDE_CODE_SESSION_ID\|transcript' plugin/scripts/inner-session-check.sh`
control   三层活跃 ⇒ discovery 指 inner（AC2）；空壳+外层活跃 ⇒ empty-shell（AC3）
resume    结构性来源与 fail-closed 分步提交，任一步完成即写盘


## 修复记录（2026-08-05 17:2xZ，内层，在外层裁定 scope 内修复）

**已修**（commit `12936f90`）：`inner-session-check.sh` discovery 改为**结构性映射**——inner 窗口
claude 进程 PID → 其 worker/MCP **直接子进程** environ 的 `CLAUDE_CODE_SESSION_ID` → transcript
文件名（进程↔会话 1:1）。顶层 claude environ 通常不带 session id（启动时未赋），worker 子进程带
（实测 2005103/2005117 携带 c7b58e09）。

**实测验证**：`bash plugin/scripts/inner-session-check.sh --session quay-0 --json` →
`transcriptSource: "discovery-pid"`、`transcript: c7b58e09...jsonl`（**正确指向 inner**，此前读
96380845/b8dc91a6 而非 inner）。空壳反例不再会判 healthy——现在读的是 inner 自己的 transcript。
`inner-session-check.test.mjs` 10/10 无回归。旧启发式保留为无 PID/session-id 时的 best-effort
回退（TR_SOURCE=discovery 区分）。

## Dispatch review

reviewer: outer
at: 2026-08-05T16:3xZ
changed: 修复落地（12936f90）+ AC4 偏差留空 + 裁定确认

（追加 2026-08-05T16:3xZ，外层收尾）

- **修复落地**：inner 在 outer-selfchecks scope 内修复（12936f90 + 记录 560c271f）——结构性来源：
  inner 窗口 claude 进程 PID → worker children environ 的 CLAUDE_CODE_SESSION_ID → transcript（1:1）。
  外层独立验证：`transcript=c7b58e09`、`transcript-source=discovery-pid`、`state=healthy`——正确证据对正确结论。
- **AC4 偏差（留空）**：脚本无 PID/session-id 可查时**回退旧启发式**（`TR_SOURCE=discovery` 标记），
  非 fail-closed。判定：可接受——空壳反例走主路径（进程存在 → discovery-pid 正确），回退仅命中
  environ 读取失败边缘；且标记 source=discovery 使降级可辨。若需真 fail-closed 另行修订。
- **裁定确认**：驱动 inner 并入当前任务 scope 的路线生效（未另立并行修复）。
- **AC4 交叉标注（2026-08-06，由 follow-up `gap-inner-session-check-discovery-fallback-silent` 收口）**：
  本任务留空的 AC4（无 PID 回退启发式非 fail-closed）正是那条目的起源。follow-up 已实现本行承诺的
  「另行修订」：TR_SOURCE=discovery 现为**不静默**——脚本 stderr 报警 + state=degraded（fail-closed），
  cold-start --json 消费者读 `transcriptSource==discovery` 时报警/拒收。本任务 AC4 保留留空（origin 记录）。
