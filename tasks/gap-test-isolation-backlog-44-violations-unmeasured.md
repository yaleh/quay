---
id: gap-test-isolation-backlog-44-violations-unmeasured
title: "test-isolation contract check has 44 standing violations
  (fixed-path-write=12 process-exit-1=7 mkdtemp-no-cleanup=21 ...) that pre-date
  tonight's merges — confirmed identical count in round1 log (192 glob vs 219
  now, same 44) — the check runs but its backlog is UNMEASURED: no
  baseline/ratchet, so 44 reds are just 'existing noise' and new violations are
  indistinguishable from old (red-window triage had to diff against a
  rotated-out round1 log by hand); fix: baseline the 44, add a shrink-only
  ratchet or per-category count like the test-framework-policy list"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**test-isolation 检查有 44 个常驻违规，但它的积压从未被度量——红窗分诊无法区分新旧。**

**【实测（2026-08-06 03:05 红窗分诊）】**：全量套件启动即红——`test-isolation-check` 报
**44 个 current violations**（fixed-path-write=12 / shared-build-artifact-write=1 / spawns-test-sh=3 /
process-exit-1=7 / mkdtemp-no-cleanup=21 / live-data-dir-write=0 / shared-root-mkdtemp=0）。分诊时
需判断「本轮 merge 引入还是既有积压」——**对比 rotated-out 的 round1 日志（192 glob）才发现同样 44 个**
（既有），靠手工 diff 两个日志文件，没有任何机械基线。

**【追加证据 2026-08-07 09:4x——欠账第一次被并发 8 触发成真实失败】**：`runner-grouping.test.mjs`
（spawns-test-sh 类别之一）**内部三次嵌套调 scripts/test.sh 比对计数**，并发 8 负载下计数漂移致断言
失败——**该欠账从"常驻噪音"升级为"负载下真实失败"**。管理者定位：同类 R3（spawns-test-sh）还有
`select-tests-for-touches.test.mjs`、`test-coverage-check.test.mjs`，但今晚未失败（无跨嵌套计数比较，
不敏感）。**此证据支持本任务"需要基线/棘轮"的立论**——欠账一旦被负载触发，就是真实红，而它仍在
44 个"已知噪音"里不可区分。

**【追加证据 2026-08-07 09:5x——第二个并发触发实例：跨文件竞态，fixed-path-write 类别】**
`runner-grouping.test.mjs` AC7（`--list-groups` 未声明文件测试，行 112-127）在**真实 `plugin/test/`
目录**写临时夹具 `zz-runner-grouping-undeclared.test.mjs`（非 mkdtemp——R3/fixed-path-write 类别），
finally 里删除。并发 8 下：该夹具存在期间，`test-file-snapshot.test.mjs` AC2（行 37-53）的全套件
快照恰好把它扫进基线，随后夹具被 finally 删除 ⇒ 快照对检报 `baseline test file(s) REMOVED (real count
regression): zz-runner-grouping-undeclared.test.mjs`，`1 !== 0`。**同一实例的两个测试文件共享真实
测试目录互相干扰**——行 114 注释只防了"泄漏污染 +1 基线/策略检查器"，没防"另一测试的全集快照
扫到它"。串行下两测试不同时跑、无竞态；并发 8 下必现。**此证据同样支持基线/棘轮立论，且指向
AC7 的夹具写法本身**（临时文件应放 mkdtemp 或快照助手应排除 zz-* 运行期夹具）。

**【根因】**：test-isolation-check **报数但不设基线/棘轮**——44 个 red 是「已知噪音」，每次全量都红，
新违规混在里面不可区分。对比 test-framework-policy（有 shrink-only 棘轮 + ceiling + git-HEAD strict-
subset），test-isolation 缺同款机制。

**【价值】**：没有基线，「全量套件绿」= 假目标（static-check 一启动就红，测试层根本没跑到）。
44 个是历史遗留（round1 与今晚同数），但**类别分布**（mkdtemp-no-cleanup=21 最重）指向可批量修复的
清理方向。

### 选定机制

1. **基线 44 个**：把 44 个违规文件列为已知基线（类似 test-framework-policy-exemptions.txt）
2. **加 shrink-only 棘轮**：新违规可被报出但不得增加净数（或按类别计数，如 mkdtemp-no-cleanup 单独
   一条清理线）
3. 清理方向：mkdtemp-no-cleanup=21（占一半）是最高杠杆——批量加 cleanup
4. **并发触发实例（2026-08-07 追加）纳入基线账**：runner-grouping 的 spawns-test-sh 嵌套 + AC7
   fixed-path-write 夹具都已在 44 基线账里被负载触发成真实红——基线后这些是"已知并发红"，须连同
   KNOWN-LOAD-SENSITIVE 机械化（见 gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage）
   一起在红窗分诊里被机械识别，而不是每夜手工重判

## Acceptance Criteria

