---
id: gap-adr008-phase-declaration-staleness-reading
title: ADR-008 phase 声明自 2026-09-13 以来未变而无人可见——加一个只读的「距上次声明」读数（提交数 / 新 goal 数 /
  天数）进既有 quality-round Fact；不做自动切换（观察项）
status: ready
labels:
  - gap
  - observation
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**这是观察项，不是阻塞项**（硬规则 12：「phase 声明长期不更新」已发生的次数 = 1，就是当前这一次；单例不足以支撑任何强制机制）。本任务只把一个已有、但没人读的量变成可见读数。

**事实**（2026-10-22 实测）：
- `.quay/two-phase-state.json`（`plugin/scripts/phase-declare.ts` 的载体，受 git 跟踪，唯一一次提交 f57807f5c）只有一条声明：`phase: convergence`，`declaredAt: 2026-09-13T20:35:47.187Z`，`history` 长度 1。
- 此后：`git rev-list --count --since=2026-09-13T20:35:47Z HEAD` ⇒ **10,339** 个提交（develop 10,338）；新 goal：`git log --since=2026-09-13T20:35:47Z --diff-filter=A --name-only --format= -- goals/` 去重后为 **30 个**——GOAL-018…GOAL-037（20 个）+ GOAL-901…GOAL-910（10 个，其中 901–905 是标题自述的演练 drill）。所以「只多了 GOAL-906..910」的粗读低估了；首个新增是 GOAL-018（2026-09-14T04:01Z）。
- 期间没有任何 phase 变更。`phase-declare.ts` 的设计**有意**不做自动切换（gap-adr008-phase-state-mechanization-minimal AC3：唯一写入口是人显式带 `--reason` 的调用）——这一点本任务不改。
- **没有任何读者**：`grep -n "two-phase-state\|phase-declare" plugin/scripts/*.ts`（排除 `phase-declare.ts` 自身）⇒ 0 个代码读者。声明是否已经过期，只能靠人记得去打开这个文件。

**承载处**：`design-evolution-readings` 例程（`plugin/scripts/design-evolution-readings.ts`，经 `plugin/scripts/quality-gate-driver.ts` 调度，`.quay/config.yml` `loop.design_evolution_readings.enabled: true`）已经是只读 git 读数，并在生产上写 quality-round Fact（`.quay/quality-round.jsonl` 最近两次 2026-10-21T23:14Z、2026-10-22T00:40Z）。把 phase 新旧读数放进它的 Fact，不新开例程或载体。

## Plan

1. **计算放在载体的主人那里**：在 `phase-declare.ts` 中导出纯函数 `readPhaseStaleness(root)`，返回 `{evaluated, reason, phase, declaredAt, declarations, commitsSince, newGoalsSince:[ids], daysSince}`。`commitsSince` 用 `git rev-list --count --since=<declaredAt> HEAD`；`newGoalsSince` 用 `goals/` 下 `--diff-filter=A` 的新增文件去重得到 GOAL id。载体缺失、不可解析或 git 读失败 ⇒ `evaluated:false` + reason，⛔ 不返回 0（硬规则 3b）。
2. **CLI 只读面**：`phase-declare.ts --staleness [--json]` 打印上述读数，不写任何文件。
3. **接入既有 Fact**：`design-evolution-readings` 例程的 Fact value 增加 `phaseStaleness` 字段（原样嵌入 `readPhaseStaleness` 的返回）。它是附加信息，⛔ 不改变该 Fact 现有 state 的判定，⛔ 不触发立案。
4. **明确排除**：不做自动切换、不设阈值、不把读数接进任何门或派发计算；ADR-008 文本不改。

## Acceptance Criteria

