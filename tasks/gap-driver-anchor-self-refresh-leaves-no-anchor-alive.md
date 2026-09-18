---
id: gap-driver-anchor-self-refresh-leaves-no-anchor-alive
title: driver anchor 源码自刷新（AC-184）：stop 期间 reconcile 把 loop 重新拉起 + 接管等待预算短于旧
  anchor 最坏退出时间 + 接管放弃后无人兜底 ⇒ 六个 kind 一起停摆（实测 09-13/09-18 共 4 次，最近一次 27 分钟）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Finding

(all measured 2026-09-18 from .quay/anchor.log and plugin/scripts/driver-anchor.ts; NOT inferred, except where marked 假说)

Incident: anchor pid 426878 (started 09:17:42Z) — a fan-in landing at 15:32:59Z changed watched source; the anchor self-refreshed (AC-184): spawned a replacement with --takeover and requested its own stop (`stop requested` 15:33:25Z). anchor.log lines ~6670-6703:

- after the stop request, kind loops finished (`loop stopped`) and were then RE-STARTED by the anchor's own reconcile (`loop started` at 15:33:53, 15:34:41, 15:36:07) so `active` never drained;
- old anchor hit shutdownGraceMs=120000 (`shutdown grace 120000ms exceeded … exiting anyway`, logged 15:36:07Z), then still waits up to min(60s, grace) post-loop, then cleanup; actual exit `anchor: exited` 15:37:18Z = 233s after the stop request;
- the takeover replacement waits shutdownGraceMs+60s = 180s (driver-anchor.ts:201) → at 15:36:20Z `takeover 426878 STILL ALIVE after 180000ms — REFUSING to start … this refresh attempt is abandoned` and exited;
- result: NO anchor alive from 15:37:18Z until a human restarted drivers at 16:04:15Z (27 min; promotion-round.jsonl last round 15:37:18Z; .quay/promotion-driver.pid absent; no supervisor, no OS timer for the driver anchor — os-anchor-watchdog.sh watches Claude sessions, not this).

Three defects:

- D1 driver-anchor.ts:335-337 — the reconcile "start wanted kinds not in active" loop has NO `!stopping` guard, so during a stop finished loops are restarted (the code comment at ~:296-305 itself says stop must be bounded because draining can be unbounded; this makes draining unreachable rather than merely slow).
- D2 the takeover wait budget (`shutdownGraceMs + 60_000`, :201) is not derived from the old anchor's true worst-case exit (grace + post-loop wait min(60s,grace) + cleanup), so a correct-but-slow handoff is declared failed.
- D3 when takeover is abandoned the replacement exits and the old anchor exits anyway ⇒ zero anchors and nothing re-spawns; the abandon path only logs.

Incidence (hard rule 12, from anchor.log, all history in file): 10 `stop requested` episodes; ALL 10 show loops restarted during the stop (3-16 each); 4 of them also exceeded grace + abandoned takeover + forced exit: 2026-09-13T20:28Z, 09-13T23:37Z, 09-18T07:29Z, 09-18T15:33Z (`REFUSING to start` occurs 6 times in total). Gaps between `anchor: exited` and next `host pid=` line: 09-18 07:33→09:17 (1h44m, NOT verified that no other host dispatched then), 09-18 15:37→16:04 (27min, verified: no promotion rounds).

假说 (not verified): adding the `!stopping` guard alone makes drains converge inside the grace window. The causal chain D1→D2→D3 is read from log+code; no controlled re-run was done.

<!-- dedup-ref -->
**查重（已核）**：`task_list` 对 anchor / takeover / self-refresh / shutdownGraceMs / AC-184 / `gap-driver-anchor` 前缀检索，无同机制任务。相关但不同、仅作可追溯性引用（不是本条的任何条件）：`gap-os-anchor-watchdog-lease-model-instead-of-absence-inference`（同族：anchor 存活性；但那条管 Claude 会话活性，本条管 driver anchor 自身的源码自刷新交接）；`gap-a13-a20-stale-carrier-after-worker-driver-takeover`（worker-driver 接管后的陈旧载体，机制不同）。

## Requested action

1. D1: add a `!stopping` guard to the reconcile start branch (driver-anchor.ts ~:336) so no kind is (re)started once a stop is requested.
2. D2: derive the takeover wait deadline from the old anchor's real worst-case exit time instead of `shutdownGraceMs+60_000` (or make the replacement wait on the old pid's exit / anchor.pid removal with a bound that provably exceeds it).
3. D3: an abandoned takeover must not leave zero anchors: the replacement must not exit silently when the old anchor is gone — after the old pid dies it should start (double-dispatch is impossible once the old pid is dead), or an external re-spawn path must exist; the abandon path must leave a machine-readable record (e.g. anchor.json field) distinct from "fresh", never just a log line.

## Acceptance Criteria

Each runnable; use the seams in plugin/test/driver-anchor-stop.test.mjs / driver-anchor.test.mjs — read them first.

