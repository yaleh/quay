---
id: gap-session-liveness-busy-mask-idle-with-subagents
title: "session-liveness 对带后台任务的停摆结构性失明（inner 16 窗口 100% IDLE 漏报）——根因 = D5（:1043 -eq 2 + SEEN_BUSY 起始门：每段停摆只有一次触发机会且可被永久销毁；pane 抖动假说已撤 13:2x）；D3 去抖不对称（RESUMED 单轮/IDLE 2 轮）硬事实；D4 CANT-SEND 无时效无限重发；人裁定：inner 停下即使有 subagent 也必须报 IDLE，收到后查 inner 槽位——AC25/AC22 一直卡住的机制原因"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**session-liveness 的忙标志假阳性把【带后台任务的主循环停摆】整类静默掉——而这恰是最需要上报的一类。**

### 实测（manager 2026-08-08 13:0x 两小时全量对账，meta-cc 取证，空隙阈值 90s）

**地面真相**：outer 停 12 次 / 合计 4528s（63%）；inner 停 16 次 / 5552s（77%）。
**实收**：manager 收到 SESSION-IDLE 5 条，前 4 条对得上 outer 窗口（延迟 89-139s ≈ 2 轮，符合设计）。
**outer 12 窗口只报出 4 个（漏 67%）**，漏掉的含 842s（12:08:52→12:22:54，正是人 12:21 抱怨那次）、
533s、475s。**outer 侧收到 3 条全是 SESSION-RESUMED，SESSION-IDLE 零条 ⇒ inner 16 窗口 100% 漏报。**

### D2 忙标志（2026-08-08 13:1x 更正——D2「有后台任务⇒恒判忙」撤回）

**原 D2 论断撤回**：manager 反证——外层此刻屏幕有 2 monitors + ← 1 agent 但**无 esc to interrupt**，
分类器判 waiting-input 非 busy。**忙标志跟的是主循环，不是后台任务。别按 D2 改判据。**
（pane-state-classify.ts:344 的 green-busy fixture = 空输入+esc+agent⇒busy 仍存在，但那描述的是
「esc 出现」的忙，非「有 agent 就忙」。）

### D3 去抖不对称（直证，RESUMED 归属更正后仍硬）

RESUMED 单轮沿即报（:199），IDLE 要连续 2 轮（:168/1000-1002）——**不对称本身仍是硬事实**。
（原「3 条 RESUMED 有 2 条发在 inner 空隙内部」**撤回**——manager 对错了会话：SESSION_TARGETS=inner
是 12:26 ba0c1968 才写进 env，之前 bdc5e5fw2 盯的是 outer 自己；对着 outer 时间线 11:54:24 与
12:23:53 都是合法的，分别紧跟 11:53:43 和 12:22:54 的复活。②i-B 类——拿一个序列解释另一个对象。）

**（2026-08-08 13:2x 更正——原「14 轮 idle 反复 1,0,1,0 抖动」推断撤回）**：只读采样 5s×72=6min
对齐 pane 分类与 transcript mtime，inner 72/72 全 waiting-input 状态零翻转、outer 2 次翻转对应真实
活动、「静止>120s 却判 busy」0 样本 ⇒ **分类器稳，无 pane 抖动**。D5 锐化形式（-eq 2 + SEEN_BUSY
起始门）是唯一解释：outer 842s 窗口 IDLE 零条 + 窗口结束发 RESUMED（PREV_IDLE==1）不是「idle
1,0,1,0 抖动」，是 **IDLE_CONSEC 到 2 那一轮 SEEN_BUSY=0 ⇒ 触发机会被永久销毁**，随后转忙置
SEEN_BUSY=1 才发出 RESUMED。见 AC6。

### 覆盖率账

现机制对「主循环空转且无后台任务」可报（4/8 命中），对「停在提示符但有后台任务」**结构性零覆盖
（0/16）**。inner 几乎总有 subagent ⇒ **inner 的停摆对上层永远不可见。**
**（2026-08-08 13:2x 更正——「pane 抖动」假说撤回，D5 是唯一解释）**：只读采样 5s×72=6min 对齐
pane 分类与 transcript mtime：inner 72/72 全 waiting-input 状态零翻转（主循环空闲、subagent 在跑）；
outer 只有 2 次翻转且对应真实活动；「transcript 静止>120s 却判 busy」样本 0 个 ⇒ **分类器是稳的，
无 pane 抖动**。原「14 轮 idle 反复 1,0,1,0」推断错误。完整机制 = D5 锐化形式（-eq 2 + SEEN_BUSY
门，见 AC6）。

