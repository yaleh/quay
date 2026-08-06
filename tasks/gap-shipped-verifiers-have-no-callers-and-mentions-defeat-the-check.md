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
status: ready
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

- [x] AC1: 检查存在且实跑——报出当前 `uncalled_verifiers` 清单。
      交付物 `plugin/scripts/uncalled-verifier-check.ts`（`--json` 输出含 `uncalled` 数组与
      `mentions_excluded` 布尔字段）。**首次输出**（接线前，见下方实跑）报 34 个 uncalled，
      其中 **`verify-delivery-surface.ts` ✓、`measure-suite.mjs` ✓** 都在清单里。
      **`periodic-push-backup.sh` 不在首次输出里**——因为交叉任务
      `gap-cross-machine-sync-has-no-mechanism-only-manual-pushes` 的 `sync-lag-check.sh:54/115`
      已给它真实执行调用点（`bash "${push_script}"`），机制正确把它判为已接线。这正是本机制的价值：
      census 快照之后该实例已被接线，机制如实反映当前状态。
      首次输出（`node --no-warnings --experimental-strip-types plugin/scripts/uncalled-verifier-check.ts --json --root <root>`，共 34 个）：
      ```
      total_verifiers: 129 | mentions_excluded: true (257 self/own-test/catalog mentions excluded)
      uncalled (34):
        anti-gaming-guard.sh axis-generator.ts build-evidence-collector.ts build-evidence-gate.ts
        build-evidence-manifest.ts capability-catalog.sh codex-stage1-live-proof-check.ts
        codex-stage1-selfcheck.sh dead-loop-check.sh drivable-workspace-check.sh gate-dispatch-coverage.ts
        inbox-reader.sh integration-batch-merge.sh it0-enforcement-with-design-check.sh
        loop-shipping-exclusion-data.mjs measure-suite-reporter.mjs measure-suite.mjs needs-human-recheck.ts
        prefriction-count.sh preparation-feedback.ts read-probe-spec.ts runtime-usage-inventory.ts
        session-liveness-mount.sh supervisor-health.sh test-file-baseline.ts test-file-snapshot.sh
        tmux-isolated.sh trend-check.ts uncalled-verifier-check.ts verify-delivery-surface.ts vmeta-lag-check.sh
        workflow-baseline-metrics.ts workflow-journal.ts workflow-replay.ts
      ```
      接线 + 豁免后的最终态：`uncalled_verifiers=0（豁免名单内的不计）`、`mentions_excluded=1`、
      `ratchet_failures=[]`、`ok: true`（见 AC3/AC4 实跑）。
- [x] AC2: **负控制（承重条）**——按 `control` 摘掉 `resource-gate.sh` 的真实调用点，
      只留 capability-catalog 条目 + 自带测试，检查**必须**把它报为 uncalled。实测 fixture 通过：
      ```
      $ ls /tmp/ac2-fixture/plugin/scripts/   # resource-gate.sh + capability-catalog.sh 仅此
      capability-catalog.sh  resource-gate.sh
      $ node --experimental-strip-types .../uncalled-verifier-check.ts --root /tmp/ac2-fixture --json
      uncalled: ['capability-catalog.sh', 'resource-gate.sh']
      resource-gate.sh reported uncalled: True
      mentions_excluded: True
      ```
      反之（真实仓库，resource-gate.sh 有 3 个真实调用点 test.sh:401 / full-suite-runner.ts:325 /
      cap-from-gate.ts:161）`resource-gate.sh` 不在 uncalled 清单里——"提及"没有冒充调用点。
- [x] AC3: **权威文件优先收口**——`verify-delivery-surface.ts` 获得真实执行调用点（gate，三选一），
      已接进 `scripts/test.sh` 的 `run_static_checks`（AC2 完整静态门禁实跑输出，6/6）：
      ```
      echo "== delivery-surface check (gap-complete-delivery-surface-spec-and-l1-verification) =="
      # @static-tier change
      # @static-object plugin/ .claude/ orchestration/
      checker_cost_wrap "verify-delivery-surface" -- node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/verify-delivery-surface.ts" --root "${repo_root}"
      ```
      实跑输出（`scripts/test.sh --static-checks`，gate 段）：
      ```
      == delivery-surface check (gap-complete-delivery-surface-spec-and-l1-verification) ==
      surface_categories_covered=6/6
      spec_is_live=1 (SPEC doc L1-MANIFEST matches the executable manifest)
        [1/6] mechanism-and-runtime: COVERED
        [2/6] loop-docs: COVERED | 归属: gap-productize-the-manager-layer
        [3/6] launch-config: COVERED | 归属: gap-crystallize-launch-config-into-checked-in-settings-file
        [4/6] session-topology: COVERED | 归属: gap-tmux-session-topology-no-factory-definition
        [5/6] periodic-anchor: COVERED | 归属: gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash
        [6/6] observation-and-verification: COVERED | 归属: gap-quality-criteria-are-point-in-time-no-trend-criteria
      PASS: all 6 delivery categories covered, spec_is_live satisfied
      ```
      接线后 uncalled-verifier-check 确认它已有调用点：`verify-delivery-surface callers: ['scripts/test.sh']`。