- [x] AC1 读真实载体：在主检出运行 `node --experimental-strip-types plugin/scripts/phase-declare.ts --staleness --json`，输出 `evaluated:true`、`phase:"convergence"`、`declaredAt:"2026-09-13T20:35:47.187Z"`、`declarations:1`，`commitsSince` 等于同一时刻 `git rev-list --count --since=2026-09-13T20:35:47Z HEAD` 的值，`newGoalsSince` 含 GOAL-018 与 GOAL-910（贴出两条命令的输出）。
- [x] AC2 只读：AC1 运行前后 `md5sum .quay/two-phase-state.json` 一致，`git status --porcelain .quay/two-phase-state.json` 为空（贴出前后读数）。
- [x] AC3 未评估不伪装成「新鲜」（负对照）：在临时工作区中，载体缺失 ⇒ `evaluated:false` 且 `commitsSince` 为 `null`（不是 0）；载体为非法 JSON ⇒ 同样 `evaluated:false`，reason 与「缺失」可区分（贴出两次输出）。
- [x] AC4 进入既有 Fact（生产载体）：在主检出由 `plugin/scripts/quality-gate-driver.ts --root /data/home/yale/work/quay --once` 跑一轮且该例程 due（未 due 时贴出 `.quay/routine-last-run.json` 中该键的读数，等下一个常驻轮次产出后再取），`.quay/quality-round.jsonl` 新增一条 round 记录，其中 `design-evolution-readings` Fact 的 `value.phaseStaleness.evaluated` 为 `true` 且 `commitsSince` 与 AC1 同量级（差值等于两次运行之间的新提交数）。贴出该 Fact 的 `phaseStaleness` 片段。
- [x] AC5 没有自动切换：`grep -nE "phase:\s*(opts\.to|\"expansion\"|\"convergence\")" plugin/scripts/phase-declare.ts` 的命中仍只在人显式声明的写入路径上，`readPhaseStaleness` 函数体内 0 处写文件调用（`writeFileSync`/`appendFileSync`/`renameSync`）——贴出 grep 输出与函数体行范围。

## Definition of Done

- [x] AC1–AC5 全绿，`scripts/test.sh` 相关泳道与 `--for-task` scoped 静态检查通过，合并进 develop。
- [x] 读数只出现在既有 Fact 中，没有新载体、新例程、新门、新阈值。
- [x] `phase-declare.ts` 的 capability-catalog 声明补充 `--staleness` 只读面。

## Signal readings

- L_D: docLines=0 codeLines=469 ratio=0.000（`git diff --numstat develop...HEAD`，本任务落地提交的全部改动；无 .md 变更 ⇒ 文档增量 0，是「没有文档改动」而非未测量）
- L_G archguard: cycles=0（该轴本任务未触发 archguard 复算；改动只在 plugin/scripts 与 plugin/test，未新增跨层 import——唯一的对既存 import 是 design-evolution-readings.ts → phase-declare.ts，方向与既有 kernel 依赖一致）

## Evidence

### AC1 — 真实载体读数（worktree 代码 + 主检出载体，只读）
```
$ node --experimental-strip-types plugin/scripts/phase-declare.ts --root /data/home/yale/work/quay --staleness --json
{ "evaluated": true, "reason": null, "phase": "convergence",
  "declaredAt": "2026-09-13T20:35:47.187Z", "declarations": 1,
  "commitsSince": 10385,
  "newGoalsSince": ["GOAL-018","GOAL-019",…,"GOAL-037","GOAL-901",…,"GOAL-910"],   // 30 个
  "daysSince": 38.23 }

$ git -C /data/home/yale/work/quay rev-list --count --since=2026-09-13T20:35:47Z HEAD
10385

$ git -C /data/home/yale/work/quay log --since=2026-09-13T20:35:47Z --diff-filter=A --name-only --format= -- goals/ | grep -oE 'goals/GOAL-[0-9]+' | sort -u | wc -l
30
```
`commitsSince` 与 git 自身读数相同；`newGoalsSince` 含 GOAL-018 与 GOAL-910，且计数与 finding 的 30 一致（goals/ 下同期新增的 127 个 `kind: criterion` AC-* 文件按文件名前缀排除——finding 的计数命令用的是同一谓词）。

### AC2 — 只读（前后 md5 与 git status 均一致）
```
before: d51582c67021664e8fdd286bf30d19a0  .quay/two-phase-state.json
        git status --porcelain .quay/two-phase-state.json → （空）
after : d51582c67021664e8fdd286bf30d19a0  .quay/two-phase-state.json
        git status --porcelain .quay/two-phase-state.json → （空）
```
单测里另有一层：fixture 中载体已提交，`git status --porcelain`（全树）跑 `--staleness --json` 前后均为空 ⇒ 不止载体一个文件没被碰，而是整个工作树零写入。

