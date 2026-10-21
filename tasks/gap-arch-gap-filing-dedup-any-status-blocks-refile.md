---
id: gap-arch-gap-filing-dedup-any-status-blocks-refile
title: arch-review gap-filing 的 dedup 写「ANY status 的同机制任务不再重立」——done 任务的 claim
  不证明缺陷已从当前源码消失（硬规则 5b），立案前需 current-source 复核
status: ready
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

plugin/scripts/quality-gate-driver.ts 的 buildArchGapWorkerPrompt 让短命 filing agent 做 dedup，措辞是「if a task already claims the same defect (ANY status), do NOT file a duplicate」。这把「done 任务的 claim」当成了「缺陷不存在」的证据——正是本会话两次栽的坑（done ≠ absent，硬规则 5b）：改进项若此前被一条 done 任务 claim 过、但缺陷仍在当前源码里，现在的 prompt 会静默不重立，缺陷无人认领。

## Plan

1. 读 buildArchGapWorkerPrompt（quality-gate-driver.ts:937）的当前措辞。
2. 把 dedup 规则从单一的「ANY status ⇒ 不重立」改成两条，区分 open 与 done：
   - open（todo/ready）任务 claim 同一机制 ⇒ 真重复，不重立，报告该任务 id；
   - done/superseded 任务 claim 同一机制 ⇒ 先 grep/读当前源码核实缺陷是否仍可见；仍可见 ⇒ 重立（body 里带旧任务 id 作 traceability，不算 duplicate）；已消失 ⇒ 不重立并记录「旧任务已修复」。
3. ⛔ 不改变 filing agent 的其它职责（shape/AC/Touches 仍归 quay-file-task skill）。

## Acceptance Criteria

- [ ] buildArchGapWorkerPrompt 的文本里，对 done 任务的 claim 不再是无条件「do NOT file a duplicate」，而是「先 current-source 复核（file:line / grep 命中），仍可见则重立并带旧任务 id」。
- [ ] 该措辞可 grep 核对：prompt 文本里 open 与 done 两条 dedup 规则可区分（贴出 grep 命中）。

## Definition of Done

- 两条 AC 全绿；改动经 scripts/test.sh 相关泳道通过，合并进 develop。

## Touches

- tasks/gap-arch-gap-filing-dedup-any-status-blocks-refile.md
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver.test.mjs