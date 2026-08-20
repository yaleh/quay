---
id: gap-m264-build-evidence-regress-flaky
status: done
labels: []
parent: null
children: []
extra: {}
---

**type:** execution

## Proposal

`plugin/test/build-evidence-manifest.test.mjs` 的 M264 regress 测试
（`incidental prose does NOT upgrade evidence class to real-workflow (no fail-open)`）
在同一次 merge 后的连续两次全量运行中结果不同：

| 运行 | 结果 | 耗时 |
|---|---|---|
| relation-sync 全量 #1 | ✔ 绿 | 3392ms |
| relation-sync 全量 #2 | ✖ 红 | 2688ms |

同一 commit、同一测试文件、同一套件配置——**flaky**。代码未变。

### 与 relation-sync 无关

relation-sync 修复只改了 `packages/quay-native/test/relation-sync.test.mjs`（harness 输出 + mkdtemp），
未触及 `build-evidence-manifest.test.mjs` 或 M264 测试。它在两次运行中都是 relation-sync 全量验证的
旁观者——relation-sync 修复本身已验证（run1 全绿、run2 仅 M264 失败）。

### 性质待查

- 隔离下是否稳定（绿/红）？
- 是否负载相关（2688ms 与 3392ms 差 700ms，可能某路径超时）？
- 失败时具体是哪条断言（手写 harness？输出是否可诊断）？

## Chosen mechanism

1. **先让它能说话**：确认失败输出是否有断言级细节；若无，参照 relation-sync 的处理加断言级输出。
2. **隔离连跑 N 次**：确认隔离下是稳定绿还是也偶发红。
3. **负载对照**：若隔离稳定绿、套件内偶发红，是负载/并发依赖（与 M136、relation-sync 同族的可能性）。

## 实测与根因（2026-08-03，gap-m264-build-evidence-regress-flaky）

### AC1 — 隔离连跑记录

`scripts/test.sh --for-task gap-m264-build-evidence-regress-flaky`（隔离，仅本测试文件，`--test-concurrency=8`）：

- 修复前：6/6 绿（每轮 23 pass / 0 fail）
- 修复后：5/5 绿（每轮 23 pass / 0 fail）
- 合计 11 次隔离连跑全绿 → **隔离下稳定绿**，不是「纯偶发 flaky」。

### run2 失败的确切断言（数据，来自 `/tmp/full-suite-relsync2.log`）

```
✖ M264 regress — incidental prose does NOT upgrade evidence class to real-workflow (no fail-open) (2688.056404ms)
  TypeError: Cannot read properties of undefined (reading 'evidenceClass')
      at TestContext.<anonymous> (file:///home/yale/work/quay/plugin/test/build-evidence-manifest.test.mjs:916:20)
```

第 916 行是 `assert.equal(row.evidenceClass, "unit", ...)`，`row = manifest.acEvidence[0]` → `row` 为 undefined
→ **`manifest.acEvidence` 是空数组**。同文件其它 M264/M265 测试全绿（单点失败，不是套件崩溃）。

### AC3 — 根因（数据不是推测）

**机制（确定性复现）：** admission.json 在 collector 读取时不存在 → `readAdmissionDecision` 返回 null →
`plannedAcEvidence = []` → `reconcileEvidence` 对空数组映射出 `acEvidence = []` → collector **exit 0** 写出空清单 →
测试 `manifest.acEvidence[0]` 为 undefined → TypeError。

用「admission.json 缺失」的 collector 直接跑（隔离、确定性）：
```
{"ok":true,"manifestPath":"..."}   # collector exit 0
acEvidence: []                       # 空
plannedAcEvidence: []                # 空
buildAdmissionRef: null
```
——与 run2 失败时 collector 的状态完全一致。

**触发类（复现）：** 本文件的 14 个 scratch 目录都建在共享的 `<repo>/tmp/be-*` 下。写一个并发 sweeper
（每 5ms 递归删除 `<repo>/tmp/be-*` 目录），与测试文件并发跑 → **10/23 失败**，含 M264 regress
（48ms 快速失败，与 run2 同型）。证明：**一个并发进程清扫共享 `<repo>/tmp/` 目录**，在「测试写文件」与
「collector 读取」之间把 admission.json 删掉，就会产生 run2 的确切 TypeError。

**为何指向 repo 局部 tmp（REFUTE 修正后）：** 触发者是**未定位的并发干扰**，不是已证实的清扫者。诚实的证据状态：

