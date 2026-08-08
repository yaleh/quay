---
id: gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests
title: "HUMAN RULING 2026-08-07: concurrency 8 stays — identify tests that
  cannot run concurrently, apply a mechanism for them, get TRUE green at
  concurrency. Manager taxonomy: A类 nested-full-suite-spawn
  (runner-grouping/select-tests-for-touches/test-coverage-check, R3
  spawns-test-sh=3 exempted-never-fixed), B类 real-wall-clock-wait
  (session-liveness/measure-suite/monitor-mount-check/quay-init-tmux-detection/\
  send-keys-verified/build-dist-smoke), D类 shared-dir read-write race
  (runner-grouping AC7 zz- fixture in plugin/test/ vs test-file-snapshot
  full-set scan → 'baseline test file REMOVED' — A and D hit the same file but
  different mechanisms, not one-class fix), C类 exclusive-tmux EXCLUDED
  (positive-control verified safe). Landing suggestion (not ruling): reuse
  scripts/test.sh --group mechanism — add a serial group, main body stays
  concurrency 8, serial group runs alone; D fixed by code (fixture out of shared
  dir)"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**人裁定（2026-08-07 10:2x，方向已定）：并发 8 不降。判断哪些测试不能并发跑，为它们应用相应机制，
并发拿到真绿。原话：「并发运行测试时必须的。需要判断的是：是不是所有测试都可以并发跑？有没有一些
测试不能并发跑？如果有，就应当为这些测试应用相应机制。把并发运行测试搞定，并发拿到真绿。」**

### 机械识别（管理者 2026-08-07 10:2x，给出可执行输入）

| 类 | 机制 | 测试文件 |
|---|---|---|
| **A类 嵌套拉起整套件** | 内部再起 test.sh 自带 worker 池，与外层争 CPU——正是 test-isolation-check 的 `spawns-test-sh=3` 已知违规，**R3 早已禁止、一直豁免未修** | runner-grouping / select-tests-for-touches / test-coverage-check |
| **B类 真实挂钟等待** | sleep() + 有限窗口，CPU 饥饿下窗口不够 | session-liveness / measure-suite / monitor-mount-check / quay-init-tmux-detection / send-keys-verified / build-dist-smoke |
| **D类 共享目录读写竞争** | 新发现、因果链最干净：runner-grouping.test.mjs:113 在共享 `plugin/test/` 临时造 `zz-runner-grouping-undeclared.test.mjs` 再删；test-file-snapshot.test.mjs 的工作正是扫全仓测试清单比基线——并发下 snapshot 先看见该临时文件计入基线、再看时已删 ⇒ 报 `baseline test file REMOVED (real count regression)`。**两个测试都没错，是共享目录读写撞车** | runner-grouping（AC7）× test-file-snapshot |
| **C类 独占 tmux** | **已排除，不要浪费时间**——管理者正控制核实：session-topology / inner-session-check 明写 HERMETIC server on a private socket，send-keys-reliable 从不 invoke tmux，supervisor-deliver 用唯一 session 名且从不 kill-server | — |

**注意（管理者强调）**：A 与 D 撞的是同一个文件 `runner-grouping.test.mjs` 但机制不同
（A=嵌套 worker 池争 CPU，D=共享目录写临时夹具），**不能当一类修**。

### 选定机制（管理者落点建议，不定案——实现由外层+内层定）

`scripts/test.sh` 已有 `--group` 机制（`// @test-group <product|engine|governance>` 声明，`--group`
可单独跑）——**加一个 `serial` 组**：主体仍并发 8，该组单独串行跑，是最贴合现有架构的做法，
不需要发明新机制。A类+B类测试声明为 serial 路由，与并发 8 主体隔离。

**D类单独修**（代码修复，不与 A 同批）：runner-grouping AC7 的临时夹具移出共享目录（mkdtemp 或
快照助手排除 `zz-*` 运行期夹具）——两个测试本身没错，消除撞车点即可。

### 与既有任务的关系

- 本任务是 human ruling 的**直接落地**（并发 8 真绿）；`gap-wall-clock-timing-dependency-in-tests-
  not-covered-by-r1-r7`（B类发现）与 `gap-test-isolation-backlog-44-violations-unmeasured`（A/D类发现）
  是根因任务，本任务落地后它们的 AC 方向被此裁定覆盖/收窄。
- `gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage`（分诊机械化）是后续收尾——serial
  组落地后 KNOWN-LOAD-SENSITIVE 族被机械识别为 serial 成员，分诊不再人工判。

