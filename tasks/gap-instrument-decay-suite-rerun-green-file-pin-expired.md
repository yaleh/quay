---
id: gap-instrument-decay-suite-rerun-green-file-pin-expired
title: instrument-decay 的 suite-rerun-green 裁定把「被点名的基线红文件」写死：该文件转绿后条件仍 exit
  1，而绿分支仍被另一持久红（full-suite-runner-cgroup AC3）遮挡
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**机制（为什么这是仪器缺陷、不是载体腐烂）**

`plugin/scripts/instrument-decay-check.ts` 的 MANIFEST 里，`fan-in-step-trace.jsonl` / `suite-rerun-green` 的 `conditional-on-input` 裁定把「绿分支不可达」的成因**写死成一个具体文件名** `plugin/test/task-granularity-advice.test.mjs`：条件命令要求最新一条 `rerun` 记录既非绿、又 `files` 含该文件。前一个案件 `gap-instrument-decay-suite-rerun-green-condition-misreads-not-evaluated`（done，提交 `9345708d3`）修好了三态压缩（接受 `rerun-not-evaluated`），但同时把那条文件钉进了正/负控制。

2026-10-26 的当前读数：该文件**已经转绿**（`node --test plugin/test/task-granularity-advice.test.mjs` ⇒ 17/17 pass，exit 0），于是它不再出现在 `rerun.files` 里；最新 3 条 rerun 只点名 `plugin/test/full-suite-runner-cgroup.test.mjs`，而该文件在 HEAD 上确实红（72 tests / 71 pass / 1 fail，失败项 `AC3 — a REAL round's measured concurrency …`）。结果：

- 绿分支**仍然不可达**（末次 `suite-rerun-green` 之后 93 条 rerun：87 `rerun-red` + 6 `rerun-not-evaluated` + **0** `rerun-green`）；
- 但条件命令因为「不再点名那个文件」而 exit 1，检测器把该组报成 `decayed[]` 的 `rate-stopped`（`detail: condition command did not hold (exit 1)`）。

⇒ 声明的**实例**（哪个文件红）过期了，声明的**机制**（持久基线红让 in-round rerun 拿不到绿）没有。把实例写进条件，等于让裁定随「当前红的是哪个文件」随机翻转——这既会在换红文件时误报，也会在真正的写手腐烂（rerun 已经绿了却没写 `suite-rerun-green`）时给出同一个读数方向（两者同形，硬规则 3b）。

**修法方向**

把 `suite-rerun-green` 的 `conditionCmd` 改成**读触发输入本身、不点名任何文件**：

- `explained-absent`（exit 0）⇔ 末次 `suite-rerun-green` 写入之后存在 ≥1 条 `rerun` 记录，且其中**没有** `state==="rerun-green"`，且所有状态都是已知的 `rerun-red` / `rerun-not-evaluated`；
- 以下一律 exit 1（回到 `decayed[]`，fail-closed，未知态不豁免）：末次写入之后出现 `state==="rerun-green"`（绿分支发生了却没写出本组 ⇒ 真写手腐烂）、没有任何 rerun 记录、或出现缺失/未知 state。

`reason` 散文同步改写：把 `task-granularity-advice.test.mjs` 改成「当前实例是 `full-suite-runner-cgroup.test.mjs` 的 AC3」，并明确「文件名是实例说明，不是条件的一部分」。`reviewAfter` 仍保持 `2026-11-22T00:00:00.000Z`（不提供永久豁免）。