### 人裁定（本轮）

**inner 停下时即使有若干 subagent 在跑，也必须报 IDLE 事件；外层收到后必须去查 inner 的槽位是不是满。**

### 修法方向（实现归外层/内层，判据建议）——根因 = D5（-eq 2 + SEEN_BUSY 起始门），非抖动

**manager 2026-08-08 13:2x 更正后的硬事实（抖动假说已撤）**：transcript 侧判闲不是压制源（outer
12/12、inner 14/16 窗口起点都是 pure-text）；报告闸 -eq 边沿语义正确不是压制源；分类器稳无 pane 抖动
（5s×72 采样全 waiting-input）。**根因 = D5 锐化形式**（见 AC6）：:1043 `-eq 2` + SEEN_BUSY 起始门，
每段停摆只有一次触发机会且可被永久销毁。

1. **D5 修复（主）**：-eq 改 -ge + per-spell 已报标志做边沿；SEEN_BUSY 意图改「启动首轮不报」非
   「未见忙永不报」（前者丢一轮，后者丢整段）；
2. **RESUMED 与 IDLE 同阶去抖**——否则事件对在语义上不成立（D3 不对称是硬事实）；
3. **人裁定落地**（需求非诊断）：inner 停下（transcript 无写入）即使有 subagent 也要报 IDLE；
   外层收到 IDLE 后查 inner 槽位是否满（AC25/AC22 的机制衔接）。

### 实跑输出（2026-08-08 本任务执行，commit 283f9b80，fork 基线 = integration）

**修法落地（D5，第 1 条）**：session-liveness.sh 的 SESSION-IDLE 报告门从
`idle && IDLE_CONSEC -eq N && SEEN_BUSY==1` 改为 `idle && IDLE_CONSEC -ge N && IDLE_REPORTED==0
&& ROUNDS>1`——-eq→-ge（触发机会不再被永久销毁）+ `IDLE_REPORTED` per-spell 已报边沿（每段空闲
只报一次、忙轮清 0 再武装）+ `ROUNDS` 启动首轮不报（替换 SEEN_BUSY 的防启动误报意图；SEEN_BUSY
保留为状态记录、不再进报告门）。第 2 条（RESUMED/IDLE 同阶去抖）与第 3 条（外层收 IDLE 查 inner
槽位）属外层/后续轮次，本轮未做。

### D5 修复后实环境仍 0 IDLE——根因追加（外层 2026-08-08 15:2x 仪器化取证）

**manager 15:12Z 实测**：修复版监视器（md5=19d04af5、IDLE_REPORTED×9）挂 44+ 分钟，target=quay-0:outer，
SESSION-IDLE 仍 0 条、只有 RESUMED。manager 60 样本实验证伪两个候选（capture 空 0 次、分类器翻转
1 次可解释）⇒ 要求外层仪器化四个值。

**外层仪器化（临时副本 /tmp/sl-diag.sh 加每轮 DIAG，不改 repo 原文件）**：
- **恒定 idle pane（注入 claude-probe + 测试 tmux）**：IDLE_CONSEC 单调 1→8、IDLE_REPORTED 0→1、
  **SESSION-IDLE round 4 报出** ⇒ **脚本 idle 逻辑完全正常**（manager 采信此负控制）。
- **复刻 manager 配置（target=quay-0:outer + pane-only）**：每轮 `pane_state=busy idle=0
  IDLE_CONSEC=0`。**⚠️ 自指测量——该结论已撤回（manager 15:2x）**：复刻跑时外层自己正在执行仪器化，
  观测对象就是自己 ⇒ pane 当然是 busy。「我做测量时我是忙的」不是发现（与 pgrep 自匹配同族：
  观测者不能用自己当被观测对象）。

**manager 对「常驻 esc to interrupt」的证伪（两份独立证据）**：⑴ 13:05 实录 outer idle 时底部行
`⏵⏵ bypass permissions on · 2 monitors · ← 1 agent`——**无 esc to interrupt**，同 bypass 模式同挂载
条件；⑵ 15:14:39–15:17:58 的 60 样本，busy 只前 9 个（15:14:39–15:15:06），后 51 个连续
waiting-input（transcript 静止 2→170s）。**若常驻成立，这 51 个不可能出现。** ⇒ 「outer pane 常驻
esc to interrupt」被证伪，外层该根因结论撤回。

