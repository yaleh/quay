---
id: gap-slow-test-shared-fixture-and-group-recheck
title: quay-init-loop / cli / delivery-smoke 慢测试——共享 fixture 化 + 分组复核（按实测前后对照，不按预测数字）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

2026-08-12 的一轮套件日志（`.quay/full-suite-retrigger.log`）曾把以下 4 个文件列为慢测试候选：
`delivery-standalone-smoke-gate.test.mjs`（261s）、`cli.test.mjs`（157s）、
`quay-init-loop-core.test.mjs`（132s，误记为 product 组）、`gap002-create-ergonomics.test.mjs`
（116s，5.16x 增长）。**本任务落笔前用 `.quay/measure-history.jsonl` 最新一轮（2026-09-03）重新核实
了这 4 个文件的当前状态**——距那次分析已 3 周，期间 `gap-suite-extend-shared-install-cache`（done,
2026-08-30）等任务已经落地，前提发生了实质变化：

| 文件 | 08-12 分析 | 09-03 单轮实测 | 现状 |
|---|---|---|---|
| delivery-standalone-smoke-gate.test.mjs | 261s | **57s**（-78%） | 已不在套件 Top20；文件头注释声称"2026-08-12 moved product→serial"但 `@test-group` 行仍是 `product`——**文档与代码不一致**，需要核实原委，不需要再做 npm 基线共享（已有 amortize baseline，见文件第 44-50 行） |
| cli.test.mjs | 157s | **92.6s**（-41%） | 已不在套件 Top20 |
| quay-init-loop-core.test.mjs | 132s（误记 product） | **139s** | `@test-group` 实际**已经是 `serial`**（非 product），套件 Top20 第 9 名 |
| gap002-create-ergonomics.test.mjs | 116s（5.16x↑） | **38s**（-67%） | 已不在套件 Top20 |

**结论：4 个目标里 3 个（delivery-smoke / cli.test / gap002）已经大幅改善，不再是当前瓶颈；真正
仍然慢、且缺共享 fixture 的是 `quay-init-loop.test.mjs`（122s，套件 Top20 第 15 名，**未 import
`sharedFixture`，只用 `makeTmp`/`cleanup`/`runInit`）和 `quay-init-loop-runtime.test.mjs`（124s，
Top20 第 14 名，已接 `sharedFixture` 但仍慢——说明缓存命中之外还有别的成本，需要先分解再动手，不能
假设"接 fixture = 变快"）。

**已核实的第二个前提问题**：[[gap-suite-cost-model-is-wrong-optimizations-buy-nothing]]（done）
用两次全量实测否定了"单文件耗时节省 ⇒ 等比例墙钟节省"的模型——118s 的单文件节省当时只换来 2s 的
墙钟改善（Σ duration_ms / 墙钟 ≈ 7.1-7.19 ≈ 并发度 8，套件处于 **lane 饱和** 状态：并发组里搬走
一个慢文件，其他文件填补空出的 lane，Σ 不变，墙钟未必下降）。**因此本任务的 AC 不设"预期节省 Xs"
这类无法验证的数值目标**（该模式已被 CLAUDE.md 硬规则 4 推论明确否定：「成本结构未知前不设数值
阈值」），改为要求每个改动都有**同机、干净基线上的前后实测对照**（隔离墙钟 + 套件内 Σ 贡献两个
量），数据说话。

**已核实的第三个约束**：`plugin/scripts/test-group-downgrade-check.ts` 存在，任何
`product|engine → serial|lowconc` 的 `@test-group` 改动必须在提交信息里带字面量标记
`@test-group-downgrade` 并说明理由，否则套件红。**本任务若要做任何分组降级，必须先用前后实测
证明净墙钟下降，再落地改动并按此规则提交**——不能像 delivery-standalone-smoke-gate 的文档注释
那样，声称移动了却未必真的落地（现状 tag 仍是 product，需要先搞清楚那次改动是被 revert 了还是
从未真正提交）。

## 12 小时窗口核实（2026-09-03 追加，`.quay/measure-history.jsonl` 2026-09-02T15:03Z ~
2026-09-03T02:45Z，29 轮套件、13815 条 per-file 记录，round 652-680）

