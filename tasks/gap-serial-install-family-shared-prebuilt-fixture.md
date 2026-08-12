---
id: gap-serial-install-family-shared-prebuilt-fixture
title: "serial 相真安装族 12 文件每文件一次完整真安装（r266 sum=865s/1241s）⇒ 共享预建安装夹具（一次安装 + cp -al 硬链接/tar 解包复用），【先测再改】：先测单文件安装 setup 占比（加计时不改行为），按 70% 可省估 serial sum 1241→636s、墙钟 620→318s（-300s，最大杠杆）"
status: done
labels:
  - gap
  - defect
  - performance
parent: null
children: []
extra: {}
---
**type:** execution

> **翻 done（人 2026-08-12 00:4x 裁定，A 组）**：代码已合入 integration 且被 r308-green 覆盖，AC18 复核 measure 通过。

## Proposal

**serial 相（r266 sum=1241ms，墙钟 620s 占整轮 40%）里，真安装族 12 个文件每个都跑一次完整真安装（各自建自己的临时根 `/tmp/install-e2e-XXXX`、`/tmp/drift-XXXX`），sum=865s。它们共享同一个「装一次就能复用」的形状——一次安装 + 每文件 `cp -al` 硬链接或 tar 解包复用，隔离性不降，serial sum 1241→636s、墙钟 620→318s。**

### 实证（manager 2026-08-11 03:4x，r266 相位分解 + ps 实测）

- **r266 serial 相**：`__GROUP__ concurrency=2 files=22 sum_ms=1314179`（≈1241s 中真安装族占 865s）。
- **真安装族 12 文件 + 各自耗时（ms）**：quay-init-loop-core 112.9 / loop-runtime 90.8 / drift-report 89.8 / quay-init 79.9 / check-drift 74.6 / loop-vendor 66.8 / loop 53.5 / loop-driver 51.9 / laydown-closure 45.1 / tmux-detection 30.5 / install-config-driven-e2e 169.1。
- **ps 实测**：每个文件各自建临时根 `/tmp/install-e2e-XXXX` / `/tmp/drift-XXXX` —— 12 次完整真安装，而非一次安装多次复用。
- **成本结构参数（manager 新解出）**：main 相每文件 `t = W + C×(c/4)`；r266 wall4=636s、r268 wall8=568s 两点解出 `nW=543 文件秒（等待）、nC=2000 核秒（CPU）`，合计 2543=实测 sum ✓ ⇒ main CPU 占比 79%，4 核地板 nC/4=500s。**内存不是约束**（每 node --test 47-88MB，8 进程 0.3GB，机器空闲 10.4GB）。
- **【先测再改】**：先测单个文件里「安装 setup」占它总耗时的比例——建议在一个文件上加一次计时（不改行为），这个比例是整条杠杆的量纲。manager 按 70% 可省估 serial sum 1241→636s、墙钟 620→318s（约 -300s，三条杠杆里最大）。

### 选定机制方向（实现归 inner，判定归 outer）

**共享预建安装夹具**——一次安装 + 每文件复用，隔离性不降：
1. **夹具形态**：一次真安装到共享夹具目录（如 `.quay/install-fixture/` 或测试临时根），每个文件用 `cp -al`（硬链接，快且省空间）或 tar 解包复制出独立的临时根再测——**隔离性不降**（每个测试仍操作自己的根，只是 seed 内容来自共享夹具）。
2. **【先测再改】闸门**：先加计时（不改行为）量出单文件安装 setup 占比，把比例写进本任务证据；占比显著（≥50%）才动夹具，否则改测法。
3. **同一族只建一次夹具**：12 文件共享同一夹具构建；夹具构建本身进 serial 相（它是一次真安装），各文件从夹具 cp -al 出独立根。
4. **验证**：serial 相 sum 实测下降（目标 1241→636s）；隔离性回归（每个测试的临时根互不可见；既有断言不破坏）。

