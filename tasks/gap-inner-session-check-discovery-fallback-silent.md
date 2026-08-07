---
id: gap-inner-session-check-discovery-fallback-silent
title: "inner-session-check discovery-pid fix has a SILENT degraded fallback —
  TR_SOURCE=discovery (the KNOWN-broken heuristic that misidentifies transcript)
  is emitted but NO consumer checks it: the --json consumer
  (orchestrator-loop-tick.md:63 cold-start step-3 self-check) reads
  state/window/process/transcript/transcriptFresh but NOT transcriptSource;
  /proc/<pid>/environ is LINUX-ONLY (B machine is Linux so it works NOW, but a
  non-Linux host or unreadable environ silently reverts to the
  misidentifying-transcript bug and still reports state=healthy — 'correct
  conclusion via wrong evidence' returns WITHOUT alarm; this is the breeding/
  hereditary shape: fix works on the current host, degrades silently on the
  next adopter); fix direction: fail-closed OR loud alarm on
  TR_SOURCE=discovery (stderr + state marked degraded/unknown), consumer reads
  transcriptSource and alarms"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**discovery-pid 修复的退化路径是静默的——管理者繁殖关切，外层独立核实成立。**

**【修复现状】**：inner-session-check.sh discovery 已改结构性（PID→environ CLAUDE_CODE_SESSION_ID→
transcript，commit 12936f90），verified c7b58e09。但 line 178 无 PID/无 session id 时**静默退回旧启发式**
（今天刚证明会认错 transcript 那套），仅用 TR_SOURCE=discovery 标记。

**【外层独立核实——无人消费该字段】**：
- `TR_SOURCE` 只有脚本自己打印（transcript-source / --json 的 transcriptSource），**无任何外部消费者**；
- tick 文档（plugin/loop/orchestrator-loop-tick.md:63）cold-start 第 3 步自检读
  `{state, window, process, transcript, transcriptFresh}`——**不含 transcriptSource**；
- cold-start skill 完全不引用 inner-session-check。

**【为什么是繁殖缺陷而非边缘】**:`/proc/<pid>/environ` 是 **Linux 专属**。B 机是 Linux 所以现在不炸；
但非 Linux 主机（或 /proc 不可读/权限受限）会静默回退 discovery 启发式，仍报 state=healthy——
「对结论错证据」无声回归，且**没有任何告警**。修复在当前主机工作，却在下一个采用者主机静默退化——
正是「遗传缺陷修复不装则下一位采用者继承坏基因」的形态（manager 的繁殖判据）。

**【fix 方向（管理者建议 + 外层采纳）】**：fail-closed 或 loud。
- 首选：**fail-closed**——无结构性来源时 state=unknown/degraded（不猜），或 stderr 报警；
- 次选：**loud**——保留 best-effort 回退但 stderr 警告 + state 标 degraded，且 **--json 消费者读
  transcriptSource，==discovery 时报警/拒收**。

### 选定机制

1. 脚本：TR_SOURCE=discovery 时 stderr 报警 + state 标 degraded（不静默 healthy）
2. --json 消费者（cold-start 3 自检）读 transcriptSource，==discovery ⇒ 报警
3. 非 Linux / /proc 不可读实测：不静默回退（fail-closed 或 loud）

## Acceptance Criteria

- [x] AC1: TR_SOURCE=discovery 路径不静默报 healthy——stderr 报警 或 state=degraded/unknown（实测）
- [x] AC2: cold-start 自检 --json 消费者读 transcriptSource，==discovery 时报/拒收
- [x] AC3: 非 Linux / 无 /proc 实测：不无声回退到旧启发式（fail-closed 或 loud）
- [x] AC4: 与 gap-inner-session-check-discovery-reads-wrong-transcript（done）交叉标注——其 AC4 留空
      （无 PID 回退启发式非 fail-closed）正是本条目的起源

## Touches

- tasks/gap-inner-session-check-discovery-fallback-silent.md
- plugin/scripts/inner-session-check.sh（退化路径报警/fail-closed）
- plugin/loop/orchestrator-loop-tick.md（cold-start 3 自检消费者读 transcriptSource）
- plugin/test/inner-session-check.test.mjs（退化路径负控制）

## Contract

measure   degraded_alarm = `bash plugin/scripts/inner-session-check.sh 2>&1 | grep -c 'degraded\|warning\|discovery'` 在强制退化时 stdout/stderr 数字段
band      degraded_alarm >= 1（退化路径不静默）
invoke    `grep -n 'transcriptSource\|TR_SOURCE\|degraded' plugin/scripts/inner-session-check.sh plugin/loop/orchestrator-loop-tick.md`
control   强制 TR_SOURCE=discovery ⇒ 报警（AC1）；healthy 正常路径零告警（不回归）
resume    fail-closed 与消费者报警分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T16:5xZ
changed: 管理者繁殖关切（使用视角）+ 外层独立核实（无消费者读 transcriptSource）立案。证据链：
内层修复 12936f90 → 退化路径 line 178 静默 → tick 文档 :63 消费者不含 transcriptSource →
cold-start skill 不引用 → 非 Linux 无声回归原 bug。AC4 关联已 done 任务的留空 AC4。

## Carries

from: gap-inner-session-check-discovery-reads-wrong-transcript
acs: AC4（无 PID 时 fail-closed/loud——本任务的 fix 方向承接）

## 修复记录（2026-08-06，内层执行）

**机制**：TR_SOURCE=discovery（退化路径/旧启发式）不再静默——脚本 stderr 报警 + state=degraded
（fail-closed），绝不静默报 healthy；cold-start --json 消费者读 transcriptSource==discovery 时报警/拒收。

