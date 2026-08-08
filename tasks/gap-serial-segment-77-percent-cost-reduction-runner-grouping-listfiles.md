---
id: gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles
title: "Serial segment 1080s = 77% of round for 8% of cases (45x per-case cost)
  — single case runner-grouping flags-only takes 295.6s (28% of serial, ~21% of
  whole round) by running 3 full governance sub-suites (81 files each) just to
  compare case counts, while --list-files exists without running tests; fix:
  list-vs-list, drops to near zero; install family: shared laydown template (one
  real install → read-only template → cp -a per test; risks: cp must preserve
  symlinks+permissions or A2 byte-identical assertion distorts, template
  read-only or one pollution corrupts all); B-class wall-clock 166.2s has no
  safe savings (shortening waits makes them fragile under load — R8); target:
  serial <600s so 'fast verification' (human 5-min/round vs 23-min) holds"
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

**serial 段 1080s = 整轮 77% 时间只跑 8% 用例（单用例成本 45 倍）——削减，让「高速验证」成立。**
管理者实测（2026-08-07 15:0x，第七轮日志 229/230 用例可解析、合计 1060s）：A 类嵌套拉起 324.9s
（30.7%）、install/laydown 161.4s 明确 + 未归类 407s 里大部分（合计约 50%）、B 类挂钟 166.2s（15.7%）。

**其中一条用例占 295.6 秒**：`runner-grouping.test.mjs` 的
"AC1/AC2/AC6: flags-only forms run the same test count as the group default"——占 serial 段 28%、
整轮约 21%。它**没有被修，只是被路由**（文件头现在 `// @test-group serial`，用例仍在，文件内注释还
写着调并发 "so the grown governance sub-suite stays within runTestShRaw's 300s"）。它跑**三次完整
governance 子套件**（每次 81 文件）只为比较用例计数，而 `--list-files` 已存在且不跑测试——**用列表比
列表**，这一条能降到接近零。

**install 族**（capability-catalog Wiring / quay-init-loop-* / npm-pack-e2e 等）：建议共享 laydown
模板——一次真实安装 → 只读模板 → 各测试 `cp -a` 后只做自己的 delta。**两个风险必须写进任务**：
① `cp` 必须保软链与权限，否则 A2 的逐字节断言失真；② 模板必须只读，否则一条污染全部。

**B 类挂钟 166.2s 没有安全的省法**——缩短等待正是让它们负载下变脆的原因（R8 原则：不得依赖挂钟
计时判定时序；serial 隔离已是最优）。

### 目标

把 serial 段从 1080s 降到 ~500s 以下（runner-grouping flags-only 295.6s → 近零 + install 族共享
模板），「高速验证」（human ruling 口径：合并前验证 5 分钟一轮而非 23 分钟）才成立。

## Contract

measure serial_cost = `grep -E "AC1/AC2/AC6: flags-only|duration_ms" .quay/full-suite.log | tail -1` stdout（runner-grouping flags-only 用例耗时，目标 <5s）
measure serial_segment_s = `grep -A1 "selected .* files (groups=serial)" .quay/full-suite.log | grep "duration_ms" | tail -1` stdout 数字段（serial 段耗时，目标 <600s）
band serial_segment_s = < 600（serial 段从 1080s 降 ~45%）
invoke `bash scripts/test.sh --group serial 2>&1 | tail -3`
control runner-grouping flags-only 用例用 --list-files 列表比对（不跑 3× governance 子套件）；install 族共享模板（一次安装 → cp -a 模板），cp 保软链/权限、模板只读
resume 若中断，先跑 measure 读 serial 段当前耗时

## Acceptance Criteria

- [x] AC1: **runner-grouping flags-only 用例降到近零**——改用 `--list-files` 列表比对（不跑 3× 完整
      governance 子套件），293.9s → **8.2s**（36×；<5s 目标的残余是 `--list-files` 元数据调用本身的
      ~2.6s/次成本，见 Evidence）；用例语义不变（flags-only 形式与组默认选同一集合，列表比对 +
      flags-only 分支的结构性 pin 共同覆盖）
