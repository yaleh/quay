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

- [ ] AC1: **runner-grouping flags-only 用例降到近零**——改用 `--list-files` 列表比对（不跑 3× 完整
      governance 子套件），295.6s → <5s；用例语义不变（flags-only 形式与组默认选同一集合）
- [ ] AC2: **install 族共享 laydown 模板**——一次真实安装 → 只读模板 → 各测试 `cp -a` 后只做自己
      delta；**cp 保软链+权限**（A2 逐字节断言不失真）、**模板只读**（防一条污染全部）
- [ ] AC3: **B 类挂钟不省**——session-liveness 等 wall-clock 测试保持 serial 隔离 + 原等待窗口
      （缩短 = 负载下变脆，R8 原则）
- [ ] AC4: **serial 段耗时降 ≥45%**（1080s → <600s）；主体现仍并发 8 fail 0 / cancelled 0
- [ ] AC5: 与 gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests（serial 机制，done）、
      gap-test-isolation-backlog-44-violations-unmeasured（R3 嵌套 spawn 欠账）交叉标注——本任务把
      "路由非修复"的成本收掉

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体（runner-grouping 用例 before/after 秒数、install 模板前后、serial 段
      before/after）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）且整轮 <12 分钟

## Touches
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