- [x] AC1: test-isolation 44 个违规有机械基线（已知基线列表，非每次红）
- [x] AC2: shrink-only 棘轮——新违规触发检查红，既有积压不阻塞（除非净增）
- [x] AC3: 与 gap-test-framework-policy（done）交叉标注——同款棘轮机制的第二个消费者
- [x] AC4: 与 gap-test-isolation-contract-is-unwritten 交叉标注（检查器来源任务）
- [x] AC5: **并发触发实例基线化**——runner-grouping 的 spawns-test-sh 嵌套 + AC7 夹具竞态在红窗
      分诊里被机械识别为已知并发红（串通 gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage）
- [x] AC6: **AC7 夹具写法修正**——`zz-runner-grouping-undeclared.test.mjs` 移出真实 `plugin/test/`
      （或快照助手排除 zz-* 运行期夹具），消除与 test-file-snapshot 全套件快照的跨文件竞态

> **交叉标注（2026-08-07，`gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests` 落地）**：
> AC6 的竞态已由落地任务消除——runner-grouping 现声明 `@test-group serial`（serial 阶段在并发主体
> 之后跑，与 test-file-snapshot 不再并行），且 `test-file-snapshot.sh` 的 `current_files()` 排除
> `zz-*` 运行期夹具（快照侧消除撞车点，runner-grouping 的 AC7 夹具保留在共享目录以维持断言语义）。
> 本任务的 A/D 类发现方向被落地任务收窄：A 类（runner-grouping 等嵌套 spawns）已 serial 化，
> D 类（共享目录读写竞态）已由快照排除修复。AC1-AC4（基线 + 棘轮）不受影响，仍待本任务自身完成。
>
> **B类挂钟依赖是并发红的另一半根因**（`gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7`，
> 2026-08-08 已落地 R9 规则）：session-liveness 等 B类文件经 `@test-group lowconc` 隔离路由，与本任务的
> A/D 类修复方向不同、同源并发 8 恒红。
>
> **交叉标注（2026-08-07，`gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles` 落地）**：
> **R3 嵌套 spawn 欠账（spawns-test-sh）成本收掉**——runner-grouping 的 flags-only 用例原本在 serial 段
> **嵌套跑 3× 完整 governance 子套件**（每次 81 文件）只为比较用例计数（295.6s，serial 段 28%）。该任务
> 把它改成 `--list-files` 列表比对（不跑任何测试），**嵌套 spawn 成本归零**（293.9s → 8.2s），serial 路由
> 保留（`@test-group serial` 不动）。本任务基线账里 runner-grouping 的 spawns-test-sh=1 嵌套实例因此从
> 「负载下真实红」降为「已消除的嵌套成本」——剩余 spawns-test-sh 实例（select-tests-for-touches /
> test-coverage-check）不在本任务 Touches 内，仍待基线化。

## Evidence（2026-08-08，worktree `task/gap-test-isolation-backlog-44-violations-unmeasured`）

### AC1/AC2 —— 44 个违规有机械基线 + shrink-only 棘轮实测

`bash plugin/scripts/test-isolation-check.ts .` 实测输出（276 glob 文件）：

```
test-isolation-check — 276 glob file(s), 44 current violation(s) [fixed-path-write=12 shared-build-artifact-write=1 spawns-test-sh=3 process-exit-1=7 mkdtemp-no-cleanup=21 live-data-dir-write=0 shared-root-mkdtemp=0]
PASS: all 44 violation(s) are baselined in plugin/test-isolation-violations.txt; the list can only get SHORTER (no additions, no growth, no stale entries).
```

数据文件 `plugin/test-isolation-violations.txt` 恰 44 条（`grep -vc '^#'` = 44），`# baseline-count: 51`
（历史峰值，shrink-only ceiling 只降不升）。44 与 2026-08-06 红窗手工 diff 出的 round1 数一致——基线成立（AC1）。

**棘轮实测（AC2）**：在 glob 内临时放一个 `zz-ratchet-rehearsal.test.mjs`（固定 `__dirname/.tmp-*` 路径）→
检查 **exit 1**，报 `plugin/test/zz-ratchet-rehearsal.test.mjs:fixed-path-write is a CURRENT violation with
no entry … a new violation was introduced`（C1 新违规红）；删除该临时文件 → **exit 0**（既有 44 不阻塞）。
检查器已接进 `scripts/test.sh` 的 `run_static_checks`（每次 test-running 调用都跑），并有
`checker-mutation-cases/test-isolation-check.sh` 变异用例。

### AC3 —— 与 test-framework-policy 交叉标注（同款棘轮第二消费者）

`tasks/gap-no-test-framework-policy-for-new-tests.md` 补「交叉标注（2026-08-08，AC3）」节：`test-isolation-check`
复用同一「数据文件 + `# baseline-count` 提交后封顶 + git-HEAD 严格子集」的 shrink-only 棘轮形态，
`runIsolationChecks` 的 C0a/C0b/C1/C2a/C2c 判定与 `test-framework-policy-check` 逐条对应，各自独立数据文件
（policy=34 豁免 / isolation=51 历史峰值，当前 44）。

