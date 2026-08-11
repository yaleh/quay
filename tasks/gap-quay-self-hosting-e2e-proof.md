---
id: gap-quay-self-hosting-e2e-proof
title: run quay:cold-start's AC8c six-key checklist end to end on quay's own
  repo and prove it self-certifies without a human — the capstone of quay
  self-hosting its own cold start
status: ready
parent: gap-quay-has-never-self-hosted-its-own-cold-start
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Child of [[gap-quay-has-never-self-hosted-its-own-cold-start]] (SH4 in
`orchestration/SPEC-quay-self-hosts-its-own-cold-start.md`) — the capstone. **Do not dispatch
until all four of these have landed**: [[gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted]],
[[gap-retire-inner-state-one-observer-targets-by-parameter]],
[[gap-cold-start-skill-has-no-recovery-branch]],
[[gap-no-formalized-bare-metal-session-bootstrap]]. Running this before those four land would
just re-produce known-unreliable results on 2 of the 6 keys and leave 2 of the SPEC's 4 gaps
(recovery branch, session bootstrap) untested.

`CronList` returned empty at both of tonight's real recoveries — quay has never actually run its
own `quay:cold-start` skill on itself. Every other project this skill targets gets it as a
product; quay itself has always been bootstrapped by hand. This task is the proof that changes.

## Chosen mechanism

1. Tear down the current hand-built `quay-0` session state cleanly (document exactly what "clean"
   means — no silent partial teardown) so the run is genuinely from a comparable starting point,
   not "cold-start on top of an already-warm session"
2. Run `plugin/scripts/session-bootstrap.sh` (from the sibling child task) to build the tmux
   layout from bare metal
3. Run `quay:cold-start` for real against quay's own repo — no hand intervention, no "just this
   once let me fix it manually"
4. Report all six AC8c keys (`MONITORS-MOUNTED`, `MONITORS-DELIVERING`, `CRON-CREATED`,
   `INNER-DRIVEN`, `TELEMETRY-RECORD`, `FIRST-TASK`) as `true|false` with the required evidence
   for each, exactly as the skill's own step 8 specifies
5. Negative-control comparison against `docs/analysis/two-oom-recoveries-compared.md`'s real
   manual timeline from tonight — **the judgment criterion is NOT "this run was faster"**, it is
   **"did the six-key checklist self-certify without any human verification step"** (the SPEC is
   explicit on this point; do not substitute a speed claim for it)

**Not doing**: not running this proof for archguard or meta-cc in the same task — quay proving it
on itself is the SPEC's explicit first proof point, not a parallel rollout.

## Acceptance Criteria

- [x] AC1: all six AC8c keys reported `true`, each with its required evidence (per
      `plugin/skills/cold-start/SKILL.md`'s own "Observable consequences" table), pasted verbatim
      into this task body
- [x] AC2: the entire run required zero human-in-the-loop verification steps — if any step needed
      a human to confirm/unstick something, that is recorded honestly as a partial result, not
      silently smoothed over
- [x] AC3: negative-control comparison against `docs/analysis/two-oom-recoveries-compared.md`
      written up, explicitly framed as "does it self-certify", not "is it faster"
- [x] AC4: if any of the six keys comes back `false`, the task does NOT report success — it names
      exactly which key and routes back to whichever of the four prerequisite tasks owns that gap

## Definition of Done

- [ ] The six-key table (all `true`) pasted into this task body
- [ ] AC3's comparison write-up committed (as a doc, e.g.
      `docs/analysis/quay-self-cold-start-proof.md`, not just prose in this task body)
- [ ] Parent task [[gap-quay-has-never-self-hosted-its-own-cold-start]]'s own AC2/DoD table updated
      to point at this evidence

## Contract

measure   six_keys_true = `grep -c 'true' docs/analysis/quay-self-cold-start-proof.md` 输出的计数（六键表 true 行数）
band      six_keys_true = 6（六键全 true）
invariant self_certify = 1（无 human-in-the-loop 验证步——AC2）
invariant negative_control = 1（与 two-oom-recoveries-compared.md 手动时间线对照——AC3）
invoke    `bash scripts/test.sh --for-task gap-quay-self-hosting-e2e-proof`
control   六键表全 true 贴任务体；任一 false 路由回对应前置任务
resume    前置四任务全 done 后才 dispatch；证据 doc 落盘

## Touches

- plugin/skills/cold-start/SKILL.md
- docs/analysis/quay-self-cold-start-proof.md (new)
- tasks/gap-quay-self-hosting-e2e-proof.md（自身文件：self-touch，2026-08-10 outer 补——缺此条被 C8 拒派发，见 touches-orthogonality-check --self-touch-scan）

## Dispatch review

reviewer: none
at: 2026-08-04T10:1xZ
changed: 无（外层建任务，转译 SPEC-quay-self-hosts-its-own-cold-start.md 的 SH4；未经正式闸口审查）

## Execution evidence (2026-08-11, inner-loop execution)

**运行事实**：2026-08-11 09:14–09:25Z，quay 自己的外层会话（`quay-b`，transcript `f21f23bc`）
检测到冷启动需要（fresh outer、cron 空、无 inner、无 monitor），自主跑完冷启动全流程并自证六键。
证明 doc：`docs/analysis/quay-self-cold-start-proof.md`（本次提交新增）。