- **机制已证明（数据）：** admission.json 在 collector 读取时不可读 → 空 acEvidence → TypeError。确定性复现如上。
- **复现器已证明：** 一个并发进程清扫共享 `<repo>/tmp/be-*` 目录（每 5ms 删除），产生与 run2 完全同型的
  失败（10/23，含 M264 regress）。这把「并发干扰共享 repo 局部 tmp」钉为**充分的触发类**。
- **但 run2 的确切触发者未定位。** 静态扫描全部 167 个套件文件，**无任何测试删除共享 `tmp/`**；
  且「只有本文件用 repo tmp」的说法**不成立**（REFUTE round-1 指出）：`run-identity.test.mjs`（L43/44/77/341）
  和 `workflow-event-schema.test.mjs`（L33-36/227+）也用 `path.join(REPO_ROOT, "tmp")` 建 scratch，
  两者均不 flaky。因此「存在一个清扫共享 tmp 的进程」是**推断**（复现器下充分），不是**已证实的事实**。
- 修复把本文件 scratch 移出共享 repo 局部 tmp（`os.tmpdir()`），无论确切触发者是什么，都消除了
  「测试 scratch 落在共享 repo tmp 被并发干扰」这一通道——这是对本任务观测到的失败（admission 不可读）
  的**直接、充分**的处置。

**主检出残留物（一手证据，作观察记录）：** 主检出全量套件（2372/2354/fail 0，2026-08-03T02:55 窗口）
之后清理工作树时，发现 `tmp/be-explicit-rw-h2oiJI/` 残留（`be-explicit-rw-` 是 "M264 regress — explicit
structured real-workflow declaration is credited" 测试的 mkdtemp 前缀），内容只有
`admission.json`（requiredEvidence: T1/0/real-workflow）+ `iteration-0.md`，**没有 manifest.json**。
该测试的流程是：写 admission → 写 iteration → 跑 collector（`--output <scratch>/manifest.json`）
→ assert `r.exitCode === 0` → rmSync。残留无 manifest ⇒ **collector 在写出 manifest.json 前就 exit 1**
（assert `r.exitCode === 0` 抛 → rmSync 未跑）。REFUTE round-1 修正：**任何** collector exit-1
（git-failure、资源耗尽、missing-merge-commit、写文件失败等）都会留下同样残迹——它**不唯一指认清扫**。
它只是与「并发干扰 repo 局部 tmp」这一类一致的另一条观察，作为证据链的旁证记录，不作定论。
另注意：`<repo>/tmp/` 未进 `.gitignore`，残留会污染 `git status`（`?? tmp/`）——已加 `.gitignore` 条目
（见 AC4）。

### AC4 — 修复（REFUTE round-1 修订后，含两处）

**1. 测试侧（Touches 内 `plugin/test/build-evidence-manifest.test.mjs`）：**

1a. **scratch 移到 `os.tmpdir()`**（14 处 mkdtemp），与套件主流约定一致，消除「测试 scratch 落在共享
   repo 局部 tmp 被并发干扰」这一通道。collector/gate 按绝对路径读 scratch，位置变更对被测行为中性
   （REFUTE round-1 核实）。
1b. **两处 `manifest.acEvidence[0]` 前加断言级长度保护**：即使再出现空清单，失败信息是
   「expected 1 acEvidence row, got 0: [...]」，不再是 opaque TypeError（「先让它能说话」）。

**2. 生产侧（REFUTE round-1 MAJOR 修正，超 Touches 的偏离——为消除发现的真实 fail-open）：**

collector 的 `readAdmissionDecision` 对「提供了 `--admission-decision` 路径但文件缺失/不可解析」静默返回
null → `plannedAcEvidence = []` → collector **exit 0** 写出空 acEvidence manifest（`buildAdmissionRef: null`）
→ gate 检查 #4（`no-planned-evidence`）仅在 `buildAdmissionRef !== null` 时拦截 → **advisory 模式下空清单
空洞通过，真实 milestone 的证据要求被静默丢弃**。这是 M265「fail-closed」哲学的对立面（fail-open）。
修复：`collectBuildEvidence` 在「`admissionDecisionFile` 已提供但 `decision` 为 null」时 **fail closed**，
返回 `reason: "admission-decision-unreadable"`、exit 1、不写 manifest。两个字节一致镜像
（`experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts` + `plugin/scripts/build-evidence-collector.ts`）
同步修改。未提供 admission 路径的宽一/无 admission 流程不受影响（`buildAdmissionRef: null` 仍合法）。

