---
id: gap-verify-referenced-landed-concurrency-hardening-insufficient
title: verify_referenced_landed 并发下扫描时序非确定——--loop 并发安装时 torn-read 假阳性挡 fan-in（既有加固史不够）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`quay-init.sh` 的 `verify_referenced_landed` 在 `--loop` **并发安装**下扫描时序非确定，产生假阳性「referenced-not-landed」→ exit 2 → 挡全量 suite → 挡所有 fan-in。实证 2026-08-25（worker 报 develop 级 blocker）：
- `session-liveness-events.test.mjs` AC2（`quay-init --loop` 铺 session-liveness.sh VERBATIM）**单独跑 AC2 ✔ fail 0**（确定性绿）；**并发跑才红**；
- 两轮命中集完全不同类别（run A 8 个 plugin/scripts/*、run B 2 个 .claude/workflows/*）——正是 torn-read 签名，非稳定漂移（真漂移同一组文件稳定复现）；
- 我核实：run A 报的 8 个 plugin/scripts/*（task-status-drift-check.ts / tmux-leak-scan.sh / worktree-process-reaper.ts 等）`declared=0` 但**已 land**（`quay-init.sh:705` lay-down 本就 ship plugin/scripts）⇒ `referenced ⊆ landed` 成立，单独跑不红。

**根因方向**：该 check 的注释里已有 `gap-verify-referenced-landed-concurrency-hardening` AC1 + 2026-08-18 STRENGTHENING（稳定性 check：两次读 init/SKILL.md 声明集必须一致）的多轮加固史，但**引用集 grep + landed 集扫描在并发 --loop 下仍非确定**（多 --loop 安装同时写目标 workspace，check 的扫描抓到非确定快照），且声明读的稳定性 check 只覆盖 init/SKILL.md 声明集、不覆盖引用集/landed 集的扫描时序。

## Plan

继续加固 `verify_referenced_landed` 的并发鲁棒性：引用集（docs grep + bare_resolved + consolidated）+ landed 集扫描在同一稳定快照上做，或对并发 --loop 安装加锁/隔离（每安装独立 workspace 或扫描前 barrier）。⛔ 修前先读 `gap-verify-referenced-landed-concurrency-hardening` 原任务（若存在）+ check 内既有加固注释，确认哪些扫描面已加固、哪些仍是裸 grep。⛔ 保持 fail-closed：真漂移（referenced 且未 land 且未声明）仍必须红，不因加固而放宽。

## Acceptance Criteria

- [ ] AC1（能取假，并发确定性）：并发 N 个 `--loop` 安装下，check 对【已 land 的文件】不再报假「referenced-not-landed」（两轮命中集不再漂移）；（⛔ 仍假阳性 ⇒ 假）。
- [ ] AC2（能取假，负控制保留）：造一个「referenced 且未 land 且未声明」的真漂移文件，check 仍确定性红（fail-closed 不因加固而放宽）；（⛔ 真漂移不红 ⇒ 假）。
- [ ] AC3（能取假，单独跑回归）：`session-liveness-events.test.mjs` AC2 单独跑仍绿（不回归）；（⛔ 单独跑红 ⇒ 假）。

## Definition of Done

`verify_referenced_landed` 并发鲁棒性加固落地；AC1/AC2/AC3 全勾；并发安装下 check 确定性、真漂移仍 fail-closed、单独跑不回归。

## Touches

- plugin/scripts/quay-init.sh（verify_referenced_landed 并发加固）
- plugin/test/session-liveness-events.test.mjs 或相关（并发负控制测试）
- tasks/gap-verify-referenced-landed-concurrency-hardening-insufficient.md（自身）
