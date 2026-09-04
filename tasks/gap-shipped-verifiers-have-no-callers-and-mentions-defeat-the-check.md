---
id: gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check
title: "the dominant defect class tonight is SHIPPED-BUT-UNCALLED verifiers, and
  a naive grep cannot see it because catalog entries and own-tests count as
  mentions — census on quay: verify-delivery- surface.ts (which outer ruled
  TODAY at c65c411c to be the SINGLE SOURCE OF TRUTH for the delivery manifest)
  has ZERO executable callers, its only two non-self references being a
  description string in capability-catalog.sh:179 and its own
  plugin/test/verify-delivery-surface.test.mjs; periodic- push-backup.sh 0
  callers; measure-suite.mjs 0 callers; on archguard task-contract-check.ts is
  laid down and its done-task check at :151-154 is correct yet has no call site
  there (grep scripts/ and .quay/config.yml = 0), which is why TASK-60 could be
  marked done while its OWN declared Contract band (pool > 0) was falsified
  (measured pool = 0) and archguard idled 197 minutes; the shape is 'the
  verifier exists, is correct, is shipped, and nothing invokes it' — same family
  as the ADR-022-retired routine-scheduler callers and the 15-day-dead probes"
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**今晚的支配性缺陷类是「已交付但无人调用的检查器」，而且朴素 grep 看不见它——
因为能力目录条目和自带测试都算"提及"。**

### 实测普查（quay 侧，命令可复算）

| 检查器 | 可执行调用点 | 备注 |
|---|---|---|
| `plugin/scripts/verify-delivery-surface.ts` | **0** | 仅两处非自身引用：`capability-catalog.sh:179` 的**描述字符串**、以及**它自己的测试** |
| `plugin/scripts/periodic-push-backup.sh` | **0** | 已在 `gap-cross-machine-sync-...` 记录 |
| `plugin/scripts/measure-suite.mjs` | **0** | 已在 `gap-single-file-test-duration-trend-unwatched` 记录 |
| `plugin/scripts/task-contract-check.ts` | 4（quay 内已接线） | **archguard 上已铺设但 0 调用点** |
| `plugin/scripts/resource-gate.sh` | 4 | 正常 |

**最尖锐的一条**：`verify-delivery-surface.ts` 是外层**今天** (`c65c411c`) 刚裁定的
**交付物清单单一事实源**（用它取代 `quay-product-outline.md §6`）——
**这个刚被立为权威的文件，除了自己的测试之外没有任何东西执行它。**

### 跨项目实例（archguard，本轮实测）

`plugin/scripts/task-contract-check.ts` 在 archguard **文件已铺设**，其 `:151-154` 的
done-task 检查**逻辑是对的**，但在 archguard **没有任何调用点**
（`grep scripts/ .quay/config.yml` = 0 命中；只有 `docs/analysis/fast-mode-loop-tick.md:572`
把它当作"可以手跑的命令"提了一句）。后果是可测量的：

- `TASK-60` 的 `## Contract` **band 原文**：「搬入后 `pool > 0` 或 `dispatchable_disjoint >= cap`」
- **实测 `pool = 0`**（`./tasks` 54 条全 done，0 todo/0 ready/0 needs-human）
- `TASK-60` 的 frontmatter 是 **`status: done`**
- ⇒ **一条 band 被证伪的任务安静地 done 掉，池空 197 分钟**，直接打在主判据 AC12b 上。

### 为什么这一类能长期存活（这是本任务的核心）

**"有没有人调用它"这个问题被"提及"打败了。**
`capability-catalog.sh` 把 `verify-delivery-surface.ts` 列为一项能力、它自己还有一个通过的单元测试——
于是任何"grep 一下有没有人用"的检查都返回非零，**看起来是接线的**。
真正要问的是：**有没有 loop 文档 / gate / CI job / 脚本会去执行它。**

### 选定机制（方向，接法留执行时）

一条机械检查：对每个 `plugin/scripts/` 下的可执行检查器，判定它是否存在**执行型调用点**，
其中**明确不计入**：(a) 它自身文件；(b) 它自己的 `plugin/test/<同名>.test.mjs`；
(c) 纯描述字符串（如 `capability-catalog.sh` 的目录条目）。
输出零调用点清单；已知且有意为之的（如仅供人手跑的工具）走显式豁免名单 + 理由，
豁免名单按本仓既有惯例做成**只减不增的 ratchet**。

