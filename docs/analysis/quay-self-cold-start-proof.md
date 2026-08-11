# quay 自举冷启动证明（quay self-hosts its own cold start）

**日期**：2026-08-11（外层会话 `quay-b` / transcript `f21f23bc` 实跑）
**任务**：[[gap-quay-self-hosting-e2e-proof]] — SPEC-quay-self-hosts-its-own-cold-start.md 的 AC-SH4 可判收口。
**判据**：不是「这次比手工快」，是 **「六键判据能不能不靠人工核实就自证」**（SPEC 明示，勿用速度主张替换）。

---

## 1. 运行事实（不是印象，是实测）

2026-08-11 09:14–09:25Z，quay 自己的外层会话（`quay-b`，新建于 09:14）在 tick 入口检测到冷启动
需要（fresh outer、cron 空、无 inner、无 monitor），随后**自己跑完冷启动全流程**：建拓扑 →
起 inner → 驱动 inner（send-keys-reliable 投递验证）→ 重建 cron（CronCreate */20）→ 挂监视器 →
验证 telemetry → 首个 tick。全程外层自主完成，无人介入核实任何一步（AC2）。

对比负对照 `docs/analysis/two-oom-recoveries-compared.md`（2026-08-04 两次 OOM 恢复，全程手工、
六条缺陷里三条靠人发现）。

## 2. 六键表（AC8c，六行全真）

| # | Key | 状态 | 证据（verbatim / 实测） |
|---|---|---|---|
| 1 | `MONITORS-MOUNTED` | `true` | `bash plugin/scripts/monitor-mount-check.sh --json` → `{"mounted": true, "targetRoot": "/home/yale/work/quay", "targetOk": true, "livenessScript": ".../session-liveness.sh", "pids": [3200639]}`（两判据 mounted + targetOk 均真，目标 = quay 本仓） |
| 2 | `MONITORS-DELIVERING` | `true` | 监视器事件送达外层会话（f21f23bc）：09:25:45 `SESSION-MARKER-STALE`；09:39:26 `SESSION-RESUMED quay 的会话恢复活动（此前空闲；成因：状态变化；上次收到输入：0 分钟前）`；09:42:24 / 10:05:28 再收 `SESSION-RESUMED`。事件行走监视器自己的 stdout 流，非 nohup 文件 |
| 3 | `CRON-CREATED` | `true` | `CronCreate` `*/20 * * * *` 于 09:24:07（tool_use `{"cron": "*/20 * * * *", "prompt": "执行 orchestrator-loop-tick.md 中的 tick 指令", "recurring": true}`）；`CronList` 列出；`bash plugin/scripts/loop-driver-check.sh /home/yale/work/quay` → `loop-driver: LIVE (1) — exactly one loop driver (cron */20 * * * *); observable activity 0min old (window 60min)`，exit 0 |
| 4 | `INNER-DRIVEN` | `true` | `bash plugin/scripts/send-keys-reliable.sh quay-b "执行 .../fast-mode-loop-tick.md 中的 tick 指令" <inner-transcript>` → 09:24:00 外层确认 `Delivery verified — the inner's transcript now holds a real user message with the tick instruction (uuid:a1fb1a27, rc=0, delivered:true)`；inner transcript `2cf90a27` 于 09:23:52 含真实 user 消息 `执行 /home/yale/work/quay/docs/analysis/fast-mode-loop-tick.md 中的 tick 指令` |
| 5 | `TELEMETRY-RECORD` | `true` | `/home/yale/work/quay/.workflow-events/` 含 `fast-mode-telemetry:task-start` 记录：`fm-gap-ac36-recommended-exposes-sort-key-1786440531920-xh2je8.jsonl` 等（`"commandIdentity":"fast-mode-telemetry:task-start"`，`"eventKind":"start"`） |
| 6 | `FIRST-TASK` | `true` | `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json --root /home/yale/work/quay` 的 `inProgress` 含已派发任务：`gap-ac36-recommended-exposes-sort-key`、`gap-forty-to-six-remerge-needs-tests-updated-first` 等（09:28 起 startedAtMs 有值） |

> 第七键（2026-08-08 `gap-l2-continuous-health` 给 SKILL 新增的 `TOPOLOGY-IN-PLACE`）本轮亦通过：
> `bash plugin/scripts/topology-check.sh --session quay-b --json` 报告两窗口均 ok（outer/inner 各有
> claude 进程）。本表按任务/SPEC 的 AC8c 六键列 6 行；第七键作为 SKILL 现行七键清单的补充记录，
> 不计入上方六键计数。

## 3. AC2 — 零 human-in-the-loop 核实步

外层会话 f21f23bc 的全部 user 输入只有三类，均非人核实：
- cron/入口 tick 指令（`执行 ... orchestrator-loop-tick.md 中的 tick 指令`）
- 自动生成的「会话续接摘要」（`This session is being continued from a previous conversation...`）
- `<task-notification>`（监视器事件投递）

冷启动七步（建拓扑 → 起 inner → 驱动 → 建 cron → 挂 monitor → 验证 telemetry → 首个 tick）
没有任何一步需要人来确认/解锁。与负对照里「六条缺陷中三条靠人观察/追问触发」形成对照。

## 4. AC3 — 负对照：self-certify，不是 faster

| 维度 | 2026-08-04 手工恢复（two-oom-recoveries-compared.md） | 2026-08-11 自举冷启动 |
|---|---|---|
| 判据形态 | 人写 AC 文件后逐步手工执行、手工核实 | 外层按 tick 入口自检测冷启动 → 自跑七步 → 机械核实每步 |
| 核实主体 | 人（三次人工触发核查：并发派发、外层越权、只跑一个任务） | 机制（monitor-mount-check / loop-driver-check / transcript-delivery-check / telemetry grep） |
| 缺陷发现 | 六条缺陷里三条靠人观察/追问 | 本轮冷启动无 human 核实步；监视器事件（SESSION-RESUMED / MARKER-STALE）由外层自主处置 |
| 恢复→首次派发 | 约 64 分钟（08:52→09:56） | 约 14 分钟（09:14 会话建 → 09:28 内层 `--task-start`） |

**读法**：速度数字只是附带现象，**不是判据**。判据是「六键判据能否不靠人工核实就自证」——本轮
六键全部由机械检查产生，外层对每一键都读了机械输出（mounted/targetOk、LIVE(1)、
投递确认 + transcript 行、task-start 记录、inProgress），无一处「人看一眼确认」。这就是
「self-certify」。

## 5. 结论

- AC1：六键全真，每键证据在上表；已 verbatim 贴入任务体。
- AC2：零 human-in-the-loop 核实步（实测 user 输入只含 tick 指令 / 续接摘要 / 通知）。
- AC3：负对照成文（本文件），判据 = self-certify 而非 faster。
- AC4：六键无一为假，无需路由回任一前置任务。

quay 已用自己的 `quay:cold-start` 机件在**自己的仓库**上完成冷启动并自证六键（2026-08-11 09:2x）。