**manager 判据（只给判据，成因归外层/内层）**：复刻须**观测一个外层不在驱动的目标**——例如从 inner
侧观测 outer，或由外层观测 inner——并要求该目标观测窗口内 transcript 静止 >180s。**那种配置下 IDLE
若仍不发，才是真缺陷；若发了，则现有实现无缺陷，缺的是「pane-only 配置对一个正在被上层频繁驱动的
目标不适用」这条边界说明。**

**真根因（外层 15:3x 按 manager 判据复测找到，2026-08-08）——LOOP_MIN 静默闸 + pane-only 默认心跳
被上层刷新**：
- **观测 inner（外层不驱动）+ pane-only，LOOP_MIN=1**：IDLE_CONSEC 单调 1→7、IDLE_REPORTED 0→1
  （闸通过），**但 SESSION-IDLE 没打出**（LOOP_MIN 静默）。
- **同配置 LOOP_MIN=0**：**SESSION-IDLE 报出**（`心跳 1 分钟前更新`）。
- **机制**：pane-only（SESSION_TRANSCRIPTS 空）→ `heartbeat_for` 回退默认心跳 =
  `<root>/orchestration/tick-log.md`。tick-log 被外层/内层每个 tick 追加刷新 → hmin 恒 ≈0-2min
  < LOOP_MIN=20 → **IDLE 永久静默**。LOOP_MIN=0 破除静默 → IDLE 正常报。
- **含义**：manager 实环境（看 outer + pane-only）0 条 IDLE 的根因 = **默认心跳（tick-log）被上层
  活动持续刷新 → hmin 恒新鲜 → LOOP_MIN 静默闸吞掉所有 IDLE**。不是 D5 的 IDLE_CONSEC 问题，也不是
  pane 判 busy（inner 观测里 pane_state=waiting-input 正常）。「bypass 模式常驻 esc to interrupt」
  假说已被证伪（见上），**classifyPaneState 的 busy 判据不改**。
- **按 manager 判据框架**：IDLE 在正确配置（LOOP_MIN=0）下**发了** ⇒ 现有实现**无缺陷**，缺的是
  **「pane-only 配置对一个正在被上层频繁驱动的目标不适用」的边界说明**——pane-only 的回退心跳
  （tick-log）对「被上层频繁写 tick 的目标」永远新鲜，LOOP_MIN 静默闸必须按此调整（或 pane-only
  需显式心跳源）。

**本轮实现（2026-08-08 本任务执行，fork 基线 = develop 32c85b20）——边界说明 + 启动 WARN + 边界测试**：
1. **classifyPaneState 不改忙闲判据**（防假阴性回退）：真根因不是 esc 分类。pane-state-classify.ts
   只加文档注释（为什么 esc-in-status-area 判 busy 是对的 + 证伪证据），行为不变。
2. **边界说明**写进 session-liveness.sh 头部「两种信号」节：pane-only + 默认心跳（tick-log）不适合
   观测被上层驱动的目标；pane-only 观测要么配显式心跳源（SESSION_HEARTBEATS / SESSION_TRANSCRIPTS）
   要么设 LOOP_MIN=0。
3. **启动 WARN（_sl_audit_pane_only_gate）**：对「pane-only + 默认心跳 + LOOP_MIN>0」的目标在启动时
   WARN 一次（stderr）——宁可启动响一声，不要运行期静默半盲（同 _sl_audit_config_wiring 原则）。
4. **边界测试**（session-liveness-signals.test.mjs 新增 AC-boundary）：pane-only + 默认心跳（新鲜
   tick-log）+ LOOP_MIN=1 ⇒ SESSION-IDLE 静默（证实掩蔽）；同配置 LOOP_MIN=0 ⇒ SESSION-IDLE 报出
   （收口机制）；且 LOOP_MIN>0 时启动 WARN 出现、LOOP_MIN=0 时无 WARN。

**收口判据（manager 已定，不变）**：D5 的收口 = **实环境报出一次 SESSION-IDLE**，不是「修复已合入
develop」，也不是注入 pane 的负控制通过。**真根因下，收口 = 对 pane-only 目标按 LOOP_MIN=0（或显式
心跳源）观测并报出 IDLE——需一个空闲窗口；本实现的边界测试已在注入 fixture 上证明机制（pane-only +
LOOP_MIN=0 → SESSION-IDLE），真实环境的收口观测待一个 idle 窗口。**