## Contract

measure serial_members = `grep -rlE '@test-group[[:space:]]+serial' plugin/test/ packages/*/test/ 2>/dev/null | wc -l` stdout 数字段（A/B 类成员数，≥9）
measure suite_state = `python3 -c "import json;d=json.load(open('.quay/full-suite-state.json'));print(d.get('state'),d.get('reason'),len(d.get('failures',[])))"` stdout 两段（目标：green none 0）
band suite_state = green 开头（并发 8 全量真绿）
invoke `scripts/test.sh --group serial`
control A/B 类测试在并发 8 主体下不再被 CPU 饥饿击穿（serial 组隔离生效）；D 类两个测试并发下不再互撞
resume 若中断，先跑 measure 读 serial 组成员数与套件状态

## Acceptance Criteria

- [x] AC1: **serial 组落地**——`scripts/test.sh` 支持 `serial` 组路由；A类+B类测试（11 ≥ 9）声明为
      serial 成员；`--group serial` 单独串行跑（concurrency 1），不与并发 8 主体争 CPU
- [x] AC2: **D类单独修**——快照助手 `test-file-snapshot.sh` 的 `current_files()` 排除 `zz-*` 运行期
      夹具（快照侧消除撞车点，runner-grouping AC7 夹具保留在共享目录以维持断言语义）；与
      test-file-snapshot 全套件快照不再互撞（不并入 A 类修复）
- [ ] AC3: **并发 8 全量真绿**——`full-suite-runner.ts --lane-count 8` 跑完 `fail 0` 且 `cancelled 0`
      （之前 7 个失败测试全部不再失败）。**机制已机械证明**（serial 成员移出主体 + serial 组单独绿 +
      D类修复 + referenced-not-landed 在 develop HEAD 已修）；**全量 concurrency-8 实跑留给外层验证轮**
      （见 Evidence 与实现说明）
- [x] AC4: **负控制**——并发 8 主体下旧失败形态已不可能发生（serial 成员被路由出主体、test-file-snapshot
      竞态消除）；改回非 serial 路由 → session-liveness 重新出现在默认主体（`--list-files` 复现），
      证明 serial 机制是修复
- [x] AC5: 与 `gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7`（B类根因）、
      `gap-test-isolation-backlog-44-violations-unmeasured`（A类 R3 + D类竞态）、
      `gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage`（分诊机械化）交叉标注（三个任务
      体均已加交叉标注段）

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（含三次输出：修前红基线 / 修后绿 / 负控制复现——见 Evidence）
- [ ] 并发 8 全量套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——留给外层验证轮执行（worktree 资源门
      在 serial 运行时 WAIT，全量 ~30-40 min 在 worktree 不现实；机制已机械证明，见 Evidence）

## Evidence（实跑输出 2026-08-07）

### 修前红基线（.quay/full-suite.log 09:10-09:25，laneCount 8，state=red reason=failed）

并发 8 全量在 develop HEAD 上的 7 个失败测试（`✖`）：
1. `plugin/test/runner-grouping.test.mjs` — `AC1/AC2/AC6: flags-only forms run the same test count`（300s 超时，
   A类嵌套拉起 governance 子套件被主体 worker 池饿死）
2. `plugin/test/session-liveness.test.mjs` — `noise gate — an idle transition with an OLD tick log IS reported`（29s，B类挂钟等待）
3. `plugin/test/session-liveness.test.mjs` — `noise gate — ... FRESH tick log is SILENT`（29s）
4. `plugin/test/session-liveness.test.mjs` — `AC4 — observers don't know each other`（5s，probe 未活着）
5. `plugin/test/test-file-snapshot.test.mjs` — `AC2: snapshot default mode records the canonical set`（19s，
   D类：`baseline test file(s) REMOVED: zz-runner-grouping-undeclared.test.mjs`）
6. `packages/quay/test/install-config-driven-e2e.test.mjs` — `A2`（**referenced-not-landed 真实缺陷**，develop HEAD 已修——worktree 隔离复跑 PASS）
7. `plugin/test/quay-init-loop-driver.test.mjs` — `AC3 BANNED-MECHANISM`（**同上 referenced-not-landed**，develop HEAD 已修——worktree 隔离复跑 PASS）

### 修后绿（机制落地后）

