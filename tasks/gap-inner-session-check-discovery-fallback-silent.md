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
status: todo
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

- [ ] AC1: TR_SOURCE=discovery 路径不静默报 healthy——stderr 报警 或 state=degraded/unknown（实测）
- [ ] AC2: cold-start 自检 --json 消费者读 transcriptSource，==discovery 时报/拒收
- [ ] AC3: 非 Linux / 无 /proc 实测：不无声回退到旧启发式（fail-closed 或 loud）
- [ ] AC4: 与 gap-inner-session-check-discovery-reads-wrong-transcript（done）交叉标注——其 AC4 留空
      （无 PID 回退启发式非 fail-closed）正是本条目的起源

## Touches

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