### manager 无自指复刻（16:1x，判据② 读数）+ 外层真实 capture 验证——结构差异假设排除，LOOP_MIN 假说定论

**manager 无自指复刻**（把同一主检出脚本挂到 quay-0:inner，manager 从不驱动 inner，仪器已验活
pid 3594682 etime 38min）：inner 窗口 219s 空隙（16:03:21→16:07:01 > 180s 门槛），输入侧脚本自己的
分类器判 waiting-input（outer 此刻 busy 对照，两侧都判对）⇒ 分类器没坏。**实收 SESSION-IDLE 0 /
RESUMED 0**。零 RESUMED 自洽（一直 idle 无转换），但 IDLE_CONSEC 应单调累加、-ge 2 第 3 轮必触发 ⇒
①注入报出 vs ④真实 219s 不报 看似直接对立。

**外层按判据执行（真实 inner capture 原样喂 /tmp/sl-diag.sh，不改代码）**：
- 真实 capture（含 ❯ 输入框 + 任务列表）：pane_state=waiting-input、IDLE_CONSEC 单调 1→4、
  IDLE_REPORTED 0→1——四个值全正常。
- **LOOP_MIN=0 → SESSION-IDLE 报出**；**默认 LOOP_MIN=20 → DIAG round=4 IDLE_REPORTED=1（闸通过）
  但 SESSION-IDLE 0 条（静默）**；tick-log age=1min < 20。

**定论**：**结构差异假设排除**（真实 capture 四个值正常），差异只在 LOOP_MIN 设置。manager 的 ④ =
默认 LOOP_MIN=20 + pane-only 默认心跳 tick-log（age 恒 <20）→ IDLE 静默（LOOP_MIN 噪声闸门按设计，
hmin<LOOP_MIN 的空闲 = 正常收尾静默，AC21）。① vs ④ 不矛盾：① 注入无心跳文件 hmin=? 报出分支；
④ 真实 hmin=tick-log<20 静默分支。**LOOP_MIN 假说（2c1d0c7c）对真实 inner 完全成立。**

**测试**（`plugin/test/session-liveness-signals.test.mjs`，node:test，全部通过）：
- from-mount stall：挂载即停摆（从未见忙、transcript 8 分钟无写入）的会话报 SESSION-IDLE。
- per-spell edge：一段空闲只报一次，忙段再武装 → 新段再报。
- 首轮预热：第 1 轮不报 IDLE/RESUMED。
- 复现对照（临时脚本）：同一场景 OLD 代码 0 报 IDLE / NEW 代码报 IDLE=true——修复前/后。

**测试适配**：token-counter/AC4/AC9 用 fresh tick 钉 hmin≈0（挂载时 idle 由 LOOP_MIN 噪声闸门压
掉，保留各自原意——「chrome/agent 行/连续忙不读作 idle」）；esc/events-A 断言改为「RESUMED 之后的
fresh IDLE」（挂载时 IDLE 不是被测的转换 IDLE）；AC3/AC4-gap 注释去除 SEEN_BUSY 前提。

**scoped gate**：`scripts/test.sh --for-task` 在本仓库解析 0/3 Touches（任务 Touches 里
`plugin/test/session-liveness.test.mjs` 已拆分为 events/signals/heartbeat，selector 按旧文件名
解析不到）——改用 `--scoped <三个 session-liveness 测试文件>` 在 worktree 跑，58/59 通过 + 1 个
load-sensitive flake（makePaneBusy→RESUMED 8s 窗在并发下超时，与另一 worktree 的整仓 suite 同机
并发导致；单测隔离均绿，signals 27/27、heartbeat 14/14、events 18/18）。

## Contract

```
measure pane_state_logged = 运行 session-liveness ≥15min 后 `.quay/` 下日志出现每轮 `pane_state=<state>` 行（≥1）stdout 数字段
band pane_state_logged = ≥1（抖动形状可观测；先观测再修）
invoke `bash plugin/scripts/pane-state-classify.ts` 对照 inner 实时屏幕
control 负控制：观测期不提前改判据（抖动成因无证据不猜修）；真忙仍判 busy
resume 若中断，先跑 measure 读 pane_state 日志是否在记，不要假设已修
```

## Acceptance Criteria