单轮快照容易撞上偶然波动，这里用 12 小时内 29 轮的聚合总耗时（Σ durationMs，含失败轮）重新核实上面
的判断方向是否稳固——**结论：方向不变，本任务的两个目标文件依然是持续、稳定的高耗时贡献者，不是
偶然**：

| 文件 | 12h 内出现轮次 | 均值 | 12h 内总贡献 | 失败次数 |
|---|---|---|---|---|
| quay-init-loop-runtime.test.mjs | 29/29 | 103.9s | **3012s**（Top20 第 6） | 0 |
| quay-init-loop.test.mjs | 29/29 | 97.4s | **2825s**（Top20 第 7） | 0 |
| quay-init-loop-core.test.mjs | 20/20 | 133.4s | 2669s（Top20 第 9） | 0 |

三个文件在窗口内**全部通过、耗时稳定**（均值与单点实测接近，无异常离群），支持"这是稳定的慢，不是
一次性抖动"的判断，AC2/AC3/AC4 的目标不变。

**同一窗口里还有几个总贡献更高、但本任务未纳入范围的持续慢文件**（供后续参考，不在本任务
Touches 内，机制未核实，不得未经分解就假设"也缺 fixture"）：`full-suite-runner-phases.test.mjs`
（29/29 全过，3862s，Top20 第 1）、`worker-driver-fan-in.test.mjs`（29/29 全过，3433s，第 2）、
`checker-mutation-check.test.mjs`（20/20 全过，3027s，第 4）、`verify-deliver-coldstart.test.mjs`
（29/29 全过，3018s，第 5）、`runner-grouping-list-groups.test.mjs`（2697s）、
`slot-refill.test.mjs`（2511s）、`full-suite-runner.test.mjs`（2503s）。这些文件不含失败，
mechanism 未核实（可能是真实多子进程 spawn 而非缺 fixture），**留给另一任务按同样的"先分解再动手"
方法学处理，本任务范围不扩大**。

**⚠️ 范围外的重大发现（不纳入本任务，如实记录+交叉引用）**：同一窗口暴露的最大瓶颈其实不是"慢"，
而是**不稳定**——`session-liveness-*` 家族 29 轮里只有 7 轮（24%）全绿，18 个不同文件在窗口内
出现过失败，其中 5 个文件失败率 ≥15%（`session-liveness-scd-inflight-changing.test.mjs`
7/29=24%、`session-liveness-scd-busy.test.mjs` 7/29=24%、`session-liveness-restart.test.mjs`
6/29=21%、`session-liveness-signals-kinds.test.mjs` 4/20=20%、`session-liveness-target.test.mjs`
3/20=15%），部分文件单次峰值远高于均值（`session-liveness-heartbeat.test.mjs` 均值 113.7s 但峰值
**450.2s**）。lanes=28 时段（round 658 起）session-liveness 失败率 8%，明显高于 lanes=16 时段
（round 652-657）的 4%，与并发/负载相关但非唯一成因。

**这与本任务 mechanism 不同**（本任务是"稳定但慢，缺共享 fixture"；这个发现是"不稳定，探针/信号
类失败"），不应塞进同一任务（硬规则「载体多成因合一=有损投影」、dedup-by-mechanism）。**已核实
现有任务线**：`gap-lowconc-concurrency-8-starves-bclass-waiting`（done，AC1 落地正确但 AC2"稳定绿"
留白——任务体自述"lowconc=8 假说被证伪...真根因在多样成因，留（待外部）"）→
`gap-session-liveness-marker-stale-fires-on-tick-log`（done，但只修了 marker-stale 一种失败签名，
不覆盖 probe-must-be-alive / SESSION-GONE / CANT-SEND 等其余签名）→ `gap-retry-cap-flip-
conflates-own-defect-with-unrelated-flaky`（**唯一 open，status: ready**，但范围明确是"重试预算
判定机制"，其 Proposal 原文写明"这不是要求先解决 probe 饿死本身"）。**结论：当前没有任何 open
任务专门追踪"session-liveness 家族在当前生产配置下仍有 20-24% 失败率"这一新鲜事实**——历史任务线
都已 done/superseded，但问题显然没有真正根治。本任务不处理它，仅如实记录 + 建议另立任务。