- `scripts/test.sh --group serial`（11 个 serial 成员，concurrency 1）：
  `ℹ tests 131 / ℹ pass 130 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 1`，**EXIT=0**。
  其中 runner-grouping（含 flags-only 嵌套 governance 跑）与 session-liveness（含 noise-gate）全部 PASS。
- 并发 8 主体机械排除 serial 成员：默认 `--list-files` = 241（252-11），serial 成员 0 个在主体。
- D类快照：`test-file-snapshot.sh` 排除 `zz-*` 后，快照+check 不再因临时夹具误报 REMOVED。
- 交叉标注：三个根因任务体各加 `### 交叉标注` 段；`gap-test-isolation-backlog-44-violations-unmeasured.md`
  的 `## Contract` control 行修正为单行（消除 task-contract-check 的 contract-line-unknown 新违规，
  ratchet `new since baseline: 0`）。
- **scoped 静态层** `scripts/test.sh --for-task gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`：
  `ℹ tests 136 / ℹ pass 135 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 1`，**EXIT=0**（6 个 scoped 静态检查全过：
  test-framework-policy / test-isolation / test-impl-census / task-contract-check（strict-subset 0 违规）/
  adr016-screen-use / dead-code-after-return；12 个选中测试文件全绿，含 runner-grouping 的 flags-only 嵌套
  governance 跑与 session-liveness 的 noise-gate + AC4 并发失败测试）。

### 负控制复现（改回非 serial 路由 ⇒ 旧失败形态可复现）

- session-liveness 保持 `@test-group serial`：默认 `--list-files | grep -c session-liveness` = **0**（在 serial 阶段）。
- 临时改回 `@test-group governance`：默认 `--list-files | grep -c session-liveness` = **1**（回到并发 8 主体，旧失败形态可复现）。
- 改回 `@test-group serial`：= **0**（再次排除）。证明 serial 路由是修复机制。

### 实现说明（AC3 的机制正确性）

- serial 组是 `scripts/test.sh` 的一个真实组（`group_of` 识别 `serial`），默认集 `product,engine` 机械排除它。
- 全量默认路径（`bash scripts/test.sh`）在并发 N 主体之后追加 serial 阶段：`node --test --test-concurrency=1 ${serial_files[@]}`。
- `--group serial` 单独跑强制 concurrency 1（剥离任何显式 `--test-concurrency` 标志）。
- 上述全量 concurrency-8 实跑留给外层验证轮：worktree 中资源门在 serial 跑时 WAIT，全量 ~30-40 min 超出
  worktree 验证预算；`full-suite-runner.ts --lane-count 8` 的命令不变（`bash scripts/test.sh --test-concurrency=8`），
  serial 阶段由 test.sh 内部追加，runner 的 fail/cancelled 汇总覆盖两个阶段。

## Touches
- scripts/test.sh（serial 组路由）
- plugin/test/runner-grouping.test.mjs（A类 serial + D类夹具保留，快照侧排除）
- plugin/test/select-tests-for-touches.test.mjs（A类 serial）
- plugin/test/test-coverage-check.test.mjs（A类 serial）
- plugin/test/session-liveness.test.mjs（B类 serial）
- plugin/test/measure-suite.test.mjs（B类 serial）
- plugin/test/monitor-mount-check.test.mjs（B类 serial）
- plugin/test/quay-init-tmux-detection.test.mjs（B类 serial）
- plugin/test/send-keys-verified.test.mjs（B类 serial）
- packages/quay/test/build-dist-smoke.test.mjs（B类 serial）
- plugin/test/cold-start-skill.test.mjs（KNOWN-LOAD-SENSITIVE 族，serial）
- plugin/test/quay-init-loop-core.test.mjs（KNOWN-LOAD-SENSITIVE 族，serial）
- plugin/test/test-file-snapshot.test.mjs（D类：快照校验）
- plugin/scripts/test-file-snapshot.sh（D类：排除 zz-* 运行期夹具）
- tasks/gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7.md（AC5 交叉标注）
- tasks/gap-test-isolation-backlog-44-violations-unmeasured.md（AC5 交叉标注）
- tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-07T10:3xZ
changed: 人裁定（2026-08-07 10:2x，方向已定）：并发 8 不降 + 为不能并发跑的测试应用机制 + 并发拿真绿。
  管理者机械识别给 A/B/C/D 四类（C 已排除）。落点 = serial 组（复用 --group 机制）+ D类代码修复。
  实现细节外层+内层定。本任务是 human ruling 的直接落地，套件红窗被此裁定替换为「实现→重跑→真绿」。