1. **脚本**（plugin/scripts/inner-session-check.sh）：
   - `resolve_transcript` 后：`TR_SOURCE=discovery` ⇒ stderr WARNING + state=**degraded**
     （state 判定链：missing → discovery→degraded → fresh→empty-shell → healthy）。
   - 结构性发现（discovery-pid）里 `/proc/<pid>/environ` 不可读（非 Linux/hidepid/权限）⇒ 专门 WARNING
     （AC3：不无声回退）。用法/JSON 注释改为四态。
2. **消费者**（plugin/loop/orchestrator-loop-tick.md 冷启动第 3 步）：state 表新增 **退化** 行 +
   `degraded` 分派（报警+结构解析重试+升级）；transcript 解析段改为「发现路径 KNOWN-BROKEN，消费者必须读
   `transcriptSource`，==discovery 报警/拒收，不得按 healthy 放行」。
3. **负控制测试**（plugin/test/inner-session-check.test.mjs）：新增 AC1（discovery 报警+degraded）、
   AC2（tick 文档消费者读 transcriptSource）、AC3（would-be-healthy 不报 healthy）三测；healthy 正常
   路径断言零告警（Contract control 不回归）。13/13 pass。

**AC 证据**：
- AC1（实测）：`inner-session-check.test.mjs`「AC1 — TR_SOURCE=discovery alarms on stderr and marks
  state=degraded」——强制 discovery（结构来源不可用 + 植入候选 transcript）⇒ stderr 含
  discovery/degraded/WARNING，state=degraded（非 healthy/empty-shell）。
- AC2（实测）：tick 文档冷启动第 3 步现含 `transcriptSource` + `==discovery` + `不得按 healthy 放行`；
  测试「AC2 (fallback-silent) — the cold-start consumer reads transcriptSource」断言通过。
- AC3（实测）：测试「AC3 — a discovery-sourced USER_MSG transcript (would-be-healthy breeding shape)
  yields degraded + alarm, never healthy」——USER_MSG 候选（旧启发式会判 healthy）⇒ state=degraded +
  stderr 报警；`/proc environ 不可读`分支有专门 WARNING（代码路径；对 /proc 不能 chmod，无 hermetic 直测，
  行为契约「不无声回退」由上述两测覆盖）。
- AC4（交叉标注）：本文件 `## Carries` 已记 from 该任务 AC4；done 任务
  `gap-inner-session-check-discovery-reads-wrong-transcript.md` 追加交叉标注，注明本任务收口其留空 AC4。

**invoke 证据**：
```
$ grep -n 'transcriptSource\|TR_SOURCE\|degraded' plugin/scripts/inner-session-check.sh plugin/loop/orchestrator-loop-tick.md
plugin/scripts/inner-session-check.sh:10:#   degraded     窗口+进程存在，但 transcript 仅由发现启发式解析（TR_SOURCE=discovery）——
plugin/scripts/inner-session-check.sh:196:    echo "WARNING: ... /proc environ unreadable ... (non-Linux host / hidepid / permission) ..."
plugin/scripts/inner-session-check.sh:208:    TR_PATH="$candidate"; TR_SOURCE="discovery"
plugin/scripts/inner-session-check.sh:245:if [ "$TR_SOURCE" = "discovery" ]; then
plugin/scripts/inner-session-check.sh:246:  echo "WARNING: inner-session-check: transcript resolved via DISCOVERY heuristic ... state=degraded (fail-closed) ..."
plugin/scripts/inner-session-check.sh:256:elif [ "$TR_SOURCE" = "discovery" ]; then
plugin/scripts/inner-session-check.sh:257:  STATE="degraded"
plugin/scripts/inner-session-check.sh:273:    "transcriptSource": os.environ["TR_SOURCE"],
plugin/loop/orchestrator-loop-tick.md:61:| **退化** | inner 窗口+进程存在，但 transcript 仅由发现启发式解析（`transcriptSource=discovery`，...）| ...
plugin/loop/orchestrator-loop-tick.md:64:bash plugin/scripts/inner-session-check.sh --json   # 四态自检：{state: healthy|empty-shell|missing|degraded, ..., transcriptSource, ...}
plugin/loop/orchestrator-loop-tick.md:83:- **`degraded`** ⇒ **报警（不自认 healthy）** ...
plugin/loop/orchestrator-loop-tick.md:96:**本步（--json 消费者）必须读 `transcriptSource`**：`==discovery` ⇒ 报警 + 按 degraded 处理（结构解析重试 / 升级）...
```

**Contract measure（强制退化实测）**：
`degraded_alarm = bash plugin/scripts/inner-session-check.sh 2>&1 | grep -c 'degraded\|warning\|discovery'`
= **2**（WARNING 行 + `"transcriptSource": "discovery"` 行）≥ band 1。healthy 正常路径（--transcript）stderr
零告警（Contract control 不回归）。范围化套件 `scripts/test.sh --for-task ...` 全绿：13/13 tests pass，
task-contract-check / drive-contract-check / adr016 全部 PASS。

**复核（2026-08-07，独立执行工作区验证）**：本任务实现已在 develop 落地（commit 3936f715，merge
e6a3ead5），本次复核重跑全部验证确认 AC 仍成立——`scripts/test.sh plugin/test/inner-session-check.test.mjs`
13/13 pass；`--for-task` 范围化静态层（task-contract-check strict-subset / drive-contract-check /
adr016-screen-use-check）全 PASS；强制退化实测（hermetic tmux + 植入候选 transcript，结构性
discovery-pid 不可用）⇒ `degraded_alarm=2`（WARNING 行 + `"transcriptSource": "discovery"` 行）、
`state=degraded`、`transcriptSource=discovery`、stderr 报警——绝不静默 healthy；healthy 正常路径
（--transcript）stderr 零告警（Contract control 不回归）。status 由 ready 置为 done 收口。