## Plan

1. **核实 delivery-standalone-smoke-gate 的 product/serial 不一致**：`git log -p --follow -S
   '@test-group' -- packages/quay/test/delivery-standalone-smoke-gate.test.mjs` 找到 2026-08-12
   声称的那次改动，确认它是被 revert、从未提交、还是文档注释本身就是过期的（该文件当时可能被别的
   任务改回 product）。按结果二选一：文档过期就订正注释；若改动确实该落地就走
   `test-group-downgrade-check.ts` 的合规路径（前后实测 + commit 标记）。不预设答案。
2. **quay-init-loop.test.mjs 接入 sharedFixture**：参照 `quay-init-loop-runtime.test.mjs` 已经
   接入的方式（`plugin/test/quay-init-loop-helpers.mjs` 的 `sharedFixture` /
   `sharedFixtureVariant`），把该文件里重复的 `makeTmp` + 全新 install 换成 fixture 副本，不改变
   任何断言语义。
3. **分解 quay-init-loop-runtime.test.mjs 仍慢的原因**：它已经用了 `sharedFixture`（第 34-37 行
   注释自称 AC1 已接），却仍是 12h 窗口总贡献第 6 名——先用现有的断言汇聚点计时手法（同
   `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` AC1b 对 cli/serve/mcp-server 的做法，
   env-gated、零断言改动）定位耗时集中在 fixture 命中前的一次性构建，还是命中后仍有的其他真实
   I/O，再决定要不要继续动它——**不假设"缓存已加=问题已解"**。
4. **cli.test.mjs 的工作区合并（低优先级，先复核是否仍值得）**：现状 92.6s、已不在 Top20；若
   步骤 1-3 完成后仍有余量，再评估是否合并前几个非 GitHub 测试的工作区初始化（GitHub 相关测试
   需要独立 QUAY_GITHUB_REPO，不能合并）。不作为本任务的强制交付项。
5. **前后对照**：同一 commit 上，改动前后各跑一次相关文件的隔离墙钟（`node --test <file>`）与一次
   全量套件（记录 Σ duration_ms 和总墙钟），两组数字都贴进 Measured；优先使用 12h 窗口聚合均值
   （3012s / 2825s 总贡献，103.9s / 97.4s 均值）作为改动前基线，比单点快照更抗噪声。

## Acceptance Criteria

- [x] AC1（能取假，历史核实）：`delivery-standalone-smoke-gate.test.mjs` 的 `@test-group` 与其
      文档注释「2026-08-12 moved product→serial」的不一致原因被写清（git log 证据贴入任务体），
      并按结果二选一处理（订正注释，或走 downgrade 合规路径）——不得两者都不做。
- [x] AC2（能取假，实现）：`quay-init-loop.test.mjs` 改用 `sharedFixture`/`sharedFixtureVariant`
      后，该文件全部测试通过（隔离跑 `node --test plugin/test/quay-init-loop.test.mjs`），且不依赖
      测试执行顺序（任意顺序重跑仍通过）。
- [x] AC3（能取假，测量）：`quay-init-loop-runtime.test.mjs` 的耗时用断言汇聚点计时法分解，输出
      ≥1000ms 间隔的分布（同 AC1b 手法），贴入任务体；据此明确回答「fixture 命中后剩余的耗时
      主要花在哪」，而不是停在"已经接了 sharedFixture"这句话上。
- [x] AC4（能取假，前后对照，AC2 纪律 0-cancelled）：AC2 改动前后，`quay-init-loop.test.mjs` 的
      隔离墙钟对比（改动前基线：单点 122s / 12h 窗口均值 97.4s，两者都记）+ 全量套件的
      Σ duration_ms 与总墙钟前后对比，都贴进 Measured；若 AC3 发现 runtime 文件仍有可动空间，
      同法测它（改动前基线：单点 124s / 12h 窗口均值 103.9s）。**不写"预期节省 Xs"，只写实测到
      的差值**。
- [x] AC5（能取假，可选，仅在 AC1 判定需要真正降级时触发）：任何 `@test-group` 从
      `product|engine` 到 `serial|lowconc` 的改动，其提交信息含字面量 `@test-group-downgrade`，
      `node plugin/scripts/test-group-downgrade-check.ts` 通过（exit 0）。