**验证锚**：修后 (a) 单文件安装 setup 占比已测（贴计时数据）；(b) serial 相 sum 实测下降；(c) 隔离性测试仍绿；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 r266 serial sum=1241s / 真安装族 12 文件各自耗时 + sum=865s / ps 实测各自临时根（本任务 Proposal 已含）
- [x] AC2: **先测再改**——单个文件加安装 setup 计时（不改行为），量出 setup 占比，贴数据；占比 ≥50% 才动夹具
- [x] AC3: **共享夹具**——一次真安装 + 每文件 `cp -al`/tar 解包复用，隔离性不降（每测试独立根）
- [ ] AC4: **serial sum 实测下降**——serial 相 sum 从 1241s 显著下降（目标 ≤636s），墙钟 620→318s 量级（单文件实测下降已证；serial sum 受负载污染未达目标，见 Evidence——判定归 outer）
- [x] AC5: **既有不回归**——隔离性测试绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：serial 相 `__GROUP__` sum_ms 实测贴出（对比 1241s）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/test/ 真安装族 12 文件（quay-init-loop-core / loop-runtime / drift-report / quay-init / check-drift / loop-vendor / loop / loop-driver / laydown-closure / tmux-detection / install-config-driven-e2e 等）——夹具复用改造
- plugin/scripts/ 或测试 helper（共享安装夹具构建 + cp -al/tar 复用）
- plugin/test/known-load-sensitive.test.mjs（若夹具涉 load-sensitive 标注）
- tasks/gap-serial-install-family-shared-prebuilt-fixture.md（自身：勾 AC + 贴证据）

## Contract

measure   serial_sum_ms_after = `grep -oE '__GROUP__ concurrency=2 files=[0-9]+ sum_ms=[0-9.]+' <serial相日志> | tail -1` 的 stdout 中 sum_ms 数字
band      serial_sum_ms_after <= 636000（serial sum 从 1241s 降到 ≤636s，约 -300s）
invariant install_setup_measured_first = 1（先加计时量 setup 占比再改夹具）
invariant isolation_preserved = 1（每测试独立临时根，隔离性不降）
invoke    `grep -oE '__GROUP__ concurrency=2 files=[0-9]+ sum_ms=[0-9.]+' <serial相日志>`（贴 sum_ms 对比 1241s）
control   先测占比再改；serial sum 下降；隔离性不降；既有不回归
resume    计时测量 / 夹具构建 / 复用改造 / 验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: 人指示应用三条杠杆优化 suite；manager 03:4x 解出成本结构（nW=543/nC=2000，main CPU 79%，内存非约束）。杠杆 1（最大，约 -300s）= serial 真安装族 12 文件共享预建夹具。先测再改（setup 占比闸）。实现归 inner，判定归 outer

## Evidence（inner 2026-08-11，worktree `gap-serial-install-family-shared-prebuilt-fixture`）

### AC2 — 先测再改：drift-report 单文件安装 setup 计时（不改行为）

在 `plugin/test/quay-init-drift-report.test.mjs` 加计时（仅包一层 Date.now() 记录 `--loop` 安装耗时，
断言/流程零改动），跑 `node --test --test-concurrency=1 plugin/test/quay-init-drift-report.test.mjs`：

```
__INSTALL_SETUP__ install_ms=69527 install_count=7 total_ms=84142 ratio=82.6%
ℹ tests 6  ℹ pass 6  ℹ fail 0  ℹ cancelled 0
```

- **setup 占比 = 82.6%**（≥50% 闸，通过）——7 次 `--loop` 真安装占 69.5s / 文件总 84.1s。
- 依据 manager 70% 可省估：serial 1241→636s 量级成立。夹具方向确认。

### AC3 — 共享预建安装夹具（`plugin/test/quay-init-loop-helpers.mjs`）

机制（`sharedFixture()` + `laydownTemplate()`）：
- **一次真安装/每 serial 相**：内容寻址夹具 `/var/tmp/quay-install-fixture-<sha1(plugin scripts+loop+init skill+vendor bundles+pkg)>/`，
  只读（chmod a-w 整树）。跨文件单飞锁（原子 mkdir）+ 就绪 marker；并发文件轮询等待，不重复安装；
  stale 锁（>120s）可抢占。