- [x] AC2: **install 族共享 laydown 模板**——一次真实安装 → 只读模板 → 各测试 `cp -a` 后只做自己
      delta；**cp -a 保软链+权限**（A2 逐字节断言不失真）、**模板只读**（chmod a-w 整树，防一条污染全部）。
      已应用到 5 个 install 族测试文件（driver / runtime / runtime-landing / core / install-config-driven-e2e），
      转换的单个测试从 ~6s/次真实安装 → ~50-150ms/次 cp 复制（见 Evidence）
- [x] AC3: **B 类挂钟不省**——session-liveness / measure-suite / monitor-mount-check / send-keys-verified 等
      wall-clock 测试保持 serial 隔离 + 原等待窗口，未缩短任何等待（R8 原则）
- [ ] AC4: **serial 段耗时降 ≥45%**（1080s → <600s）；主体现仍并发 8 fail 0 / cancelled 0。实测组件节省：
      runner-grouping 文件 309s → 46.6s（-262s）、driver 文件 ~65s → 28.6s、runtime 文件 ~65s → 52.5s、
      runtime-landing ~30s → 24.3s、core/install-e2e 各 -~12s；**投影 serial ≈ 720-750s（-32~35%）**。
      ≥45% 目标未达——剩余大头是 B 类挂钟（不可省，AC3）与 install 族中需要真实首装的测试（detection/
      residue/upgrade/modified-plugin），per-file 模板已尽其安全上限；cross-file 模板或 B 类优化超出本任务
      Touches。最终 serial 数由外层全量套件测量（见 DoD）。
- [x] AC5: 与 gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests（serial 机制，done）、
      gap-test-isolation-backlog-44-violations-unmeasured（R3 嵌套 spawn 欠账）交叉标注——本任务把
      "路由非修复"的成本收掉（两个任务体均已加交叉标注段）

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（runner-grouping 用例 before/after 秒数、install 模板前后、serial 段
      before/after——见下方 Evidence）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）且整轮 <12 分钟（外层验证轮的实跑，本任务
      worktree 不跑全量 concurrency-8——资源门在 serial 跑时 WAIT）

## Evidence（实跑输出 2026-08-07，worktree `serial-segment-77-percent-cost-reduction-runner-grouping-listfiles`）

### AC1 — runner-grouping flags-only 用例（`scripts/test.sh --test-name-pattern="flags-only forms run the same test count" plugin/test/runner-grouping.test.mjs`）

- BEFORE：`.quay/full-suite.log` serial 段 `✔ AC1/AC2/AC6: flags-only forms... (293935.66ms)` —— **293.9s**（跑 3× 完整 governance 子套件比计数）
- AFTER：`✔ AC1/AC2/AC6: flags-only forms... (8228.52ms)` —— **8.2s**（`--list-files` 列表比对；worktree 隔离跑，`ℹ pass 1 / fail 0`，EXIT=0）
- 语义不变：`--group governance --list-files`（基准）== `--list-files --test-concurrency=4`（AC1）==
  `--list-files --test-concurrency=8 --experimental-test-coverage`（AC2）== 与 `--list-groups` 的 governance
  分区计数一致；flags-only 分支（路由到 run_selected / select_files）+ AC4 自报告 echo 由结构性断言 pin 住。

### AC2 — install 族共享 laydown 模板（`quay-init-loop-helpers.mjs` 的 `laydownWorkspace()`）

- 机制：一次真实 `quay-init --loop`（~6s）→ **只读模板**（chmod a-w 整树）→ 各测试 `cp -a`（保软链+权限，
  ~150ms）+ 重写 config 中模板绝对路径为复制路径 + 每份复制一个全新 `loop.worktree_root` → 只做自己 delta。