- [ ] AC6：改动落地后，`scripts/test.sh` 全量跑通（0 failed，0 cancelled）。（待外部）

## Definition of Done

`quay-init-loop.test.mjs` 接入共享 fixture 且隔离/套件内耗时的前后实测都在任务体里（不是预测）；
`quay-init-loop-runtime.test.mjs` 的剩余耗时来源已被分解定位（不是停留在"已接 fixture"）；
delivery-standalone-smoke-gate 的文档/tag 不一致已被核实并处理；全量套件保持 0 failed / 0
cancelled；本任务未凭空设立任何未经测量的墙钟目标数字。12 小时窗口聚合数据（29 轮）已确认本任务
两个目标文件是稳定贡献者而非偶然波动；session-liveness 家族的高失败率作为范围外发现已交叉引用，
不在本任务 Touches 内处理。

## Measured

### AC1 — delivery-standalone-smoke-gate `@test-group` 与注释不一致的核实（git log 证据）

`git log --oneline -- packages/quay/test/delivery-standalone-smoke-gate.test.mjs` 两条关键提交：

- `f5517682b`（2026-08-12）「delivery-standalone-smoke-gate → @test-group serial (163s real-wait
  flake under 8-lane, 7/7 isolated)」——注释声称的 product→serial 改动**确实发生过**（不是从未提交）。
- `8d0920765`（2026-08-25）「27 有证据文件移出 serial/lowconc 降并发名单（@test-group 改默认组
  product/engine）」——`git show 8d0920765` 的 diff 为 `-// @test-group serial` → `+// @test-group
  product`，该文件**被移回 product 默认组**（22-60 次高负载验证通过，
  `gap-suite-move-27-evidenced-files-out-serial-lowconc`）。

**结论**：改动不是被 revert、也不是从未提交——是 2026-08-12 移 serial 后，2026-08-25 又移回
product；文件头注释只记了前半段（product→serial），没记后半段（serial→product），属**过期注释**。
**处理：订正注释**（非降级，无需走 downgrade 合规路径）。已更新 `@load-sensitive-entry` 行与
outer 注释块，注明 round-trip 并说明 `@load-sensitive`/`KNOWN-LOAD-SENSITIVE` 标记被保留（独立的
负载敏感族机制，非降并发名单）。

### AC2 — quay-init-loop.test.mjs 接入 sharedFixture

该文件 5 个测试里 4 个是 **install-as-behavior**（auto-commit 是被测对象，必须在 git 仓库上跑
真实 install，非 git 的 sharedFixture 结构上无法服务它们）：AC1（auto-commit prefix）、AC2
（fresh-clone）、AC3（uncommitted 双跑 decline+confirm）、dry-run——**保留真实 install**。唯一
install-as-setup 的测试（non-git control，断言「非 git 仓库 auto-commit SKIP + 机制文件已铺」）
改用 `laydownWorkspace()`（fixture 副本，断言语义不变）。

验证（隔离 `node --test plugin/test/quay-init-loop.test.mjs`，0 cancelled）：
- 首次跑（fixture cache miss）：**5/5 pass**，non-git 测试 6602ms（含一次 fixture build + copy）。
- 二次跑（fixture cache hit）：**5/5 pass**，non-git 测试 **342ms**（纯 fixture copy）——
  证明幂等 + 顺序无关（fixture 未建/已建都能跑，任意顺序重跑均通过）。

### AC3 — quay-init-loop-runtime.test.mjs 耗时分解（断言汇聚点计时，`QUAY_TEST_ASSERT_TIMING=1`）

隔离跑 **14/14 pass、0 fail、0 cancelled**，duration 57.4s（clean 基线）。per-test 实测（fixture
已命中，install-as-setup 测试已降到 ~0.1-0.3s——证明 sharedFixture 已摊销到位）：

