---
id: gap-ac121-suite-bucket-133-test-reattribution
title: AC121 230 个调 test.sh 测试逐条重归属（133 个误归 S 是真漏测风险——分桶执行的前提）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac120-suite-bucket-attribution-mechanism
---

**type:** execution

## Proposal

**来源**：`orchestration/manager-phase-goal.md` 当前阶段 AC121（⛔ 本阶段的前提——不做完不得启用分桶执行）。

**判据**：对基线里那 230 个调用 `scripts/test.sh` 的测试逐条给出 `S`（真测套件语义）或 `M`（只用 test.sh 当壳、本身测别的机件）的判定并落记录，**判定数 = 230**，可机械核对。

**取假**：判定完成后用同一谓词重扫，「调用 test.sh 且未被逐条判定」这一类**必须为 0**。

**为什么这是前提**：基线实测 230 个调 test.sh 的测试里，97 个真测套件语义（引用 `--list-files`/`--group`/lane/concurrency/`__GROUP__` 等），**133 个只是把 test.sh 当壳**（`concurrent-batch-scheduler` / `slot-refill-heartbeat` / `judgment-consumer-check` / `verify-delivery-surface` / `execution-policy` / `inner-idle-log` / `self-report-vocab-audit` …）。这 133 个若被误归 S 桶、在 M 变更时被跳过 = 真实漏测。⛔ 在它完成前启用分桶执行，等于给出一个会漏测的绿（同硬规则 4：结构上不可能取假的量不是测量）。

**为什么 inner 执行**：重归属是产品测试归类的数据工作 + 可能产生机件（扫描/记录脚本）→ inner 域。

## Plan

1. 对 230 个调 `scripts/test.sh` 的测试逐条判定 `S` 或 `M`（真测套件语义 vs 只当壳），判定落机械可核记录（如 `.quay/suite-bucket-reattribution.jsonl` 或等价载体）。
2. 用同一谓词重扫，确认「调用 test.sh 且未逐条判定」= 0。
3. 记录判定数 = 230，可复核。
4. fan-in land。

## Acceptance Criteria

- [ ] AC1: 230 个调 `scripts/test.sh` 的测试逐条给出 S|M 判定并落记录，判定数 = 230（机械可核）。
- [ ] AC2: 用同一谓词重扫，「调用 test.sh 且未被逐条判定」= 0。

## Definition of Done

- [ ] 230 个测试逐条重归属落记录且判定数=230、漏判=0；land 到 develop；AC1-2 全勾。

## Touches

- .quay/suite-bucket-reattribution.jsonl (new)
- tasks/gap-ac121-suite-bucket-133-test-reattribution.md（自身）