- [x] AC4: **豁免名单是只减不增的 ratchet**——`plugin/uncalled-verifier-exemptions.txt` 与
      `test-framework-policy-exemptions.txt` 同形：`# baseline-count: 32` 上限（commit-surviving，
      清单永不可超过该数）+ git-HEAD 严格子集（工作树新增条目不在已提交基线 ⇒ 失败）+ C2b/C2c/C2d
      （条目文件不存在 / 已获得调用点 / 不在 verifier 集 ⇒ 失败）。实跑（`--static-checks` gate 段）：
      ```
      == uncalled-verifier check (gap-shipped-verifiers-have-no-callers-and-mentions-defeat-the-check) ==
      uncalled-verifier-check — 129 verifiers under <root>
      mentions_excluded=1 (257 self/own-test/catalog mentions excluded from call-site counting)
      uncalled_verifiers=0 (un-exempted; band 0)
        (none)
      exempted=32
        anti-gaming-guard.sh axis-generator.ts build-evidence-collector.ts ... workflow-replay.ts
      PASS: every verifier has an execution call site or a listed exemption; ratchet intact
      ```
- [x] AC5: **下游可用**——机制位于 `plugin/scripts/uncalled-verifier-check.ts` 且在 quay-init 铺设集
      （`quay-init.sh` derive_loop_scripts 显式加列入 `uncalled-verifier-check.ts`，随 `--loop` 铺入目标）。
      在 **archguard** 上实跑（`--root /home/yale/work/archguard`）：
      ```
      archguard total_verifiers: 31
      uncalled (16):
        capability-catalog.sh full-suite-runner.ts inner-forensics.mjs inner-idle-log.ts inner-state.sh
        it0-split-or-commit-check.ts loop-driver-check.sh monitor-mount-check.sh pipe-exit-code-check.sh
        read-probe-spec.ts ready-pool-check.ts resource-gate.sh send-keys-reliable.sh
        session-liveness-mount.sh task-contract-check.ts task-schema-check.ts
      task-contract-check.ts in uncalled: True   # 预期实例 ✓
      mentions_excluded: True
      ```
      `task-contract-check.ts` 如预期出现在 archguard 的零调用点清单（铺设了但无人调用——TASK-60 那类）。
- [x] AC6: 与以下任务交叉标注（各任务体已加 Cross-reference 段）：
      `gap-cross-machine-sync-has-no-mechanism-only-manual-pushes`（periodic-push-backup.sh 实例，
      机制确认其已由 sync-lag-check.sh 接线）、
      `gap-single-file-test-duration-trend-unwatched`（measure-suite.mjs/reporter 实例，进豁免名单并指向本任务）、
      `gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived`
      （return 后不可达调用点变体，dead-code-after-return-check.ts 钉住该形状）。

## Definition of Done

- [x] AC1-AC6 的实跑输出都贴进任务体（见上）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**未达成**：完整测试套件的
      `plugin/test/quay-init-loop.test.mjs` AC4 两项（user-scope stale 版本一致性）是**既有的版本漂移失败**
      （fixture 硬编码 `0.3.13`，实际 `plugin/vendor/quay/package.json` 为 `0.4.0`），与本任务改动集无关
      （本任务未触碰 vendored 版本）。完整静态门禁 `scripts/test.sh --static-checks` **exit 0 全绿**；
      与本任务直接相关的测试文件实跑 81 tests / 79 pass / 2 fail / 0 cancelled，2 fail 即上述既有版本漂移。
- [x] 任务体记录本类今晚的全部已知实例及其编号，作为该类的登记册（本类登记册）：
      | 实例 | 状态 |
      |---|---|
      | `verify-delivery-surface.ts`（c65c411c 裁定的交付物单一事实源） | **本任务接线**进 `scripts/test.sh` gate（AC3） |
      | `periodic-push-backup.sh` | 已由 `gap-cross-machine-sync-has-no-mechanism-only-manual-pushes` 的 `sync-lag-check.sh` 接线；机制确认 |
      | `measure-suite.mjs` + `measure-suite-reporter.mjs` | 进豁免名单，指向 `gap-single-file-test-duration-trend-unwatched`（wire 后移除） |
      | `task-contract-check.ts`（archguard 侧铺设但 0 调用点，TASK-60 band 证伪仍 done） | 机制在 archguard 实跑报出（AC5） |
      | `default_concurrency_formula` return 后不可达调用点 | `gap-concurrency-derivation-reverted-...`；`dead-code-after-return-check.ts` 钉住形状 |
      | 其余 27 个已知有意为之的 uncalled（manual-only 报告工具 / retired-classic-loop 库 / exp5-legacy / test-only 数据模块） | 豁免名单 `plugin/uncalled-verifier-exemptions.txt`（baseline 32，只减不增） |

## Touches
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