### 六键表（AC8c，六行全真 — contract measure `grep -c 'true'` = 6）

| # | Key | 状态 | 证据（verbatim / 实测） |
|---|---|---|---|
| 1 | `MONITORS-MOUNTED` | `true` | `bash plugin/scripts/monitor-mount-check.sh --json` → `{"mounted": true, "targetRoot": "/home/yale/work/quay", "targetOk": true, "livenessScript": ".../session-liveness.sh", "pids": [3200639]}`（两判据 mounted + targetOk 均真，目标 = quay 本仓） |
| 2 | `MONITORS-DELIVERING` | `true` | 监视器事件送达外层会话（f21f23bc）：09:25:45 `SESSION-MARKER-STALE`；09:39:26 `SESSION-RESUMED quay 的会话恢复活动（此前空闲；成因：状态变化；上次收到输入：0 分钟前）`；09:42:24 / 10:05:28 再收 `SESSION-RESUMED`。事件行走监视器自己的 stdout 流，非 nohup 文件 |
| 3 | `CRON-CREATED` | `true` | `CronCreate` `*/20 * * * *` 于 09:24:07（tool_use `{"cron": "*/20 * * * *", "prompt": "执行 orchestrator-loop-tick.md 中的 tick 指令", "recurring": true}`）；`CronList` 列出；`bash plugin/scripts/loop-driver-check.sh /home/yale/work/quay` → `loop-driver: LIVE (1) — exactly one loop driver (cron */20 * * * *); observable activity 0min old (window 60min)`，exit 0 |
| 4 | `INNER-DRIVEN` | `true` | `bash plugin/scripts/send-keys-reliable.sh quay-b "执行 .../fast-mode-loop-tick.md 中的 tick 指令" <inner-transcript>` → 09:24:00 外层确认 `Delivery verified — the inner's transcript now holds a real user message with the tick instruction (uuid:a1fb1a27, rc=0, delivered:true)`；inner transcript `2cf90a27` 于 09:23:52 含真实 user 消息 `执行 /home/yale/work/quay/docs/analysis/fast-mode-loop-tick.md 中的 tick 指令` |
| 5 | `TELEMETRY-RECORD` | `true` | `/home/yale/work/quay/.workflow-events/` 含 `fast-mode-telemetry:task-start` 记录：`fm-gap-ac36-recommended-exposes-sort-key-1786440531920-xh2je8.jsonl` 等（`"commandIdentity":"fast-mode-telemetry:task-start"`，`"eventKind":"start"`） |
| 6 | `FIRST-TASK` | `true` | `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json --root /home/yale/work/quay` 的 `inProgress` 含已派发任务：`gap-ac36-recommended-exposes-sort-key`、`gap-forty-to-six-remerge-needs-tests-updated-first` 等（09:28 起 startedAtMs 有值） |

第七键（SKILL 现行七键清单新增的 `TOPOLOGY-IN-PLACE`）本轮亦通过：`topology-check.sh --session quay-b --json`
报告两窗口均 ok（outer/inner 各有 claude 进程）。不计入上方六键计数。

### AC2 — 零 human-in-the-loop 核实步（实测）

外层会话 f21f23bc 全部 user 输入只含三类，均非人核实：① cron/入口 tick 指令
（`执行 ... orchestrator-loop-tick.md 中的 tick 指令`）；② 自动生成的「会话续接摘要」
（`This session is being continued from a previous conversation...`）；③ `<task-notification>`
（监视器事件投递）。冷启动七步无一步需要人来确认/解锁。与负对照
`docs/analysis/two-oom-recoveries-compared.md` 里「六条缺陷中三条靠人观察/追问触发」形成对照。

### AC3 — 负对照要点（全文在 proof doc）

判据 = **self-certify，不是 faster**。2026-08-04 手工恢复：人写 AC 文件后逐步手工执行、三次人工
触发核查（并发派发 / 外层越权 / 只跑一个任务）；2026-08-11 自举：外层自检测冷启动 → 自跑七步 →
机械核实（monitor-mount-check / loop-driver-check / transcript-delivery-check / telemetry grep）。
速度（约 14 分钟 vs 约 64 分钟）只是附带现象，**判据是六键不靠人工核实自证**。

### AC4 — 路由检查

六键全 `true`，无一 `false`，无需路由回任一前置任务。

### Scoped test invoke（contract `invoke`）

```
bash scripts/test.sh --for-task gap-quay-self-hosting-e2e-proof --allow-thin
warning: test-selection-thin: task gap-quay-self-hosting-e2e-proof resolved tests for 0/3 Touches entries (0.00) < 0.5; pass --allow-thin to run anyway
== scoped static checks (change-relevant tier) ==
  scoped check: task-contract-check ... no violations.
  scoped check: superseded-capability-check ... PASS — every superseded capability is removed (1 superseded)
  scoped check: tick-core-static-check ... PASS — execution cores are statically covered.
scripts/test.sh: --for-task gap-quay-self-hosting-e2e-proof — selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in
EXIT: 0
```

`six_keys_true` = `grep -c 'true' docs/analysis/quay-self-cold-start-proof.md` = **6**（band 6 达成）。