<!-- dedup-ref --> prior-claim: `gap-instrument-decay-suite-rerun-green-condition-misreads-not-evaluated`（done）——它修的是同一裁定的「三态压成布尔」并顺带修好了 `task-granularity-advice.test.mjs` 的过期前提；本轮按硬规则 5b 在当前 HEAD 复核：载体仍暗、条件仍 exit 1，而它留下的「不再点名该文件 ⇒ 回到 decayed[]」负控制（`plugin/test/instrument-decay-check.test.mjs:755`）正是本条的缺陷编码 ⇒ done ≠ absent，故新立本案，旧任务 id 仅作追溯。相邻但不同机制、不合并：`gap-fan-in-step-trace-rate-stopped-adjudication`（done，落地裁定机制）、`gap-instrument-decay-explained-absence-declarations`（done，落地同族 3 条裁定）；两条 open 的 instrument-decay 任务（`gap-instrument-decay-dedup-reader-round-log-path`、`gap-instrument-decay-postlanding-two-rounds`）修的是立案去重台账与落地后复查，均不触碰本裁定。

<!-- dedup-ref --> 合并判断 = separate：`task-granularity-advice.ts --touches plugin/scripts/instrument-decay-check.ts --touches plugin/test/instrument-decay-check.test.mjs --json` ⇒ `peers: []`、`mentions: []`。

## AC

- [ ] AC1（现状复现）在主检出运行 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --carrier fan-in-step-trace.jsonl --json`：`carriers[0].evaluated === true`；`decayed[]` 恰含 1 条 `{group:"suite-rerun-green", kind:"rate-stopped"}`，`count === 79`、`lastWrite === "2026-10-21T16:36:58.159Z"`、`detail` 匹配 `/condition command did not hold \(exit 1\)/`；`adjudicated[]` 不含该组。贴出该段 JSON。判据可假：本组重新写入或条件修好后 `decayed[]` 变空。
- [ ] AC2（实例过期 + 新实例仍红，两条直接量）① `node --test plugin/test/task-granularity-advice.test.mjs` ⇒ exit 0 且 `tests 17 / pass 17 / fail 0`（被声明的成因已消失）；② `node --test plugin/test/full-suite-runner-cgroup.test.mjs` ⇒ exit 1，失败用例名含 `AC3 — a REAL round's measured concurrency`（当前阻断者）。贴出两条命令的尾行与退出码。判据可假：① 回转红或 ② 转绿，本任务前提须重判。
- [ ] AC3（触发输入读数）以末次 `suite-rerun-green`（`2026-10-21T16:36:58.159Z`）为界，脚本打印其后 `rerun` 记录数、状态分布与「最新 5 条 rerun 的 ts/state/files」。断言：记录数 ≥ 90、`rerun-green` 计数 === 0、`rerun-red` + `rerun-not-evaluated` 之和 === 记录数、最新 3 条 `files` 均不含 `plugin/test/task-granularity-advice.test.mjs`。贴出脚本与输出。判据可假：出现一条 `rerun-green`，则绿分支的触发已发生，本任务前提须重判。
- [ ] AC4（条件改成触发式 + 六条正负控制）修改 `plugin/scripts/instrument-decay-check.ts` 中 `suite-rerun-green` 的 `conditionCmd`（⛔ 不含任何具体文件名字面量）与 `reason`。在 `plugin/test/instrument-decay-check.test.mjs` 增加/改写成六条控制并贴出用例名与 `node --test plugin/test/instrument-decay-check.test.mjs` 的 tests/pass/fail：① 末次写入后最新 rerun 为 `rerun-red`（点名任意文件）⇒ `explained-absent`；② 为 `rerun-not-evaluated` ⇒ `explained-absent`；③ 末次写入后出现 `rerun-green` ⇒ `decayed[]`（真写手腐烂）；④ 载体里没有 rerun 记录 ⇒ `decayed[]`；⑤ `state` 缺失/未知 ⇒ `decayed[]`；⑥ 把生产的 `condition.cmd` 用正则断言为**不含** `task-granularity-advice\.test\.mjs`（原 `:699` 的断言反转）。判据可假：删掉任一负控制仍全绿 ⇒ 控制没生效。
- [ ] AC5（真实载体读数翻正）用修好的检测器读主检出的 `.quay/fan-in-step-trace.jsonl`：`suite-rerun-green` 从 `decayed[]` 消失、出现在 `adjudicated[]` 且 `state==="explained-absent"`、`condition.exitCode === 0`，而 `count`/`lastWrite` 仍是 `79` / `2026-10-21T16:36:58.159Z`（已裁定 ≠ 从读数消失）。贴出 JSON 片段。
- [ ] AC6（不回归）`bash scripts/test.sh --for-task gap-instrument-decay-suite-rerun-green-file-pin-expired --allow-thin` 退出码 0；贴出 scoped static checks 与命中文件的 tests/pass/fail。