- [x] AC1 (D1, red first) a test in plugin/test/driver-anchor-stop.test.mjs: with an injected `invokeKind` whose loop returns immediately, request stop and run several reconcile passes ⇒ assert no `loop started` for a kind after `stop requested`. RED on current code (paste raw output), GREEN after fix. —— **RED（把 `!stopping` 闸临时改回 `if (true)` 的对照实测）**：`AssertionError [ERR_ASSERTION]: stop 请求之后⛔ 不得再出现 loop started（实得 2 条）: 2026-09-18T16:57:38Z anchor: kind=outer loop started (pid=1653522) / … kind=goal loop started (pid=1653522)`（2 !== 0）。**GREEN（修复后）**：同测 0 条 + `invoke.jsonl` 在停机后不再增长（`AC1 (D1) —` @ plugin/test/driver-anchor-stop.test.mjs）。⚠️ 该测**不经** `kernel()`（那一路优先主检出那份内核，worktree 的改动结构上验不到），而是 harness 直接 import 本 worktree 的 `ANCHOR_SCRIPT` 并把真 SIGTERM 发给它。
- [x] AC2 (D1 negative control) with NO stop requested, a loop that returns and is still wanted IS restarted (existing behaviour preserved); and a kind added to desired state after boot is still started. —— 两半都在：`event-loop respawn #N` 计数在场且 `outer` 的 invoke 次数 ≥2；后写入期望态的 `goal` 由 reconcile 起（`kind=goal loop started`），全程无 `stop requested`（`AC2 (D1 负控制) —`）。
- [x] AC3 (D2) test: old anchor whose loops drain only at the grace boundary (grace shortened via QUAY_ANCHOR_SHUTDOWN_GRACE_MS) ⇒ the takeover replacement takes over (no `REFUSING to start`); and a control where the old pid never exits ⇒ replacement still REFUSES (double-dispatch guard preserved). —— 三支：(a) **派生**（`AC3 (D2 派生) —`，RED 对照 = 把 `takeoverBudgetMs` 改回 `grace+60_000` ⇒ 断言 61000 !== 22100 即红；旧式在 grace ≥ 60s 时**恰好等于**最坏退出 180000，不是上界）；(b) **正常交接**（`AC3①`：旧 anchor 的循环 `FAKE_IGNORE_STOP=1` ⇒ 只在宽限边界退，替换进程 `taking over`、无 `REFUSING`/无 `STILL ALIVE`）；(c) **负控制**（`AC3②`：真 `sleep` 旧 pid ⇒ 全程不起循环、不抢 `anchor.pid`、退出码 1 + `REFUSING to start`）。
- [x] AC4 (D3) test: when takeover is abandoned and the old pid subsequently dies, an anchor ends up alive (or a machine-readable `takeover-abandoned` state is written to .quay/anchor.json distinguishable from fresh); assert on the direct quantity (pid liveness / json field), not a log line. —— `AC4 (D3) —`：① 超预算后先落 `takeover-abandoned`（旧 pid 还在 ⇒ `anchor.pid` 仍为 null、无 `loop started`，双派发硬闸未被削弱）；② 杀掉旧 pid ⇒ `.quay/anchor.pid === 替换进程 pid` 且 `kill -0` 为真（**直接量**），记录转 `taken-over-after-abandon`；③ 同一读数出现在 `.quay/anchor.json` 的 `takeover` 字段（manager 已在读的面）；④ 被接管后心跳仍推进（⛔ 不是「进程活着但不干活」）。RED 对照（把放弃改回「立刻 return 1、不留痕」的修复前语义）：本测 32.4s 超时失败 —— 正是生产的「零 anchor」形态。
- [ ] AC5 (production reading, hard rule 推论三) after landing and one real self-refresh in production, anchor.log shows `stop requested` followed by NO `loop started` and a successful takeover; count only episodes whose timestamp is later than the landing commit time. Until such an episode exists mark this AC unchecked with a note, do not tick from fixtures. —— **未勾，且⛔ 不打算由 fixture 勾**：本条需要的是一次**落地之后**的真实自刷新（fan-in 尚未发生 ⇒ 生产 anchor 仍跑旧代码、`stop requested` 的下一趟仍会 `loop started`）。落地后按 `.quay/anchor.log` 里 `stop requested` 之后**没有** `loop started`、且出现 `takeover … — taking over` 的那一段来勾；计数只算时间戳晚于落地提交的 episode。本条 = 本任务的 DoD（REAL LANDING）—— 本条属外层验证（待外部）
- [x] AC6 `node --test plugin/test/driver-anchor*.test.mjs` exit 0; paste # tests/# pass/# fail. —— `EXIT=0`；`ℹ tests 21 / ℹ pass 21 / ℹ fail 0 / cancelled 0 / skipped 0 / todo 0`（含新文件 `driver-anchor-takeover.test.mjs` 4 条）。另：`scripts/test.sh --for-task gap-driver-anchor-self-refresh-leaves-no-anchor-alive --allow-thin` exit 0（tests 13 / pass 13 / fail 0，scoped 静态门全 PASS）。

## Definition of Done

REAL LANDING: the anchor's source self-refresh hands over to a live replacement without leaving zero anchors, observed on the production anchor (AC5), not only in fixtures. Do not restart or kill production drivers as part of this task. Rollback = revert the guard + budget change in driver-anchor.ts.

## Touches

- plugin/scripts/driver-anchor.ts
- plugin/test/driver-anchor-stop.test.mjs
- plugin/test/driver-anchor-takeover.test.mjs
- plugin/test/driver-anchor.test.mjs
- tasks/gap-driver-anchor-self-refresh-leaves-no-anchor-alive.md