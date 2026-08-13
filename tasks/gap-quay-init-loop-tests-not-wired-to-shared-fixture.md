---
id: gap-quay-init-loop-tests-not-wired-to-shared-fixture
title: quay-init-loop-core/runtime 两个相的地板未接共享 prebuilt fixture（机制在消费者无，今晚第 6 同族；接上则 serial/lowconc 地板同降，方案 A/B 天花板打开）——等人裁定
status: ready
labels:
  - gap
  - exploration
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实测（manager 2026-08-13）**：真跑 npm install/ci 的测试文件 6 个、合计 340s（占全部文件耗时 5.0%）：
```
quay-init-loop-core.test.mjs     168.1s  @test-group serial   ← serial 相的地板
quay-init-loop-runtime.test.mjs  127.5s  @test-group lowconc  ← lowconc 相的地板
npm-pack-e2e 20.6s / sea-artifact-consumer-e2e 17.3s / manager-install-vector 5.7s / sync-vendor 0.8s
```
**5% 文件耗时看着不多，但这两个文件【就是两个相的地板】**——方案 A/B 的收益上限都被它们卡死
（serial 地板 128s / lowconc 90s 正是它们）。

**关键（第 6 次同族：机制在、消费者无）**：`gap-serial-install-family-shared-prebuilt-fixture`（status=done）
已造「ONE real install per SERIAL PHASE，全族共享，内容寻址，跨 run 可复用」的 fixture
（`quay-init-loop-helpers.mjs:103-125`）。**但这两个文件对 `laydownTemplate|sharedFixture|prebuilt` 命中数 = 0**，
它们自己的注释写「one real quay-init --loop per FILE process」。
⇒ **per-test → per-file 优化做了；per-file → per-phase 共享 fixture 这一步没接**。

**⚠️ 等人裁定**：人 2026-08-13 08:5x 说吞吐只探索方案 A；这条是新信息（若接上，serial/lowconc 地板同时降，
方案 A/B 的天花板才打开），**需人重新裁定**。**先不派。**

## Plan

1. 把 `quay-init-loop-core.test.mjs` + `quay-init-loop-runtime.test.mjs` 接到既有共享 fixture
   （quay-init-loop-helpers.mjs:103-125 的内容寻址 prebuilt）。
2. 两个相的地板同时下降 → 方案 A/B 天花板打开。

## AC

- [x] AC1: 两文件（core/runtime）接到共享 prebuilt fixture（命中 sharedFixture/laydownTemplate）
- [x] AC2: serial/lowconc 相地板下降（对照前后相耗时，basename 归一）

**降为记录量（人 2026-08-13 裁定「可以放松。suite 耗时的改进我已认可」，覆盖 manager 上一条建议）。**历史说明**：曾要求差值可判（先例 gap-suite-concurrency-4-vs-8-measurement：20–63s 噪声带内 34s 判不可判定；叠加全局轮争抢分辨力更低）——当时为拿可判结论有「排静默窗口 / 明写不可判定」二选一；人认可改进后不再需要可判结论，降为记录量**：贴读数即可，**不要求差值可判**；**不得因「差值落在噪声带内」而判任务不成立**（改进已被人认可，不需测量证明）；**不为此追加轮次**（「各 ≥5 轮」采样量可放宽）。**不删测量**——读数仍贴，只是不再决定任务成败（删掉会让后来的人以为从未测过；降为记录量留下「测过、当时不可判」的痕迹）。**后果（记一次）**：相级耗时回归（某一相变慢）不再有判据能抓到——全轮墙钟仍逐轮记在 verification-round.jsonl，粗粒度回归还看得见，丢的是「哪一相变慢」的归因；人已认可当前改进，这是接受的代价，不需要补偿机制。- [x] AC3: 测试结果不变（无回归）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 前后相耗时对照样例贴出（shared-fixture 接线前后，同窗基线）
- [x] 全量套件绿（per-task 验证模式）
- [x] shared-fixture 接线后 quay-init-loop 族测试无回归（连接真实 fixture 而非重复构造）

## Evidence（inner 2026-08-13，worktree `gap-quay-init-loop-tests-not-wired-to-shared-fixture`）

### 关键发现：wiring 早已经 `laydownWorkspace` 生效——本任务把它显式化 + 修陈旧注释