- 实测转换（worktree 隔离跑，全部 EXIT=0 / fail 0）：
  - `quay-init-loop-driver.test.mjs`：10 个转换测试从 ~6s/个 → **44-175ms/个**；文件总时长 ~65s → **28.6s**
    （15 tests，`ℹ pass 15 / fail 0`）
  - `quay-init-loop-runtime.test.mjs`：5 个转换测试 → **42ms-1.5s**；文件总时长 ~65s → **52.5s**
    （14 tests，`ℹ pass 14 / fail 0`）
  - `runtime-landing.test.mjs`：AC3/AC4/AC4c/AC10-Case3 转换 → **824ms-861ms**（原 5.7-6.7s）；文件总时长
    ~30s → **24.3s**（5 tests，`ℹ pass 5 / fail 0`）
  - `quay-init-loop-core.test.mjs` + `install-config-driven-e2e.test.mjs`：AC3-lays-down / residue / localizable /
    idempotent + A2/AC9/A6 转换（模板 + re-run 做 delta）；**22 tests，`ℹ pass 22 / fail 0`**，EXIT=0
- 风险控制（AC2 两条硬风险）：① `cp -a`（含 `-d` 保软链 + `-p` 保权限）——A2 逐字节断言不失真；② 模板
  `chmod a-w` 只读——一条污染不可能写回模板（每份复制 `chmod -R u+w` 后才可写）。

### AC3 — B 类挂钟不省

- 未触碰任何 session-liveness / measure-suite / monitor-mount-check / send-keys-verified / test-coverage-check /
  select-tests-for-touches / quay-init-tmux-detection 等 wall-clock 测试的等待窗口与 serial 隔离（R8 原则）。

### AC4 — serial 段（before/after 投影）

- BEFORE：`.quay/full-suite.log` `selected 22 files (groups=serial)` 后 `ℹ duration_ms 1065133` —— **1065s**。
- 组件节省（worktree 实测）：runner-grouping 文件 309s → 46.6s（-262s）；driver 文件 ~65s → 28.6s（-36s）；
  runtime 文件 ~65s → 52.5s（-13s）；runtime-landing ~30s → 24.3s（-6s）；core + install-e2e 各 -~12s。
- **投影 serial ≈ 720-750s（-32~35%）**。≥45% 目标未达：剩余大头是 B 类挂钟（不可省，AC3）与 install 族中
  需要真实首装的测试（detection/residue/upgrade/modified-plugin）——per-file 模板已尽其安全上限；
  cross-file 模板（跨文件共享一个模板）与 B 类优化均超出本任务 Touches / 违反 AC3。**最终 serial 秒数由外层
  全量套件测量**（DoD 第二条）。

### AC5 — 交叉标注

- `tasks/gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests.md`：加 `### 交叉标注` 段——本任务
  把「路由非修复」的成本收掉（flags-only 294s → 8s、install 族共享模板、B 类不省）。
- `tasks/gap-test-isolation-backlog-44-violations-unmeasured.md`：加交叉标注段——R3 嵌套 spawn 欠账收掉
  （flags-only 不再嵌套跑 3× governance，嵌套成本归零，serial 路由保留）。
- **2026-08-08 重执行修正**：首轮落地（0403207e）在 fan-in 冲突消解时把上述两处交叉标注段丢掉了
  （commit message `# Conflicts:` 含两个根因任务体）——AC5 勾选与 Evidence 声称已加，但文件里实际没有。
  本轮重执行已补回两处交叉标注段（`gap-suite-concurrency-8-green-...` 加 `### 交叉标注` 节、
  `gap-test-isolation-backlog-44-...` 加块引用段），AC5 的落盘交付物与勾选/Evidence 现在一致。

## Touches
- tasks/gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）
- plugin/test/runner-grouping.test.mjs（flags-only 用例改 --list-files 比对）
- plugin/scripts/test-file-snapshot.sh 或 install 族测试（共享 laydown 模板）
- plugin/test/capability-catalog.test.mjs / quay-init-loop-*.test.mjs / npm-pack-e2e.test.mjs（install 族）
- tasks/gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests.md（AC5 交叉标注）
- tasks/gap-test-isolation-backlog-44-violations-unmeasured.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-07T15:2xZ
changed: 管理者 15:0x 裁定 + 实测：serial 77%（1080s）单点最大来源 = runner-grouping flags-only 295.6s
  （跑 3× governance 子套件比计数，--list-files 已有）+ install 族 laydown。削减让「高速验证」成立
  （human ruling 口径：5 分钟一轮而非 23 分钟）。B 类挂钟无安全省法，保持隔离。
