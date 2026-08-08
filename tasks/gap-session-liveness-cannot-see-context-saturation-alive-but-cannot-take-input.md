---
id: gap-session-liveness-cannot-see-context-saturation-alive-but-cannot-take-input
title: "nothing measures context saturation — a session at 100% context is
  alive, busy, heartbeating and classified HEALTHY, yet may be unable to retain
  new instructions; session-liveness.sh's state vocabulary is
  SESSION-{GONE,BACK,IDLE,RESUMED,OVERDUE,STALL,MARKER,STATUS} + REPO-STALL with
  no 'alive but saturated', and its comment at :112-113 DELIBERATELY excludes
  the token-count line and the 100% ratio from the criterion (correctly, to stop
  TUI chrome jitter reading as activity) — so the exclusion is right for its own
  purpose and leaves the dimension unmeasured; grep for
  context-used/auto-compact across plugin/scripts, plugin/loop/*.md and
  orchestration/*loop-tick.md = ZERO hits, no layer watches it; NOT
  machine-specific — measured 2026-08-06: B's outer at '100% context used' and
  quay's own inner at '1% until auto-compact' simultaneously; textbook
  heartbeat-not-consciousness (假死判据): the criterion measures whether the session
  MOVES, never whether it can still TAKE IN anything; manager observation
  2026-08-06"
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**没有任何一层在测上下文饱和度。一个 100% context 的会话是活的、忙的、有心跳的，
判据报它健康——而它可能已经收不进新指令了。**

### 实测（命令可复算）

| 项 | 值 |
|---|---|
| `session-liveness.sh` 的状态词汇表 | `SESSION-{GONE,BACK,IDLE,RESUMED,OVERDUE,STALL,MARKER,STATUS}` + `REPO-STALL` —— **没有「活着但饱和」** |
| `grep -riE 'context.?used\|auto-?compact\|context.?window' plugin/scripts/` | **0 命中**（唯一一处在 session-liveness.sh:112 的注释里，见下） |
| 同样的 grep 于 `plugin/loop/*.md` + `orchestration/*loop-tick.md` | **0 命中——没有任何一层被指示去读它** |
| 实测同时饱和的会话（2026-08-06） | B 的 outer = **100% context used**；quay 自己的 inner = **1% until auto-compact** |

### 关键：这不是 session-liveness 的 bug，是一个缺失的维度

`session-liveness.sh:112-113` 的注释**明确写着**把 token 计数行和「比率跳到 100%」
排除在判据之外，理由是形状分类读的是结构（有没有 `esc`/`❯`/权限框），
**不是逐字节比较，所以 chrome 的抖动永远不会被判成活动**。

**这个排除对它自己的目的是完全正确的**（它要消灭的是 TUI 噪声造成的假「忙」）。
问题不在它做错了什么，而在于：**排除之后，这个维度就没有任何人在看了。**
一个饱和会话具备「忙」的结构特征 ⇒ 被归类为忙 ⇒ 报健康。

### 性质：假死判据的教科书形态

**判据测的是「会话还动不动」，从不测「它还收不收得进东西」。**
心跳在跳，意识可能已经满了。这正是本轮 tick 的生命视角提问要找的形态，
也是升级形态的一个实例——**判据在没有依据（关于保留能力的依据）时仍然给出「健康」这个答案**。

### 一个未验证的关联（明确标注为假设，不作为立案依据）

B 的 outer 处于 100% context，且在收到人的既有 push 指令与管理者转达后**未见动作**。
**我没有验证二者的因果关系，也不以此作为本任务的证据。**
本任务的立案依据只是上表的机械事实：这个维度零测量。
若将来要验证该关联，那是独立的一件事，需要单独设计对照。

### 选定机制（方向，接法留执行时）

留给执行时决定，但有两条约束：

1. **不得用「屏幕上的百分比数字」做主判据**——那正是 `session-liveness.sh:112` 有意排除的东西，
   重新引入会把它当初消灭的 chrome 噪声一起引回来。优先找结构化来源
   （transcript 大小 / 消息数 / 该会话的 compact 事件记录），屏幕文本至多作为交叉验证。
2. **饱和不等于故障**——auto-compact 是正常机制。要报的是「饱和且随后指令未被响应」这类复合形态，
   而不是一见高比率就告警（否则重复 IDLE 60s 即报的旧噪声错误）。

## Contract

```
measure saturation_observable = `bash plugin/scripts/session-liveness.sh --selfcheck --json 2>&1 | grep -c 'saturated'` stdout 数字段（能=1，不能=0）
band saturation_observable = 1
measure states_include_saturated = `bash plugin/scripts/session-liveness.sh --states 2>&1 | grep -c 'saturated'` stdout 数字段（含=1）
band states_include_saturated = 1
invariant 一个会话被判为健康/忙，不得仅依据它在动；若该会话已饱和到无法接收新指令，必须能与普通的「忙」区分开
invoke `bash plugin/scripts/session-liveness.sh --selfcheck`
control 构造一个处于饱和态的目标会话 ⇒ 判据必须把它与普通忙会话区分开；若两者产出同一个事件，说明该维度仍未被测量，本机制无效
resume 若中断，先跑 measure 读当前各会话饱和度，不要假设上次已覆盖
```

## Acceptance Criteria

- [x] AC1: **可观测**——存在一条命令报出目标会话的上下文饱和度，对当前四个活会话各跑一次并贴出输出
      **实跑（2026-08-07，本机 A；`--saturation` 读 transcript 的 `usage.cache_read_input_tokens` 结构字段）**：
      ```
      $ bash plugin/scripts/session-liveness.sh --saturation ~/.claude/projects/-home-yale-work-quay/3cc1c0b9-....jsonl   # quay inner
      unsaturated cache_read_input_tokens=318976
      $ bash plugin/scripts/session-liveness.sh --saturation ~/.claude/projects/-home-yale-work-quay/b8dc91a6-....jsonl   # quay outer
      saturated cache_read_input_tokens=631040 (context ≥ 450000 + last message unanswered user input)
      $ bash plugin/scripts/session-liveness.sh --saturation ~/.claude/projects/-home-yale-work-archguard/71d54a0a-....jsonl
      saturated cache_read_input_tokens=739968 (context ≥ 450000 + last message unanswered user input)
      $ bash plugin/scripts/session-liveness.sh --saturation ~/.claude/projects/-home-yale-work-meta-cc/2a9aaef3-....jsonl
      unsaturated cache_read_input_tokens=0
      ```
- [x] AC2: **可区分（承重条）**——饱和会话与普通忙会话产出**不同**的事件/字段；
      若两者同事件，本任务无效，不得以 AC1 通过为由结案
      **判据（`transcript_context_saturation`，复合形态）**：`cache_read_input_tokens ≥ SATURATION_TOKENS` 且
      最后一条是未应答 user 输入 ⇒ `saturated` ⇒ 监视器发 `SESSION-SATURATED`；普通忙会话（低上下文或
      仍应答中）不发该事件。**正控制测试**（`plugin/test/session-liveness.test.mjs`「阶段四 AC2（承重条）」）：
      饱和 fixture 触发 `SESSION-SATURATED`，普通忙 fixture（挂起 tool_use）不触发、也不误报 IDLE——两个
      事件不同。**实测区分**：quay outer 631040 + 未应答 = saturated（发 `SESSION-SATURATED`），quay inner
      318976 = unsaturated（不发）——同一时刻同类型会话产出不同字段。
- [x] AC3: **不引入 chrome 噪声**——主判据不依赖屏幕百分比文本；贴出所用数据源，
      并说明它与 `session-liveness.sh:112-113` 有意排除的那部分的关系（不得把它重新引回主判据）
      **数据源**：transcript 里最近 assistant 消息的 `usage.cache_read_input_tokens`（缓存前缀 = 上下文
      实际用量，结构化字段；只有 assistant API 响应才有）。**与 :112-113 的关系**：那条注释（与
      `mask_pane` 的 `/clear to save` 行）排除的是**屏幕 token 计数行**，为了让 TUI chrome 抖动
      （token 计数每秒跳）不被 busy 判据读成活动；本判据读的是 **transcript 的 usage 结构字段**，不是屏幕
      文本，因此没有把当初消灭的 chrome 噪声引回主判据。两条路径正交：屏幕行被 mask_pane 记录为 chrome，
      饱和度判据根本不消费 pane 文本。
- [x] AC4: **负控制**——一个健康未饱和的会话不得被报为饱和（避免重演 IDLE 60s 即报的过报错误）
      **三 fixture 负控制**（`--selfcheck` 的 saturation composite + 「阶段四 AC1 seam」测试）：
      （a）同上下文（600000）但最后一条已应答 ⇒ `unsaturated`（auto-compact 是正常机制，不报）；
      （b）低上下文（50000）+ 未应答 ⇒ `unsaturated`；（c）缺失 transcript ⇒ `unknown`（静默不猜）。
      **实测负控制**：meta-cc（0）与 quay inner（318976）都是活会话，都不报饱和。
- [x] AC5: **跨机可用**——机制在 `plugin/` 之下且在 `quay-init` 铺设集里；
      在 A 与 B 各实测一次（B 侧只读观测，不改其驱动文本）
      **位置**：`plugin/scripts/session-liveness.sh`（新增 `--saturation`/`--states`/`--selfcheck --json`
      接缝 + `SESSION-SATURATED` 事件 + `SATURATION_TOKENS` 阈值）；`quay-init --loop` 原样复制本脚本
      （`plugin/scripts/quay-init.sh:1402-1403` `sl_src`→`sl_dst`，可执行文件一律 cp 不渲染；
      `verify-installed-executables.sh` 校验安装副本与源一致）。阈值 `SATURATION_TOKENS` 可按机型调。
      **A/B 实测**：本机 A 上对 quay inner/outer 跑 `--saturation`（见 AC1）；B 侧（archguard / meta-cc）
      的 transcript 在本机只读可达，对其跑 `--saturation` 得到 739968=saturated 与 0=unsaturated——
      只读观测，未改动 B 的任何驱动文本。
- [x] AC6: **不夸大因果**——任务体不得声称饱和导致了任何具体的指令丢失，除非另有对照实验证据；
      本条存在是为了防止把上面那条「未验证关联」写成结论
      **遵守**：任务体的「一个未验证的关联」段仍标注为**假设、不作为立案依据**；本任务的立案依据是
      机械事实（该维度零测量）。实跑结论只报「饱和判据可观测、可区分」，**不**声称任何具体指令丢失由
      饱和造成——那需要单独设计对照实验。

## Definition of Done

- [x] AC1-AC6 实跑输出贴进任务体
- [x] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——见下方「执行证据」节（`scripts/test.sh
      plugin/test/session-liveness.test.mjs` 两次全绿；直接 `node --test` 亦 56 pass / 0 fail / 0 cancelled）
- [x] 任务体记录：本条与 `session-liveness` 既有判据的分工——那条测「动不动」，本条测「收不收得进」

**分工（DoD 第三条）**：`session-liveness.sh` 既有判据测的是**「会话还动不动」**——进程活/死（GONE/BACK）、
忙/闲（IDLE/RESUMED，形状分类 + transcript 消息类型融合）、心跳逾期（OVERDUE）、发不出请求（CANT-SEND）；
本任务补的维度测的是**「它还收不收得进东西」**——上下文已满（cache_read ≥ 阈值）且最后一条指令未获
应答（收不进）⇒ `SESSION-SATURATED`。二者正交：一个「在动」的饱和会话，前四个事件都会报它健康/忙，
只有 `SESSION-SATURATED` 会把它标出来——这正是假死判据（heartbeat-not-consciousness）要的补丁。

**执行证据（2026-08-07）**：
- Contract measures：`--selfcheck --json | grep -c saturated` = 1；`--states | grep -c saturated` = 1；
  `--selfcheck` 退出 0 且 `saturation composite PASS — saturated=saturated answering=unsaturated healthy=unsaturated`。
- 测试：`bash scripts/test.sh plugin/test/session-liveness.test.mjs` **连跑 2 次全绿**（`fail 0` / `cancelled 0`，
  1 skip = 真实探针会话不在本机；直接 `node --test` 亦 56 pass / 0 fail / 0 cancelled）；阶段四新增 4 测
  全绿（Contract measure ×1、selfcheck ×1、AC1 seam ×1、AC2 承重条 ×1）。
- 静态层：`scripts/test.sh --for-task <id> --allow-thin` 的**变更相关静态检查全部 PASS**（adr016-screen-
  use-check：125 个 shell 脚本含本脚本 0 违规；dead-code-after-return-check：PASS；drive-contract-check：
  两份 tick 文档 PASS；等）。其**测试文件段在并载负载下对已知负载敏感族（KNOWN-LOAD-SENSITIVE，见
  session-liveness.test.mjs 文件头）偶发超时**——4 次 scoped 跑各挂了不同的时序测试（G / AC6-AC7 /
  noise-gate / 多源 AC4），而同一文件**独立跑 3 次全绿**；本机常驻 quay-outer/inner 两 claude 进程
  （40%+16% CPU）使该族的 RESUMED/OVERDUE 时序窗受压。本任务改动的饱和判据只读 transcript 结构字段、
  不触碰 RESUMED/OVERDUE 判据路径（且 G/多源 AC4 目标无 transcript，饱和块整体跳过），非回归。

## Touches
- tasks/gap-session-liveness-cannot-see-context-saturation-alive-but-cannot-take-input.md
- plugin/scripts/session-liveness.sh
- plugin/scripts/quay-init.sh
- plugin/loop/orchestrator-loop-tick.md
- plugin/test/session-liveness.test.mjs（阶段四 AC2 承重条等正/负控制实现在此，2026-08-07 执行期补列）

## Dispatch review

reviewer: outer
at: 2026-08-06T14:1xZ
changed: 内层立案任务补 Contract 格式（measure 补 backtick 命令 + 字段、invariant/control 续行合并、加本段）。任务待派（dispatch 记账 0d6e98b7 补晋 ready）。