## DoD

- [ ] AC1–AC6 全绿；`conditionCmd` 文本不含任何具体文件名字面量，且未知/缺失状态仍 fail-closed（不把「读不懂」伪装成「已解释」）。
- [ ] 真实落地判据（DIR-026 Reading A）：生产载体 `.quay/fan-in-step-trace.jsonl` 上的检测器读数——不是 fixture——把 `suite-rerun-green` 从 `decayed[]` 移入 `adjudicated[]` 的 `explained-absent`，且该读数由 shipped 检测器产生；`reviewAfter` 仍为 `2026-11-22T00:00:00.000Z`（无永久豁免）。
- [ ] 本条只改裁定口径，⛔ 不改写手、不修改 `plugin/test/full-suite-runner-cgroup.test.mjs`；那条持久红是独立机制，另行处理。

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- tasks/gap-instrument-decay-suite-rerun-green-file-pin-expired.md

## Evidence

立案时读数（2026-10-26，HEAD `15060e75c`，主检出 `/data/home/yale/work/quay`）。

1. 检测器（修前）：
```json
{"ok":false,"evaluated":true,"decayedCount":1,"adjudicatedCount":6,
 "decayed":[{"group":"suite-rerun-green","kind":"rate-stopped","count":79,
   "lastWrite":"2026-10-21T16:36:58.159Z",
   "detail":"condition command did not hold (exit 1) — the declared cause is gone; the absence is unexplained"}]}
```
载体仍在写：`totalRecords=20644`、`freshest=2026-10-26T05:17:07.667Z`；伴生 `rerun=316`（末次 `2026-10-26T05:14:48.589Z`）、`ff=1592`。

2. 被声明成因已消失：`node --test plugin/test/task-granularity-advice.test.mjs` ⇒ `tests 17 · pass 17 · fail 0`，EXIT=0。

3. 当前阻断者仍红：`node --test plugin/test/full-suite-runner-cgroup.test.mjs` ⇒ `tests 72 · pass 71 · fail 1`，EXIT=1；失败项 `AC3 — a REAL round's measured concurrency equals an independent overlap computation, and the diagnostic is below 16 GiB`（断言 `actualConcurrency < 128` 失败）。

4. 末次 green 之后的 rerun：
```
AFTER_GREEN_RERUNS=93  DIST={"rerun-red":87,"rerun-not-evaluated":6,"rerun-green":0}
NAMED_TASK_GRANULARITY_ADVICE=87  LAST_NAMED=2026-10-25T22:39:24.256Z
LAST_3 = 2026-10-26T04:38:30.197Z / 2026-10-26T04:49:26.419Z / 2026-10-26T05:14:48.589Z
         全部 rerun-red，files 只有 plugin/test/full-suite-runner-cgroup.test.mjs
```

5. 写手路径仍在：`plugin/scripts/worker-fan-in.ts:3184-3185` 的 `if (rerun.state === "rerun-green") traceSuiteEvent("suite-rerun-green", …)`。

6. 节奏（不是 rare-by-design）：全历史 79 条，末次 `2026-10-21T16:36:58.159Z`；当前距立案 ≈ 4.6 天。前案记录的中位间隔 0.71h、历史最大 20.56h ⇒ 触发未发生的时间远超自身节奏。

## ADR-007 dark axis

- L_D: 本任务只改一个描述符的条件字符串 + 对应测试，不新增 import 边或模块依赖 ⇒ 该轴无增量。
- L_G: 该轴仍暗,理由:同上，无可归因于本任务的 archguard 包级读数。