- **每测试独立根**：`laydownWorkspace()` 从夹具 `cp -a` 出可写副本（保软链+权限），重写 config 绝对路径 +
  全新 worktree_root——隔离性不降（R3/R8/R6 不变，夹具在 /var/tmp 内容寻址路径，helper 非 `.test.mjs` 不被隔离扫描）。
- **cp -al 硬链接未采用**：硬链接共享 inode，副本 `chmod u+w` 会把只读夹具本身写权限剥掉，破坏隔离；`cp -a`
  每次 ~50-150ms，安装才是成本（AC2 实测 82.6%）。
- 缓存跨 run 复用（同一插件面 hash 不变则复用上次夹具），插件变则新 hash 新夹具，旧夹具在 /var/tmp 自然孤立。

已转换的文件（安装即纯 setup 的首装改用夹具）：
- `quay-init-loop-core` / `loop-runtime` / `loop-driver` / `runtime-landing`（原已用 `laydownWorkspace`，
  现在跨文件共享同一夹具，每文件不再各自安装）
- `quay-init-drift-report`（4 个首装测试）
- `quay-init`（AC2 首装 + AC3 default 块）
- `quay-init-laydown-closure`（AC1）

实测（concurrency=2 同跑 7 个受影响文件）：`ℹ tests 61 / pass 61 / fail 0 / cancelled 0`，仅建 1 个夹具。
drift-report 文件 84.1s → 46.7s（含本文件内建夹具 ~10s；serial 相共享后更低），setup ratio 82.6% → 54.1%。

### AC4 — serial 相 sum（贴 `__GROUP__`，对比 r266 1241s）

**实测受机器负载污染，不可作为洁净基线**：serial 相实跑期间 load average 8.73（多个 claude 会话 40.8%+28.8%+21.1%
CPU + 并发 full-suite verification-round），`__GROUP__ concurrency=2 files=22 sum_ms=1867603.9`（≈1868s）。同轮
`__PERFILE__` 显示**未触碰的文件同幅膨胀**（check-drift 74.6s→186.7s +150%、install-config-driven-e2e
169.1s→383.8s +127%、tmux-detection 30.5s→39.1s +28%）——证明膨胀是环境负载，不是本任务改动。
r266 基线（1241s）的测量条件不可复现。

**单文件定向实测（隔离跑、低负载）确证下降**：
- `quay-init-drift-report.test.mjs`：84.1s → **46.7s**（含本文件内建夹具 ~10s；serial 相共享后更低）；
  setup 占比 82.6% → 54.1%（AC2 计时）。
- 7 个受影响文件（core/runtime/driver/runtime-landing/drift-report/quay-init/laydown-closure）concurrency=2
  同跑：`tests 61 / pass 61 / fail 0`，仅建 1 个夹具。
- **诚实结论：AC4 的 ≤636s 目标本轮未达**——剩余大头是安装行为测试（install-config-driven-e2e / check-drift /
  loop-vendor / loop / tmux-detection）验证安装/升级/漂移机制本身，不能用共享夹具替换首装（夹具是单一固定配置的
  安装树，这些测试需要多变配置的真实安装）；共享夹具的安全作用域是 8 个「首装即纯 setup」的文件。串行 sum 的
  绝对判定归 outer（需洁净负载下的全量套件测量）。

### AC5 — 隔离性 + `--for-task` scoped 门

- **隔离性**：`test-isolation-check`（scoped static 层）PASS——44 violations 全部 baselined、零新增；
  夹具在 `/var/tmp` 内容寻址路径、helper 非 `.test.mjs` 不被隔离扫描，R3/R8/R6 不变。
- **`--for-task` scoped 门**：`./scripts/test.sh --for-task gap-serial-install-family-shared-prebuilt-fixture --allow-thin`
  → test-isolation-check PASS + tick-core-static-check PASS + known-load-sensitive 22 tests pass 0 fail。
  （`--allow-thin` 因任务 Touches 含目录级条目 `plugin/test/`/`plugin/scripts/`，selector 只解析出 1/4 测试文件；
  静态层已全绿。）
- **受影响文件不回归**：61/61（7 个转换文件）+ 单独验证的 drift-report 6/6、loop-core 12/12、loop-runtime 14/14、
  loop-driver 15/15。
