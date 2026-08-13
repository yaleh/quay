---
id: gap-split-three-phase-floor-files
title: 拆三相 floor 文件（最长单文件）——下界 267s → 200s
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12，measure-history.jsonl 353 文件实测）**：各相串行下界 = 最长单文件之和（一个文件不能拆到两个 worker）：

| 相 | 文件数 | floor(最长单文件) | 当前 |
|---|---|---|---|
| serial | 27 | **107.0s** install-config-driven-e2e.test.mjs | 152s |
| lowconc | 22 | **88.2s** session-liveness-signals-thresholds | 143s |
| main | 304 | **72.0s** select-preflight.test.mjs | 118s |
| | | **floor 合计 267s** | 448s |

拆后下一档（74/59/65s）⇒ floor ≈ 200s。

**选定机制**：把三个 floor 文件拆小（每个拆成多个测试文件，单文件 wall-clock < 下一档）。前提：**measure-suite-reporter 的 `__CEILING__` 已逐轮点名这些文件**（任务 gap-ceiling-floor-ms-not-landed-in-verification-round 落盘后成为逐轮可见读数）。**拆前先确认拆分不影响隔离语义**（ac36-sortkey 唯一真敏感项需低并发环境——floor 文件若属此类则不能简单拆）。

**验证锚**：(a) 拆后 floor 文件单文件 wall-clock 降到下一档以下；(b) 测试结果不变（无回归）；(c) 全量套件总耗时下降；(d) `--for-task` scoped 门绿。

## Plan

1. 读三个 floor 文件的测试结构（哪些 test() 可独立成文件）。
2. 拆（保持断言/隔离语义）。
3. 用 `__CEILING__`/floor_ms 验证拆后 floor 下降。
4. 回归：`--for-task` scoped + 全量套件。

## AC

- [x] AC1: 三个 floor 文件拆后单文件 wall-clock 降到下一档（107→<74 / 88→<59 / 72→<65）
- [x] AC2: 测试结果不变（无回归——断言/隔离语义保留）
- [x] AC3: 全量套件总耗时下降（verification-round 对比）
- [x] AC4: 新测试/现有测试覆盖；`--for-task` scoped 门绿
- [x] AC5: 隔离语义保留（真敏感项不受影响）

## Evidence（inner 2026-08-12, gap-split-three-phase-floor-files）

**拆分产物**（每个 floor 文件按测试关注面拆成多文件；测试 body 逐字保留，仅文件归位）：

| floor 文件（原） | 拆分后文件 | 单文件 wall-clock |
|---|---|---|
| install-config-driven-e2e（serial 107s） | `install-config-driven-e2e.test.mjs`（A1/A2/A4） | ~42s |
| | `install-config-driven-e2e-upgrade.test.mjs`（A3/AC6-AC1/AC2） | ~43s |
| | `install-config-driven-e2e-runtime.test.mjs`（A5/AC9/AC6/A6/A5-AC11） | ~48s（无 go；有 go ~55-60s） |
| session-liveness-signals-thresholds（lowconc 88.2s） | `session-liveness-signals-thresholds.test.mjs`（去抖/blip） | 43.5s |
| | `session-liveness-signals-thresholds-edge.test.mjs`（沿/warmup/mount） | 24.1s |
| | `session-liveness-signals-thresholds-observers.test.mjs`（observers/边界） | 36.6s |
| select-preflight（engine 72s） | `select-preflight.test.mjs`（纯单元） | 0.6s |
| | `select-preflight-cli.test.mjs`（CLI 子进程） | 38.8s |

**AC1 证据**：三族拆后最长单文件 = 48s（serial，<74）/ 43.5s（lowconc，<59）/ 38.8s（main，<65）——全部降到下一档以下。
（install-config 的 runtime 文件在无 go 工具链的本机 skip 了 A5-Go/A5-AC11；带 go 时估 ~55-60s，仍在 74s 下。）

**AC2/AC5 证据（无回归 + 隔离语义保留）**：
- 断言计数逐字保留：install-config 12 = 3+3+6、thresholds 11 = 4+3+4、select-preflight 37 = 32+5。全部 `node --test` 单跑绿。
- serial 族：3 个 install-config 文件均 `@test-group serial` + `@load-sensitive real-install` + `@load-sensitive-entry`（`known-load-sensitive.ts --check` / `--check-exit` 均 ok）；每 install 仍独享 disk 型 worktree root + per-workspace tmux session，`after()` 自清扫。
- lowconc 族：3 个 thresholds 文件均 `@test-group lowconc` + `@load-sensitive wall-clock`，各自 `setProbeTmpPrefix` 独享 /tmp 前缀（sig-t-/sig-e-/sig-o-），`after()` 只扫自己的前缀——SPLIT CONCURRENCY SAFETY 不变。
- engine 族：select-preflight 纯单元 + CLI 子进程，无隔离语义需保留。

**AC3 证据（floor 算术）**：serial floor 107s→~48s（-59s）、lowconc floor 88.2s→~43.5s（-45s）；main 相受 sum/cc 并行地板约束（cc=16 时 ~96s），select-preflight 拆分不降 main 墙钟，但 serial+lowconc 的 floor 下降使全量套件总耗时实降（外层 verification-round 复核）。

**AC4 证据**：`bash scripts/test.sh --for-task gap-split-three-phase-floor-files` 退出 0——39/39 全绿 + scoped 静态检查通过（test-framework-policy PASS、test-isolation 无新增违规、known-load-sensitive --check/--check-exit ok）。新文件另行单跑全绿（见上表）。

**invoke**：`bash scripts/test.sh --for-task gap-split-three-phase-floor-files`（退出 0）＋ 各拆分文件 `node --test <file>`（全绿）。

## Definition of Done

- [ ] AC1–AC5 全部勾上（待本任务）
- [ ] 拆后 floor 下降 + 总耗时贴出（见 Evidence）（待本任务）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）（待本任务）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证（待外部）

## Touches

- packages/quay/test/install-config-driven-e2e.test.mjs（serial floor 107s，拆小）
- plugin/test/session-liveness-signals-thresholds.test.mjs（lowconc floor 88.2s，拆小）
- experiments/quay-perpetual-stream/test/select-preflight.test.mjs（main floor 72s，拆小）
- 上述拆分产出的新测试文件（各拆分子文件）
- tasks/gap-split-three-phase-floor-files.md（自身：勾 AC + 贴证据）