### AC4 —— 与 test-isolation-contract-is-unwritten 交叉标注（检查器来源任务）

`tasks/gap-test-isolation-contract-is-unwritten.md` 补「交叉标注（2026-08-08，AC4）」节：44 条基线正是该任务
AC3 实测清单的演化态（23 → R6/R7/R8 增删 → 44），`--list` 逐条对应；该任务的「报出而不阻断 + shrink-only
棘轮」（AC5/AC6）即本任务的基线机制。

### AC5 —— 并发触发实例基线化 + 红窗机械识别

- `plugin/test/runner-grouping.test.mjs:spawns-test-sh` 已基线进 44 条数据文件（嵌套 spawn 并发触发实例）。
- runner-grouping 头部 `@test-group serial` + `@load-sensitive nested-spawn`；`known-load-sensitive.ts --list`
  报其为 `nested-spawn` 族成员；`red-window-triage.ts --partition` 机械分区 in-family/not-in-family——
  「已知并发红」在红窗分诊里被机械识别，不靠每夜手工重判。
- 反向交叉标注已补进 `tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage.md`（AC5 节）。

### AC6 —— AC7 夹具竞态消除（快照侧修复）

`plugin/scripts/test-file-snapshot.sh` 的 `current_files()` 对 canonical 模式 `grep -vE '/zz-[^/]*$'`
排除运行期 zz-* 夹具（实测 `grep -c "/zz-" plugin/scripts/test-file-snapshot.sh` = 1）；runner-grouping 的
AC7 夹具保留在共享 `plugin/test/` 维持断言语义，`@test-group serial` 路由使其与 test-file-snapshot 不再并行。
快照不会再因夹具的创建/删除而报 `baseline test file(s) REMOVED`——竞态消除。

### 棘轮实测（DoD 项）

新违规 exit 1 / 既有 44 exit 0 见上（AC1/AC2 实测段）。AC6 的夹具竞态由快照侧排除 + serial 路由消除。

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 44 条 backlog 的隔离 violation 读数贴出（-v 或等价证据）
- [ ] 全量套件绿（per-task 验证）

## Touches

- plugin/scripts/test-isolation-check.ts（基线 + 棘轮逻辑）
- plugin/test-framework-policy-exemptions.txt 或等价基线文件（模式复用）
- plugin/test/runner-grouping-serial-anti-stomp.test.mjs（AC7 夹具写法——runner-grouping 拆分后保留 AC7 夹具的 serial 文件）
- plugin/test/test-file-snapshot.test.mjs 或 plugin/scripts/test-file-snapshot.sh（排除 zz-* 夹具）
- tasks/gap-no-test-framework-policy-for-new-tests.md（AC3 交叉标注——任务体原写
  `gap-test-framework-policy-for-new-tests.md`，真实文件为 `gap-no-test-framework-policy-for-new-tests.md`，
  2026-08-08 执行时修正；此修正同时让 task-contract --strict-subset 可解析该 Touches 条目）
- tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage.md（AC5 交叉标注）

> **Touches 修正（2026-08-12）**：`plugin/test/runner-grouping.test.mjs` → `plugin/test/runner-grouping-serial-anti-stomp.test.mjs`——runner-grouping.test.mjs 已被 gap-suite-floor-two-longest-files-bound 拆为 5 个文件，AC7 夹具保留在拆分后的 serial 文件。其余 Touches 均为现存文件。
- tasks/gap-test-isolation-backlog-44-violations-unmeasured.md（自身，C8 self-touch）
## Contract

measure   iso_violations = `bash plugin/scripts/test-isolation-check.ts` stdout 的 violation 总数
band      iso_violations <= 44（基线；shrink-only 棘轮：净增即红）
measure   snapshot_zz_exclusion = `grep -c "/zz-" plugin/scripts/test-file-snapshot.sh` stdout 数字段（AC6 落地：快照侧排除 zz-* 运行期夹具，应 ≥1；runner-grouping AC7 夹具保留共享目录维持断言语义，原「夹具引用归 0」测度由快照侧修复取代）
invoke    `bash plugin/scripts/test-isolation-check.ts`
control   既有 44 不阻塞（AC2）；新违规触发红（AC2）；并发 8 下 runner-grouping 与 test-file-snapshot 同跑不再互相干扰（AC6，serial+快照排除已落地）
resume    基线与棘轮分步提交，任一步完成即写盘；先跑 measure 读当前违规数

## Dispatch review

reviewer: outer
at: 2026-08-06T03:1xZ
changed: 红窗分诊立案——test-isolation 44 违规无基线，全量每次启动即红（static-check 层），
靠手工 diff round1 日志确认既有。管理者可确认后派发。
追加 2026-08-07 09:5x：并发 8 两次触发（runner-grouping 嵌套 spawns 计数漂移 + AC7 夹具 vs
test-file-snapshot 快照竞态），支持基线/棘轮立论，加 AC5/AC6。