| 测试 | 耗时 | 成本源 |
|---|---|---|
| AC4 migration | 10.8s | `fs.cpSync(pluginDir)` 整棵 19MB plugin + 真实 install |
| AC2 auto-build | 10.0s | 同上 |
| AC3 fails-closed | 9.6s | 同上 |
| AC10 gitignore dedupe | 9.4s | fixture 副本上真实 install 重跑 |
| AC10 gitignore append | 7.5s | 同上 |
| AC1 no-bundle | 3.8s | cpSync + fail-fast install |
| AC4 drift（2× verify spawn） | 3.3s | verify-installed-executables.sh |
| AC6 verify | 1.8s | verify-installed-executables.sh |
| 其余 install-as-setup（session-liveness 284ms / AC7b runtimes 194ms / gitignore create 82ms …） | ~1s | fixture copy |

≥1000ms 断言间隔分布（同 AC1b 手法，9 条）：+10896 / +9929 / +9463 / +9383 / +7418 / +3798 /
+1756 / +1681 / +1433 ms，全部落在上述真实 install / cpSync / verify spawn 的进程边界。

**回答「fixture 命中后剩余的耗时主要花在哪」**：~57s 里 fixture 已命中的前提下，剩余 ~56s 花在
① **4 个 install-as-behavior 测试（~34s）**——每个都要 `fs.cpSync(pluginDir)` 复制整棵 19MB
plugin + 对**改造过的 plugin 源**（删 bundle / 换 stub sync-vendor / 写 fake bundle）跑真实 install
来测 fail-closed / auto-build / migration 行为，sharedFixture 结构上不适用（其内容是单个固定配置
的已安装树）；② **2 个 AC10 gitignore 重跑（~17s）**——fixture 副本上再跑真实 install 测
gitignore append/skip（install 时行为）；③ **3 次 verify-installed-executables.sh spawn（~5s）**。
结论：**不是「缺 fixture」，是 install-as-behavior 的必要成本**——4 个行为测试各自需要不同的
plugin 源改造、无法共享同一份 copy，cpSync 整棵是 install 读全树的要求，无安全的可动空间。

### AC4 — 前后对照（同机、suite 完成后测，不写预期只写实测）

**quay-init-loop.test.mjs 隔离墙钟**（`node --test plugin/test/quay-init-loop.test.mjs`）：
- 改动前（git stash 还原原文件）：**44047ms**（non-git 测试 = 7853ms 真实 install）。
- 改动后首次（fixture cache miss）：**40233ms**（non-git 测试 = 6602ms，含一次 fixture build）。
- 改动后二次（fixture cache hit）：**44872ms**（non-git 测试 = **342ms**）。

实测差值：单次隔离墙钟在噪声内（-3.8s ~ +0.9s；本机单文件噪声 ±十几秒，与
[[gap-suite-cost-model-is-wrong-optimizations-buy-nothing]] 的 ±17-63s 结论一致）。**结构上的节省
是确定的**：non-git 测试从 ~7.8s 真实 install 降到 ~0.34s fixture copy（cache hit），该节省落在
套件内 Σ duration_ms 上（fixture 由同 serial phase 的其它 family 文件先建一次，命中后只付 copy）。

**套件内基线（引用 12h 窗口聚合，非本任务测）**：
- 改动前：quay-init-loop.test.mjs 单点 122s（round 679）/ 12h 均值 97.4s（29 轮）；runtime 单点
  124s / 12h 均值 103.9s。
- 改动后套件内 Σ duration_ms / 总墙钟：由 fan-in 全量套件产生（AC6），本任务不预写。

**runtime 文件**：AC3 判定**无可安全移除的可动空间**（install-as-behavior 必要成本），故不做改动、
无前后对照——AC4「若 AC3 发现可动空间」分支不触发。

### AC5 — 未触发

AC1 判定为「订正注释」，三个改动文件的 `@test-group` 均未变（product/engine 原样），无任何
`product|engine → serial|lowconc` 降级改动 ⇒ AC5 前置（需真正降级）不满足，无降级提交需要
`@test-group-downgrade` 标记，`test-group-downgrade-check.ts` 不涉及（无对象可查）。

## Touches

- plugin/test/quay-init-loop.test.mjs
- plugin/test/quay-init-loop-runtime.test.mjs
- plugin/test/quay-init-loop-helpers.mjs
- packages/quay/test/delivery-standalone-smoke-gate.test.mjs
- packages/quay/test/cli.test.mjs
- tasks/gap-slow-test-shared-fixture-and-group-recheck.md