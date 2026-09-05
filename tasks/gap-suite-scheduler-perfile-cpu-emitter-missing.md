---
id: gap-suite-scheduler-perfile-cpu-emitter-missing
title: per-file CPU 采集在生产从未产出——统一调度器 suite-scheduler.ts 有独立的 __PERFILE__ 发射代码，未接
  cpu_ms
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

## Finding

`gap-perfile-cpu-cost-collection`（done, 2026-09-04 18:29:10Z）落地后，AC1-3 已勾（发射端/解析端/两个 record writer），AC4-7 标"（待外部）"待落地后生产轮验证。**现在生产轮已经有了，独立核验发现 AC4/AC5/AC7 全部为假**：落地后 4 个真实全绿轮次（round 1015/1016/1017/1018，2026-09-04 18:48Z ~ 19:50Z）里，`perFile[]` 记录**完全不含 `cpuMs` 字段**（不是 0，是字段本身缺席）——`.quay/verification-round.jsonl` 直接核验，逐条 `json.dumps` 打印过样本，字段集合只有 `{startedAtMs, file, endedAtMs, durationMs, passed}`。

**根因（已复现坐实，非猜测）**：`__PERFILE__` 这一行有**两处独立的发射代码**，`gap-perfile-cpu-cost-collection` 只改对了其中一处：

- `plugin/scripts/measure-suite-reporter.mjs:196` —— **已正确接上** `cpuPart`（读 `QUAY_PERFILE_CPU_DIR` 下的 `.cpu` 文件并追加 `cpu_ms=`）。legacy 分相路径（`QUAY_SUITE_SCHEDULER=0`）与 `suite-lpt-runner.mjs`（import `perFileReporter` 复用它）都经过这里，这也是为什么该任务的单元测试和"隔离跑单文件"的 AC1 验证会显示成功。
- `plugin/scripts/suite-scheduler.ts:343` —— **统一调度器（`QUAY_SUITE_SCHEDULER=1`，2026-08-31 起的默认路径，生产全部全量轮实际走的入口）自己内嵌一份独立的 `__PERFILE__` 发射代码**：`process.stderr.write(\`__PERFILE__ duration_ms=${dur} ${rec.file} passed=${passed} end_ms=${st.endMs}\n\`)`，**从未被改动，不追加 `cpu_ms`**。

**复现（今天直接跑的，非理论推导）**：
```
QUAY_PERFILE_CPU_DIR=/tmp/quay-cpu-diag NODE_OPTIONS="--require=<repo>/plugin/scripts/per-file-cpu-report.mjs" \
  node --experimental-strip-types plugin/scripts/suite-scheduler.ts --root <repo> --main-root <repo> \
  --serial-concurrency 1 --lowconc-concurrency 1 --main-concurrency 1 --groups engine \
  <<< "<repo>/plugin/test/measure-suite.test.mjs"
```
结果：**seam 本身正常工作**——`/tmp/quay-cpu-diag/ad63f3579b80e81d.cpu` 确实被写出（用 `sha256(path.resolve(文件))[:16]` 核对过 key 精确匹配），说明子进程自报路线（route a）本身没问题；但该文件的 `__PERFILE__` 输出行只有 `duration_ms=9799 ... passed=true end_ms=...`，**没有 `cpu_ms=`**——因为这行是 `suite-scheduler.ts:343` 自己写的，压根没去读那个 `.cpu` 文件。

**为什么会漏**：这是"两个 writer 只改一边"这条纪律本身漏看的一个变体——`gap-perfile-cpu-cost-collection` 的 Touches 只列了两个**round-record writer**（`full-suite-runner.ts` / `pre-verified-round-record.ts`），漏看了 `__PERFILE__` 这个**上游发射点**本身也有两份独立实现，而 `suite-scheduler.ts` 不在原任务 Touches 里，AC1 的验证手法（"grep 源码 + 跑一次单文件"）大概率只验证了 `measure-suite-reporter.mjs` 那一份或走的是隔离单测，没有端到端跑一次生产默认入口（`QUAY_SUITE_SCHEDULER=1`）的真实输出行。

