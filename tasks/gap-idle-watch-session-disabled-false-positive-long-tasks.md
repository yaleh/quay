---
id: gap-idle-watch-session-disabled-false-positive-long-tasks
title: idle-watch SESSION-DISABLED 假阳性——三合取（cache_read 单调恒真 + 长任务静默 + worktree 不变）在【任何长任务】期间同真，无一项测「推进」；失能=没推进，判据漏了推进量（manager 21:2xZ 报）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（idle-watch SESSION-DISABLED 假阳性——manager 2026-08-14 21:2xZ 报，outer 核实）**。

**现场**：idle-watch 报 `SESSION-DISABLED quay`，实测为假阳性——phase-boundary 全量 suite 正在跑（`--test-concurrency=8 × 7`、load1 9.08、worktree 内活进程），是长任务非失能。

**告警判据（三合取）**：
```
cache_read_input_tokens ≥ 450000 && develop 静默 ≥ 10min && 在飞 worktree 集合无变化 ⇒ SESSION-DISABLED
```

**结构性缺陷（三项在【任何长任务】期间都同时为真）**：
```
① cache_read_input_tokens ≥ 450000 —— ⚠️ manager 自己在 CLAUDE.md 记过：该量【单调增、永不回落 ⇒ 判别力贡献 0】
   会话跑够久就恒真 ⇒ 三合取实际退化成后两项
② develop 静默 ≥ 10min —— 长 suite 期间 develop 必然静默（无提交，任务在跑）
③ worktree 集合无变化 —— 长 suite 期间必然不变
⇒ 判据把「长任务」误报为「失能」，而三项里【没有任何一项测「有没有推进」】
```

**⇒ 「失能」与「长任务」的真正区别恰恰就是【有没有推进】** —— 判据漏掉了推进量。

**顺带自嘲（manager 记）**：CLAUDE.md 明写 `cache_read_input_tokens` 判别力贡献 0，而 idle-watch 判据第一项就是它——写规则的人和用坏读数的人是同一个。

**判据1**：加【推进量】合取项，且必须能取假——长任务期间（worktree 内 node --test / 实现进程活）应【不】报 SESSION-DISABLED。
**候选（manager 不选、不设 N，成本结构未测）**：
```
A：在飞 worktree 内 node --test / 实现进程数 == 0（配窗口，秒级波动）
B：该 worktree 的 git 最后提交时刻 / 文件 mtime 在 N 分钟内无变化
C：inner 心跳的最后写入时刻（持续自驱，可靠推进信号）
```
**判据2（能取假·真样本现成）**：此刻（phase-boundary 长 suite 在跑）应【不】报 DISABLED——现真值报 DISABLED ⇒ 假。修复后长任务不误报。
**判据3（负控制·真失能仍报）**：真正失能（无进程、无提交、心跳停）仍应报 SESSION-DISABLED——不因加推进量而吞真失能。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**优先级（manager 给低）**：误报代价=一条噪声告警，不阻塞任何东西；但会【训练人忽略该告警】——正是「恒红被归档成已知家族」的形态，不能不管。不因低优先级拖延，但也不抢在阻塞项前。

**不覆盖**：不设 N 阈值（成本结构未知，归人裁）；不改「失能→告警」本身的语义（真失能仍报）；不弱化 SESSION-DISABLED 对真失能的处置。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 idle-watch 的 SESSION-DISABLED 判据实现（三合取）——manager 报的 cache_read 单调项 + develop 静默 + worktree 不变。
2. 判据1：加推进量合取项（候选 A/B/C 之一或组合，能取假）。
3. 判据2 能取假：长任务（此刻 phase-boundary suite）不误报 DISABLED（现误报）。
4. 判据3：真失能仍报（不吞真阳性）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：SESSION-DISABLED 判据加【推进量】合取项（能取假——长任务期间有进程/心跳/提交推进）。
- [x] AC2 判据2 能取假：长任务（phase-boundary suite 在跑）不误报 DISABLED（现误报）。
- [x] AC3 判据3：真失能仍报 SESSION-DISABLED（不吞真阳性）。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] idle-watch SESSION-DISABLED 加推进量判据（长任务不误报）+ 真失能仍报 + 测试绿。

## Touches

- plugin/scripts/session-liveness.sh（SESSION-DISABLED 判据实现——加第⑤条推进量合取项 `_sl_heartbeat_stale`，复合判定 `_sl_sat_disabled_verdict` 五元化）
- plugin/test/session-liveness.test.mjs（补测 scd-h：长任务心跳新鲜不误报 DISABLED / 真失能心跳陈旧仍报；既有 scd-* 的 saturatedTranscript 心跳回拨 ≥T 建模真失能形态）
- plugin/test/session-liveness-signals-kinds.test.mjs（承重条饱和 fixture 心跳回拨 ≥T，配合 ⑤）
- tasks/gap-idle-watch-session-disabled-false-positive-long-tasks.md（自身）

## Evidence

- **判据1（推进量合取项，选候选 C）**：`_sl_heartbeat_stale`（`plugin/scripts/session-liveness.sh`）——会话自身心跳（生效 transcript + `<会话>/subagents/` 最大 mtime，`heartbeat_mtime` 已并上）最后写入时刻 ≥ T = `SATURATION_SILENCE_MIN` 未动才放行（返回 1）；心跳在 T 内被写过 ⇒ 会话在推进 ⇒ 返回 0（合取项取假，长任务不误报）。**不设新 N 阈值**：复用既有 `SATURATION_SILENCE_MIN`（同一「该层已静默 ≥ T」语义），与候选 B（git mtime，长 suite 合法无提交 ⇒ 弱）不同——心跳由 inner 持续自驱（候选 C 的直接量），长 suite 由 subagent 驱动时写的是 `<会话>/subagents/`，仍在推进。`_sl_sat_disabled_verdict` 四元 → 五元。
- **判据2（长任务不误报，能取假）**：新测试 scd-h（`plugin/test/session-liveness.test.mjs`）——饱和 + develop 静默 + 在飞集合无变化 + 无 worktree 活进程下，心跳新鲜（长 suite 推进中）⇒ **不报** SESSION-DISABLED；旧四元（①-④）此场景全真，故「不报」只能归因于 ⑤ 取假（硬规则 4：恒真合取项贡献零）。回放 manager 21:2xZ 现场形态：phase-boundary 全量 suite 在跑而 DISABLED 误报，根因 = 原判据无一项测「有没有推进」（cache_read 单调恒真、develop 长任务必然静默、worktree 集合必然不变、活进程也不总能被 /proc/cwd 看到——主 checkout 恒排除）。
- **判据3（真失能仍报，不吞真阳性）**：scd-h 后半 + 既有 scd-a/scd-e1/scd-g——心跳变陈旧（会话真停摆，≥ T 未写）⇒ ⑤ 翻真 ⇒ **仍报** SESSION-DISABLED。既有 `saturatedTranscript`（`session-liveness.test.mjs`）与 signals-kinds 承重条饱和 fixture（`plugin/test/session-liveness-signals-kinds.test.mjs`）心跳回拨 ≥T（20min）建模「已停摆」的饱和会话——分类器读记录内容不读文件 mtime，饱和判定不受回拨影响。
- **判据4（测试绿）**：`bash scripts/test.sh --for-task gap-idle-watch-session-disabled-false-positive-long-tasks --allow-thin` **exit 0**；22/22 测试 pass（session-liveness-signals-kinds 14 + session-liveness 8，含新 scd-h）；静态检查全部 PASS。