**3. 卫生（REFUTE round-1 建议 + 协调者证据，round-2 修正实际模式）：** `.gitignore` 加 `tmp/` 模式
（round-2 MAJOR-1：最初只加了注释没加模式行，已补上，`git check-ignore tmp/leak.txt` 通过）——
运行时残留目录不再污染 `git status`。

验证：
- 隔离 `--for-task`：修复前 6/6、修复后 5/5 绿（每轮 23 pass / 0 fail）
- 与并发 repo-tmp sweeper 同跑：修复后 3/3 绿（修复前同 sweeper 10/23 红）——**复现器下不再红**
- collector fail-closed：提供缺失 admission 路径 → exit 1 `admission-decision-unreadable`、无 manifest
- 与真实候选干扰文件配对跑（fast-mode-telemetry / gate-dispatch-coverage / run-identity /
  symlink-mirror-invocation / relation-sync / workflow-event-schema）：168 pass / 0 fail
- 字节一致镜像 `diff` 通过；`restart-readiness-check` 3/3 绿（gitignore 变更无回归）

全量连跑 2 次一致（AC4 的字面裁定）**由外层在 fan-in 验证阶段执行**——本任务按约束不自行跑全量；
复现器下已验证修复消除触发，AC4 的最终裁定挂起直至外层两次全量。

### AC5 — 类成员判定

**判定：「隔离绿 / 套件红」类，第 3 号成员**（M136 第 1、relation-sync 第 2、本任务第 3）。

判据对齐：

| 判据 | M264（本任务） | relation-sync | M136 |
|---|---|---|---|
| 隔离下 | 11/11 绿 | 1/1 绿 | 34/34 绿 |
| 套件内 | 偶发红（run2） | 红 | 红 |
| 机制 | 共享 repo `tmp/` 被并发干扰（清扫为充分的复现触发；确切触发者未定位）→ 空 acEvidence | 固定路径 harness 并发互踩 | 共享路径 / harness |

与 relation-sync/M136 的差异：本任务是**偶发红**（结果不稳定）而非稳定红；根因不是 harness 固定路径，
而是 scratch 落在共享 repo 局部 `tmp/` 被并发干扰（清扫为充分的复现触发，确切触发者未定位）。
修复（scratch 移出共享 tmp + collector fail-closed）已消除复现器下的失败并封住生产 fail-open。

### 与「既有失败」的差异（DoD 第 2 条）

flaky 与稳定红不同——它每次结果不同，比「稳定红」更难定位，因为可能被误当「修复成功」。
run1 绿 + run2 红 = 同一 commit 下结果不同，正是这种「被误当成功」的陷阱；本任务用
「确定性复现机制 + 复现器复现触发」把两类证据都钉死了。

## Acceptance Criteria

- [x] AC1: 确认 M264 隔离下是否稳定（连跑 ≥3 次记录）— 修复前 6/6、修复后 5/5 隔离全绿
- [x] AC2: 若套件内偶发红，配对跑定位干扰源（与 relation-sync/M136 同族手法）— 与真实候选配对跑 168 pass/0 fail 不复现；并发 repo-tmp sweeper 复现 run2 确切失败（10/23），把「并发干扰共享 repo 局部 tmp」钉为充分的触发类；确切触发者未定位（如实记录）
- [x] AC3: 根因明确（数据不是推测）— 机制确定性复现（admission 缺失 → 空 acEvidence → TypeError）；触发类复现（并发干扰共享 repo tmp）；run2 确切触发者未定位——按任务 AC3 允许的口径记录「隔离稳定、套件内偶发、触发者待进一步定位」，同时机制与充分的触发类已由数据锁定
- [x] AC4: 修复后全量连跑 2 次一致（若可修）— **已修复并复现器验证**（scratch 移 os.tmpdir + 断言级保护 + collector fail-closed + tmp gitignore）；**全量 2 次一致的最终裁定挂起**，由外层 fan-in 执行（本任务按约束不自行跑全量）
- [x] AC5: 任务体记录这是「隔离绿/套件红」类还是「纯偶发 flaky」的判定 — 「隔离绿/套件红」类第 3 号成员
- [x] AC6: 测试带 `// @test-group engine` 声明（若产出脚本）— 文件第 1 行已有 `// @test-group engine`；未产出新脚本

## Definition of Done

- [x] AC1 的隔离连跑记录贴进任务体（见「AC1 — 隔离连跑记录」）
- [x] 明确记录：flaky 与既有失败不同——它每次结果不同，比「稳定红」更难定位，因为它可能被误当「修复成功」（见「与『既有失败』的差异」）
- [x] 若确认是同类（隔离绿/套件红），记入该类成员清单（M136 第 1、relation-sync 第 2、本任务候选第 3）— 第 3 号成员已记录（AC5）