## Contract

```
measure uncalled_verifiers = `node --experimental-strip-types plugin/scripts/uncalled-verifier-check.ts --json` 输出的 uncalled 数组长度
band uncalled_verifiers = 0（豁免名单内的不计）
measure mentions_not_counted = `node --experimental-strip-types plugin/scripts/uncalled-verifier-check.ts --json` 输出的 mentions_excluded 布尔字段
band mentions_not_counted = 1
invariant 一个被裁定为"权威/单一事实源"的检查器，必须存在至少一个执行型调用点；能力目录条目和自带测试都不构成调用点
invoke `node --experimental-strip-types plugin/scripts/uncalled-verifier-check.ts --json`
control 给一个当前有调用点的检查器（如 resource-gate.sh）临时摘掉其唯一执行调用点，只留 capability-catalog 条目与自带测试 ⇒ 该检查必须把它报为 uncalled；若报绿，说明"提及"仍然在冒充调用点，本机制无效
resume 若中断，先跑 measure 读当前零调用点清单，不要假设上次已修完
```

## Acceptance Criteria

- [x] AC1: 检查存在且实跑——报出当前 `uncalled_verifiers` 清单，贴出输出；
      `verify-delivery-surface.ts`、`periodic-push-backup.sh`、`measure-suite.mjs` 必须在首次输出里
- [x] AC2: **负控制（承重条）**——按 `control` 摘掉 `resource-gate.sh` 的唯一执行调用点，
      只留目录条目 + 自带测试，检查**必须**把它报为 uncalled；报绿则本机制无效，
      不得以 AC1 通过为由结案
- [x] AC3: **权威文件优先收口**——`verify-delivery-surface.ts` 获得一个真实执行调用点
      （tick 步骤 / gate / CI 三选一），贴出该调用点与一次实跑输出；
      理由：它已被 `c65c411c` 裁定为交付物单一事实源，权威而不被执行是最高危的形态
- [x] AC4: **豁免名单是只减不增的 ratchet**——与本仓既有 ratchet（如
      `test-framework-policy-exemptions.txt`）同形，含 baseline-count 上限与 git 严格子集
- [x] AC5: **下游可用**——机制位于 `plugin/` 且在 `quay-init` 铺设集里；
      在 archguard 上实跑一次，报出它那边的零调用点清单（预期至少含 `task-contract-check.ts`）
- [x] AC6: 与以下任务交叉标注：`gap-cross-machine-sync-has-no-mechanism-only-manual-pushes`、
      `gap-single-file-test-duration-trend-unwatched`、
      `gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived`
      ——它们各自是本类的一个实例，本任务是类级机制

## Definition of Done

- [ ] AC1-AC6 的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录本类今晚的全部已知实例及其编号，作为该类的登记册

## Touches
- plugin/scripts/uncalled-verifier-check.ts（本任务新建；已在 integration fan-in a43d4a90 合并，develop 待批量吸收）
- plugin/scripts/capability-catalog.sh
- plugin/scripts/quay-init.sh
- scripts/test.sh
- tasks/gap-cross-machine-sync-has-no-mechanism-only-manual-pushes.md
- tasks/gap-single-file-test-duration-trend-unwatched.md
- tasks/gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived.md

## Dispatch review

reviewer: outer
at: 2026-08-06T14:1xZ
changed: 类级机制立案（shipped-but-uncalled verifiers）——verify-delivery-surface.ts 为单一事实源却零执行调用点；TASK-60 band 被证伪仍 done（archguard 池空 197 分钟）。修复 Contract 格式（measure 补命令、续行合并、加本段）。

> 交叉标注（2026-08-09，`gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe` AC10）：本类最严重实例——
> 不被调用的不是报告检查器，是**为防止整机崩溃而建的防护**（`tmux-isolated.sh` 除自身测试外零消费者，
> 8/9 tmux 测试文件绕过，4/8 缺隔离条件，2026-08-06 整机 tmux server 第五次死亡）。该任务把「调用点」机制化：
> 新增静态检查 `tmux-test-isolation-check.ts` 接进 `run_static_checks`，任何起真实 tmux 的测试文件必须
> 引用机制或双条件齐备，否则报红——「提及不构成调用点」的教训从报告类扩展到防护类。
