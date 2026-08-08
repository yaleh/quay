---
id: gap-single-file-test-duration-trend-unwatched
title: "single-file test duration GROWTH is not tracked — measure-suite.mjs + measure-suite-reporter.mjs have precise per-file duration capture (__PERFILE__ <basename> <duration_ms> <passed>) but are one-shot manual tools: no history persistence, no trend comparison, not wired into any decision path (only capability-catalog lists them as tools; scripts/test.sh static layer has no duration check; CI has only coarse job-level timeout 10-15min that kills the whole job without naming the slow file); 'can measure but doesn't watch' — same class as writer-exists-nobody-calls / existence-not-effect recurring tonight; trigger: session-liveness.test.mjs 2016 lines slow (>30s wait, manager spent time diagnosing whether it hung); human-approved usage-perspective probe 2026-08-06, ruling requested on thresholds/storage/立案"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**单文件测试耗时增长无人跟踪——能测但不看（能力存在没接进决策路径）。**

**【查证（管理者使用视角提问 + 外层核实）】**：
- `measure-suite-reporter.mjs` + `measure-suite.mjs` **有精确单文件耗时测量能力**（`__PERFILE__ <basename>
  <duration_ms> <passed>`），但只被 `capability-catalog.sh` 列为一个工具，**不存历史、不做趋势对比、
  不触发检查**——一次性手动工具。
- `scripts/test.sh` 静态检查层**无 duration 相关检查**。
- CI 只有**粗粒度 job 级超时**（10-15min），超了杀整个 job，**不报哪个文件慢**。
- **触发实例**：session-liveness.test.mjs 2016 行（A/B 三天自然增长），>30s wait——管理者花时间诊断它是否挂起
  （其实只是慢）。

**【性质】「能测但不看」**——测量能力存在但没接进决策路径。与今晚反复撞到的同形
（writer exists but nobody calls / 存在≠生效 / measure 有但决策不读）。

### 选定机制（复用 measure-suite-reporter，不新造）

1. **落历史**：全量套件跑完，用 measure-suite-reporter 落一条 `{file, duration_ms}` 到历史记录
   （`.quay/measure-history.jsonl`，append-only）
2. **对比下次**：下次跑完对比上次，单文件耗时增长超噪声基线即报（报出文件 + 增幅）
3. **阈值**（外层裁定）：相对增长 >2× 或绝对 >+30s（视文件量级；session-liveness 这类大文件 >30s 是基线）

## Acceptance Criteria

- [ ] AC1: 全量套件后落 measure-history（每文件 {file, duration_ms}，append-only）
- [ ] AC2: 下次对比上次——单文件耗时增长超基线报出（文件 + 增幅）
- [ ] AC3: 复用 measure-suite-reporter（不新造测量器）
- [ ] AC4: 与 gap-suite-cost-model-is-wrong（done）交叉标注——同「成本数据」方向，本任务加趋势维度

## Definition of Done

- [ ] AC1-AC4 全勾（全量后落 measure-history 每文件 duration append-only；下次对比上次单文件增长超基线报出；复用 measure-suite-reporter 不新造；与 suite-cost-model-is-wrong 交叉标注——加趋势维度）
- [ ] measure-history 落盘 + 趋势报出实测
- [ ] scoped 门 `scripts/test.sh --for-task gap-single-file-test-duration-trend-unwatched` 绿

## Touches
- tasks/gap-single-file-test-duration-trend-unwatched.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/scripts/（history 落盘 + 对比脚本，复用 measure-suite-reporter）
- plugin/loop/orchestrator-loop-tick.md 或 full-suite-runner.ts（套件后接 measure-history）
- tasks/gap-suite-cost-model-is-wrong-optimizations-buy-nothing.md（AC4 交叉标注）

## Contract

measure   slow_file_reported = `node --experimental-strip-types <trend-check>.ts --history .quay/measure-history.jsonl --json 2>&1 | grep -c 'growth'` stdout 数字段
band      slow_file_reported >= 1（有耗时增长时明确报出）
invoke    `grep -rn 'measure-suite-reporter\|__PERFILE__' plugin/scripts/`
control   单文件耗时翻倍 ⇒ 报出（AC2）；无增长不误报
resume    历史落盘与对比分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T11:5xZ
changed: 管理者使用视角提问立案——单文件耗时增长无人跟踪（能测但不看）。触发：session-liveness 2016 行
>30s wait，管理者花时间诊断是否挂起。复用 measure-suite-reporter（不新造），落历史 + 趋势对比。