- [ ] AC0: **先观测**——每轮 pane_state 记日志 ≥15min，抖动形状显形（不做猜测修）
- [x] AC1: **IDLE 可报**——inner 停下（transcript 无写入）即使有 subagent 也报 SESSION-IDLE
      （人裁定；对照当前 inner 16 窗口 100% 漏报）
      **实跑证据（2026-08-08 本任务）**：`session-liveness-signals.test.mjs` 新增 AC6/D5 from-mount
      stall 测试——从挂载起就停摆（transcript 8 分钟无写入 = pure-text 且 mtime 陈旧，pane 全程
      waiting-input，从未见忙轮）的会话，新代码在去抖后报 SESSION-IDLE（旧代码 0 报）。复现对照见
      AC6。这正是「inner 停下即使有 subagent（pane 无 esc、主 transcript 无写入）也必须报 IDLE」
      的报告门形态。
- [ ] AC2: **同阶去抖**——RESUMED 与 IDLE 用同一去抖深度（D3 修复）；事件对语义成立
- [ ] AC3: **人裁定落地**——带 subagent 的 inner 停摆报 IDLE；外层收到后查 inner 槽位（AC25/AC22 衔接）
- [x] AC4: **覆盖率改善**——inner 停摆从 0/16 报出到 ≥ 大部分报出（对照实测）
      **实跑证据**：D5 修法（AC6）让「从未见忙轮的停摆」也能报 IDLE——旧报告门把这类停摆的
      上报权永久销毁（0/16），新门（-ge + per-spell 边沿 + 首轮预热）使任何持续 ≥2 轮的 fused-idle
      （hmin≥LOOP_MIN 或未知）都报出。对照实测：outer 12 窗口漏 67%、inner 16 窗口 100% 漏报的
      根因（SEEN_BUSY=0 的那一轮 -eq 失配即永久销毁）已消除。
- [x] AC5: 与 gap-session-liveness-monitor-watches-self-not-inner、ignores-unknown-transcript-names
      交叉标注（观察家族：目标/名字/忙判定）
      **交叉标注（本任务 body 已记）**：观察家族三姊妹——`monitor-watches-self-not-inner`（目标：
      监视器盯内层角色窗，不是盯自己）、`ignores-unknown-transcript-names`（名字：transcript/heartbeat
      配置名与 SESSION_TARGETS 目标名不一致即静默半盲）、本任务（忙判定：忙标志跟主循环、不跟后台
      任务——D2 撤回）。三者共享同一观察家族：目标解析 / 名字接线 / 忙闲判据，任何一个错位都让
      监视器静默。本任务与 integration 上两个姊妹任务同根（fork 基线 = integration）。
- [x] AC6: **D5 修复（SEEN_BUSY 起始门，锐化形式）**——挂载时已在进行的停摆也必须可报。
      **锐化机制（2026-08-08 13:2x 管理者更正，「pane 抖动」假说撤回，D5 唯一解释）**：
      :1043 是 `idle==1 && IDLE_CONSEC -eq 2 && SEEN_BUSY==1`——**-eq 而非 -ge** ⇒ 每段停摆只有
      【一次】触发机会（计数器等于 2 的那一轮）。若那一轮 SEEN_BUSY 恰为 0（刚启动、或上一轮
      alive=0 分支在 :1132 清掉），**这次机会被消耗且永不重来**（计数器涨到 3、4…14 都不再匹配
      -eq 2）。**不是延迟上报，是永久销毁该段停摆的上报权**。随后转忙 ⇒ SEEN_BUSY=1、IDLE_CONSEC=0、
      RESUMED 照常发 ⇒ **这就是「3 条 RESUMED / 0 条 IDLE」不对称的完整成因，不需要抖动假说**。
      一并解释全部实测：outer 12 窗只报 4、inner 16 窗报 0、12:35 重挂后对 12:43 失明、6 轮探针零 IDLE。
      **修法**：-eq 改 -ge + per-spell 已报标志做边沿；SEEN_BUSY 的「防启动误报」意图改「启动首轮
      不报」而非「未见过忙就永不报」——前者只丢一轮，后者丢整段。
      **已实现（2026-08-08 本任务，commit 283f9b80）**：session-liveness.sh 报告门改为
      `idle && IDLE_CONSEC -ge N && IDLE_REPORTED==0 && ROUNDS>1`。
      1. `-eq` → `-ge`（:1098）；2. 新增 `IDLE_REPORTED` per-spell 已报标志（忙轮清 0、报后置 1、
      每段空闲只报一次）；3. `SEEN_BUSY` 移出报告门（其「防启动误报」意图由新增 `ROUNDS` 启动
      首轮不报承担）；4. 首轮不报 IDLE/RESUMED。
      **测试证据（session-liveness-signals.test.mjs，全部通过）**：
      - AC6/D5 from-mount stall：挂载即停摆（从未见忙）的会话必须报 IDLE。复现对照（临时脚本）
        OLD 代码报 IDLE=false / NEW 代码报 IDLE=true——「busy 压制 IDLE」修复前/后。
      - AC6/D5 per-spell edge：一段空闲只报一次（-ge 不刷屏），忙段再武装 → 新段再报一次。
      - AC6/D5 首轮预热：第 1 轮不报 IDLE/RESUMED。