### AC3 — 负对照：缺失 / 非法 JSON 都是 evaluated:false + null（可区分）
```
$ node ... --root /tmp/ac3-phase-aYvz --staleness --json        # 载体缺失
{ "evaluated": false,
  "reason": "carrier-missing: .quay/two-phase-state.json does not exist under /tmp/ac3-phase-aYvz — there is no declaration to measure the distance from",
  "phase": null, "declaredAt": null, "declarations": null,
  "commitsSince": null, "newGoalsSince": null, "daysSince": null }          EXIT=3

$ node ... --root /tmp/ac3-phase-aYvz --staleness --json        # 载体为非法 JSON
{ "evaluated": false,
  "reason": "carrier-unparseable: .quay/two-phase-state.json is not valid JSON (Expected property name or '}' in JSON at position 2 (line 1 column 3)) — the declaration exists but could not be read",
  "phase": null, "declaredAt": null, "declarations": null,
  "commitsSince": null, "newGoalsSince": null, "daysSince": null }          EXIT=3
```
两种 reason 前缀不同（`carrier-missing:` / `carrier-unparseable:`），且还有第三个独立取值 `git-unavailable:`（载体可读但目录不是 git 仓库，单测覆盖）。`commitsSince` 全部为 `null`，⛔ 不是 0。

### AC4 — 进入既有 Fact（生产载体）
生产常驻轮的 design-evolution 例程下一次 due 在数小时后，故按 AC 允许的方式手动跑一轮：
```
$ node --experimental-strip-types plugin/scripts/quality-gate-driver.ts --root /data/home/yale/work/quay --once --json
→ round ts=2026-10-22T02:16:32.726Z run_id=qg-1792635138358 pid=1652000
  facts: [pool-quality-judge, judgment-consumer-check, architecture-review, packaging-hygiene,
          semantic-dedup-scan, freshness-refresh, architecture-analysis, arch-discovery,
          discovery-method, open-semantic-discovery, cross-project-dogfood,
          arch-coverage-report, arch-cycle-report, design-evolution-readings]   （全部 state=verified）

.quay/quality-round.jsonl 中该轮 design-evolution-readings Fact：
  "value": { "evaluated": true, "historyAppended": true,
    "phaseStaleness": { "evaluated": true, "reason": null, "phase": "convergence",
      "declaredAt": "2026-09-13T20:35:47.187Z", "declarations": 1,
      "commitsSince": 10386,
      "newGoalsSince": ["GOAL-018", …, "GOAL-910"],      // 30 个，与 AC1 相同
      "daysSince": 38.24 } }
```
`commitsSince` 10385 → 10386：两次运行之间主检出新增 1 个提交（`556483e49 routine(freshness-refresh): findings round freshness-refresh-1792635187620`，该轮 freshness 例程自己的落痕），差值恰等于新增提交数。Fact 的 `state` 仍是 `verified`——phaseStaleness 是附加信息，不参与 state 判定。

### AC5 — 没有自动切换
```
$ grep -nE 'phase:\s*(opts\.to|"expansion"|"convergence")' plugin/scripts/phase-declare.ts
562:    phase: opts.to as Phase,          ← 唯一命中：人显式 --to 的写入路径

readPhaseStaleness 函数体 = 文件行 324..412
$ sed -n '324,412p' plugin/scripts/phase-declare.ts | grep -cE 'writeFileSync|appendFileSync|renameSync|mkdirSync'
0
```
全文件仅有的写入调用仍在 `main()` 的声明路径（`fs.writeFileSync(p, …)`，写载体）。

### DoD — 测试与 scoped 门
```
$ node --test plugin/test/phase-declare.test.mjs            → 15 pass / 0 fail
$ node --test plugin/test/design-evolution-readings.test.mjs → 33 pass / 0 fail（1 skipped：真实 worker-outcome 载体缺失）
$ node --test plugin/test/quality-gate-driver.test.mjs       → 96 pass / 0 fail
$ bash scripts/test.sh --for-task gap-adr008-phase-declaration-staleness-reading --allow-thin
  → scoped static checks（change-relevant tier）全部通过；tests 145 / pass 145 / fail 0；EXIT=0
$ node --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts \
    --task gap-adr008-phase-declaration-staleness-reading --worktree <worktree> --merge-target develop
  → ANTI-DRIFT OK: 7 actual file(s), all within declared Touches (8 glob(s))
```

## Touches

- tasks/gap-adr008-phase-declaration-staleness-reading.md
- plugin/scripts/phase-declare.ts
- plugin/scripts/design-evolution-readings.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/phase-declare.test.mjs
- plugin/test/design-evolution-readings.test.mjs
- plugin/test/quality-gate-driver.test.mjs