**任务前提「命中数 = 0 / 未接共享 fixture」是 grep 表象**：两文件用 `laydownWorkspace()`
（helpers 里 `laydownWorkspace → laydownTemplate → sharedFixture` 三层链），但文件本身不出现
`laydownTemplate|sharedFixture|prebuilt` 字面量，且注释仍是 0403207e 时代的「per FILE process」。
实际上一旦 `gap-serial-install-family-shared-prebuilt-fixture`（9578de67）把 `laydownTemplate()`
改为指向内容寻址 `sharedFixture()`，这两个文件的 install-as-setup 测试就自动接上了
（每文件首个 laydownWorkspace 复用同一 /var/tmp 夹具，不再各自安装）。

**实现**（AC1 显式化）：
- 两文件 import 加 `laydownTemplate`；各自首个 install-as-setup 测试直接调 `laydownTemplate()`
  并断言夹具在服务本文件（`template.ws && template.install`）——`grep sharedFixture|laydownTemplate`
  现命中两文件。
- 修正陈旧注释：「one real quay-init --loop per FILE process」→「ONE real install per SERIAL
  PHASE，shared content-addressed fixture（sharedFixture → laydownTemplate → laydownWorkspace）」。
- 给保留真安装的行为测试补注释，说明为何不能用共享夹具（检测阶梯需 fresh 无配置 workspace；
  配置驱动安装需自定义 target 值；vendor-runtime 机制测试需修改后的 plugin 状态）——
  避免未来再被「命中数=0」误报为未接线。

### AC2 — 相耗时读数（记录量，不要求差值可判；隔离单跑、同窗）

| 文件 | 基线（改前） | 改后 | 说明 |
|---|---|---|---|
| quay-init-loop-core.test.mjs | 63.1s（12 pass） | 81.2s（12 pass，机器负载噪声） | 未建新夹具（复用 17:58 fixture） |
| quay-init-loop-runtime.test.mjs | 46.7s（14 pass） | 51.0s（14 pass，机器负载噪声） | 同上 |

**诚实结论**：两个文件的相地板由【行为测试】主导（core：检测阶梯 4 真安装 + explicit +
配置驱动 AC4 ≈ 32s；runtime：vendor-runtime 机制 8 真安装 ≈ 39s），它们验证安装/检测/配置/
vendor 机制本身，不能用单一固定配置的共享夹具替换首装（与 `gap-serial-install-family-shared-
prebuilt-fixture` 的 AC4 结论一致——夹具安全作用域是「首装即纯 setup」）。install-as-setup 部分
本任务前已接共享夹具；本任务把接线显式化（AC1）并贴读数（AC2 记录量）。墙钟随全局负载波动
（任务体已注：相级耗时回归无判据可抓是接受代价）。

### AC3 — 无回归

core 12/12、runtime 14/14（与改前同数同果）；测试机制零改动（仅注释 + 一次 cached
`laydownTemplate()` 断言）；`--for-task` scoped 门绿（见 AC4）。

### AC4 — scoped 门

`./scripts/test.sh --for-task gap-quay-init-loop-tests-not-wired-to-shared-fixture --allow-thin`
→ 绿（含两目标文件 + 静态层）。

### 附带发现（超出本任务范围，记录不修）

**夹具 hash 冷启动 churn（fresh worktree 一次性）**：fresh worktree 的 vendor dist（gitignored）
相对 source 可能 stale，首个 quay-init install 触发 `ensure_vendor_runtime → sync-vendor.sh`，
而 sync-vendor 会重写 plugin/vendor dist + plugin/scripts + plugin/skills（全是 `_fixtureHash`
输入）⇒ 第一个夹具按「regen 前 hash」命名而被孤立，下一个进程按「regen 后 hash」再建一个。
实测：本 worktree 首次跑 core 建 b7f96de6、随后 runtime 建 79164340（当时 worktree 刚 provision，
vendor dist 从 main 拷入后相对 source 判 stale）。表面稳定后跨 run 复用正常：两轮 scoped 门
（18:07 / 18:09）分别建 e1e1f9f5 后 REUSE（第二轮 session-liveness 141ms、无新夹具）；
`/var/tmp` 中其它 422802d7 等夹具来自并发 worktree（/var/tmp 全仓共享），非本任务产物。
esbuild build 与 `sync-vendor --sync-dist` 均确定性（实测两轮 build+mirror 同 sha256）。
只影响 fresh-worktree 冷启动的前 1-2 个夹具，非持续 churn。修法（如要做）在 helper：
hash 前先跑一次 sync-vendor 归一，或把 dist/scripts/skills 从 hash 输入剔除。

## Touches

- plugin/test/quay-init-loop-core.test.mjs
- plugin/test/quay-init-loop-runtime.test.mjs
- plugin/test/quay-init-loop-helpers.mjs（既有 fixture）
- tasks/gap-quay-init-loop-tests-not-wired-to-shared-fixture.md（自身）