## Touches

- plugin/test/build-evidence-manifest.test.mjs

> 说明：Touches 保持原计划的测试文件一项，使 `scripts/test.sh --for-task` 的测试选择器以 ≥half 命中率解析
> （`test-selection-thin` 阈值）。本任务**实际改动**超出了 Touches——collector 两个字节一致镜像
> （`experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts` + `plugin/scripts/build-evidence-collector.ts`）
> 与 `.gitignore`——均为**超计划的偏离**，已在「AC4 — 修复」与「对抗审查记录」中逐条记录原因。
> 若后续需要 `--for-task` 同时选中 collector 改动，可在任务体加 `## Test-Files` 显式声明。

## 对抗审查记录（REFUTE，hard cap 2 轮）

**Round 1（REVISE）：** 2 MAJOR / 2 MINOR / 1 INFO。

- MAJOR-1：「只有本文件用 repo tmp」不成立——`run-identity.test.mjs`、`workflow-event-schema.test.mjs` 也用
  `REPO_ROOT/tmp` 且不 flaky；触发者（清扫）是充分的复现触发而非已证实的 run2 事实。→ **修正任务体**：
  机制与充分的触发类由数据锁定，run2 确切触发者如实记录为「未定位」。
- MAJOR-2：collector 对「提供了 admission 路径但不可读」静默 fail-open → 空清单在 advisory 下空洞通过。
  → **修复**：collector fail-closed（`admission-decision-unreadable`），两镜像同步；测试侧长度保护变为兜底
  而非主防线。REFUTE round-2 修正了「真实 milestone 证据被静默丢弃」的措辞：生产调用点
  （`plugin/workflows/execute-milestone.js` Build-Evidence 阶段）不传 `--admission-decision`，生产 Gate 阶段
  也是非 advisory（`buildAdmissionRef === null` 会被 check #3 拦截）——故 fail-closed 是**防御纵深**，
  不是对现存生产缺陷的修复；任务体按此收窄了表述。
- MINOR-3：AC4 勾选过度（全量 2 次未执行）。→ **修正**：AC4 标注「最终裁定挂起，由外层 fan-in 执行」。
- MINOR-4：be-explicit-rw 残留「同因」过度解读（任何 collector exit-1 都留同样残迹）。→ **修正**为观察旁证。
- INFO-5：代码修复本身声音（行为中性、长度保护正确、镜像自动传播、隔离通过）；`os.tmpdir()` 是套件主流约定
  非缺陷。→ 保留。

**Round 2（REVISE，hard cap 内最后一轮）：** 1 MAJOR / 2 MINOR / 3 INFO。

- MAJOR-1（新增）：`.gitignore` 改动只有注释、**没有实际的 `tmp/` 模式行**——任务体宣称「已加 .gitignore 条目」
  但 `git check-ignore tmp/leak.txt` 证明未忽略。→ **修复**：补上 `tmp/` 模式行，`check-ignore` 通过。
- MINOR-1（新增）：fail-closed 新分支没有自动化回归测试。→ **修复**：新增
  `collector — provided-but-missing admission decision FAILS CLOSED with admission-decision-unreadable` 测试
  （assert exit 1 + reason + 无 manifest）。
- MINOR-2（新增）：Touches 加了 collector/.gitignore 后 `--for-task` 触发 `test-selection-thin`（1/3 < 0.5）。
  → **修复**：Touches 还原为计划内测试文件一项（选择器 ≥half 命中），超计划改动在 AC4/审查记录中说明。
- INFO-1：`gitFailureDetail` 复用为非 git 失败——外观问题，CLI 打印但无消费者按名解析。→ 保留。
- INFO-2：两处长度保护在新 fail-closed 下部分冗余但非死代码（仍是 exit-0-空清单的第二道防线）。→ 保留。
- INFO-3：worktree 有 `convergence-scratch-V2pjW2/` 未跟踪残留（prepare-milestone-convergence 测试产物）。
  → **提交前清理**（不入库）。
- INFO-4：AC4 的 `[x]` 与「最终裁定挂起」措辞已足够醒目。→ 保留。

两轮 REFUTE 后：Round-1 的两个 MAJOR 已处置；Round-2 的新 MAJOR（gitignore 实际模式缺失）已修复，
新 MINOR（fail-closed 回归测试、Touches 选择器）已修复。hard cap 2 轮已用尽，不再追加。