**代价**：一个"done"的任务，全部机械门（typecheck/scoped-gate/suite/ac-gate/ff）都绿，AC1-3 也确实是真的，但生产从落地到现在 4 轮、0 条非零 `cpuMs` 记录——功能在生产环境结构性地从未产出过。这与本仓库硬规则 4 推论三记录的模式同源："实现了、测试绿了，但生产没跑过就被标完成"；本例更精确一层——不是"还没来得及跑"，是"接线目标本身是条死路"。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：`suite-scheduler.ts:343` 附近的 `__PERFILE__` 发射代码改为调用 `measure-suite-reporter.mjs` 导出的 `readPerFileCpuMs`（或等价复用，不得重复实现一份新的读取逻辑）并追加 `cpu_ms=`；grep 源码确认两处发射点现在共用同一个读取函数；（⛔ 两处仍各自独立实现 ⇒ 假）。
- [ ] AC2（能取假，端到端复现，非单测）：用本任务 Finding 里的复现命令（显式设 `QUAY_PERFILE_CPU_DIR`+`NODE_OPTIONS` 直调 `suite-scheduler.ts`）重跑，输出的 `__PERFILE__` 行含 `cpu_ms=<非零数字>`；（⛔ 复现命令跑出来仍无该字段 ⇒ 假）。
- [ ] AC3（能取假，生产载体，硬规则 4 推论三——本任务存在的理由）：修复落地**之后**的真实全量轮里，`perFile[]` 带非零 `cpuMs` 的记录数 ≥ 100（沿用 `gap-perfile-cpu-cost-collection` AC4 的门槛，但这次直接查 `.quay/verification-round.jsonl` 的落地后轮次，不写"待外部"就收尾）；（⛔ 仍是 0 条 ⇒ 假）。
- [ ] AC4（能取假，回归）：`gap-perfile-cpu-cost-collection` 原有的三条单测（`measure-suite-reporter.test.mjs` / `measure-trend-check.test.mjs` / `full-suite-runner.test.mjs` + `pre-verified-round-record.test.mjs`）+ `suite-scheduler.test.mjs` 全绿；新增至少一条断言覆盖"统一调度器路径下的 `__PERFILE__` 行含 `cpu_ms`"（防止这个断点再次只被 legacy 路径的单测掩盖）。
- [ ] AC5（能取假，回归，全量）：全量 `scripts/test.sh` 跑通，0 failed、0 cancelled。

## Definition of Done

`suite-scheduler.ts` 的 `__PERFILE__` 发射代码不再是独立实现，改为复用 `measure-suite-reporter.mjs` 的读取逻辑并带上 `cpu_ms`；AC1-5 全部勾选且勾选状态与本 DoD 一致；至少一轮**修复落地之后**的真实全量套件在 `.quay/verification-round.jsonl` 里留下 ≥100 条非零 `cpuMs` 记录（不留"待外部"字样收尾——本任务存在的目的就是把上一次的"待外部"兑现成真实读数）；新增回归断言防止统一调度器路径再次被漏检。

## Touches

- plugin/scripts/suite-scheduler.ts（`__PERFILE__` 发射代码改用共享读取逻辑）
- plugin/scripts/measure-suite-reporter.mjs（如需导出 `readPerFileCpuMs` 供 suite-scheduler.ts 复用，而非各自实现）
- plugin/test/suite-scheduler.test.mjs（新增：统一调度器路径下 `__PERFILE__` 含 `cpu_ms` 的断言）
- plugin/test/measure-suite-reporter.test.mjs（若导出面变化，同步断言）
- tasks/gap-perfile-cpu-cost-collection.md（追加落地后核验记录：AC4/5/7 实测为假、根因、指向本任务）
- tasks/gap-suite-scheduler-perfile-cpu-emitter-missing.md（自身）