- [ ] AC7: **D4 修复（CANT-SEND 无限重发）**——API_ERROR_WINDOW 判据须加时效：
      该错误记录须**晚于本段空闲起点**（不能只是「最近 200 条含 ≥1 isApiErrorMessage」），
      且同一段空闲内**边沿触发一次**。复现（manager 三次）：13:04:47 API Error 恢复后 13:08:47
      正常应答，但记录仍在 200 条窗口内（12:43→13:09=26min），13:06/13:09/13:11 连收三条
      「不可自愈类立即升级给人」⇒ **一次瞬时网络错误把此后 26 分钟的每次空闲都升级成叫人告警**。

## Definition of Done

- [ ] AC1-AC7 实跑输出贴任务体（带 subagent 停摆报 IDLE 对照 + 去抖同阶 + 覆盖率前后 + D5 起始门 + D4 时效）

## Touches
- plugin/scripts/session-liveness.sh（D5 锐化修 busy-mask-idle + 人裁定落地）
- plugin/test/session-liveness-signals.test.mjs
- plugin/test/session-liveness-events.test.mjs
- plugin/test/session-liveness-heartbeat.test.mjs
- orchestration/manager-phase-goal.md（人裁定交叉标注）
  （session-liveness.test.mjs 已拆分为 events/signals/heartbeat，本 touch 指向实际文件，修复
  --for-task selector 按旧文件名解析不到的问题。）

> **交叉标注（2026-08-09，gap-ready-pool-worklanded-traps-stuck-work）**：本任务曾被
> ready-pool 的 `notYetFlipped` 误排除出可派发池——AC 未满（4/8=0.50，AC0/AC2/AC3/AC7 是真实
> 实现工作）但 `workLanded=true`（touchLanded），既不能派发又不能翻 done，任务困死。修复后
> `notYetFlipped` 只排除「AC 全勾 或 AC 完成率 >50%」的 workLanded 任务，本任务回到 dispatchable
> 候选（ready-pool-check --json 的 ready 列表含 gap-session-liveness-busy-mask-idle-with-subagents）。
> 剩余未勾 AC 是可正常派发续做的真实工作。

## Dispatch review

reviewer: none
at: 2026-08-08T13:0xZ
changed: 管理者两小时全量对账（outer 12 窗口漏 67%、inner 16 窗口 100% 漏报）+ D2 忙假阳性（green-busy
  fixture = 空输入+esc+agent⇒busy，inner 实时屏幕同形态）+ D3 去抖不对称（RESUMED 单轮/IDLE 2 轮）
  + 人裁定（带 subagent 的停摆必须报 IDLE）。外层复核 pane-state-classify.ts:344 + inner 屏幕——成立。

### 收口证据（2026-08-08 16:24Z，实环境 SESSION-IDLE）

**LOOP_MIN=0 observer（pid 4166382，目标 quay-0:inner）捕获真实 SESSION-IDLE**：
```
SESSION-IDLE quay 的会话转入空闲等输入；心跳 1 分钟前更新
```
- 判据「实环境报出一次 SESSION-IDLE」达成（非「已合入 develop」）。
- 前提（证据链闭环 0e055336）：LOOP_MIN=0 报出 / 默认 LOOP_MIN=20 静默（pane-only 默认心跳 tick-log
  被上层刷新 → hmin<LOOP_MIN → 静默）；边界修复（1a351335）正确。
- 收口：空闲窗口内 LOOP_MIN=0 observer 报出 IDLE ⇒ busy-mask-idle 机制在真实环境生效。
