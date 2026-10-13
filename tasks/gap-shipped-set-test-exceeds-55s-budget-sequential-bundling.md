---
id: gap-shipped-set-test-exceeds-55s-budget-sequential-bundling
title: AC-334 的常驻判据自身零余量：shipped-set.test.mjs 实测 54.96s 对 55s 上限（余量 0.04s /
  0.07%），因测试三次装配真实产物、而每次装配 86% 的时间花在 bundleEntries 对 115 个入口的串行 esbuild 调用上
status: ready
labels:
  - gap
  - defect
  - priority:p1
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-334
---
## Proposal

AC-334（GOAL-029，人 2026-10-07 裁定）的判据要求在 **55 秒内**跑通 `plugin/test/shipped-set.test.mjs`。
本轮**直接实跑**该判据（AC 记录里那条命令，`timeout 55 node --experimental-strip-types --test plugin/test/shipped-set.test.mjs`）：
`rc=0`、10 pass / 0 fail、墙钟 **54.96s** —— 占预算 **99.93%**，余量 **0.04 秒**；同一轮 driver 观测到 `rc=124`
（`CAUSE=shipped-set-test-too-slow`）。即：**"发布产物不含测试/夹具/突变用例"这个保证本身仍然成立**，
不成立的是这条【常驻判据】自己的"便宜" —— 0.04s 的余量不是余量，是一枚硬币。

### 根因（实测，非推断）

测试**三次**装配真实产物：`before()` 的干净产物一次，外加**两次完全相同**的 full-tree（去掉 rsync 排除表）产物。

| 装配 | 位置 | 实测 |
|---|---|---|
| 干净产物 | `before()` | ~17.0s |
| full-tree（去排除表） | `test("AC2 control: reverting the rsync exclusion list …")` | 17,788ms |
| full-tree（去排除表，**同一份活**） | `extractArtifactUnfiltered()`，被 reanchor 与 CLI 两个测试共用 | 17,855ms |

每次装配 ~17.0s 之中，**14.66s（86%）是 `build-plugin-dist.mjs "${WORK}"` 这【一次】调用**
（`plugin/scripts/publish-dist-branch.sh:172`）：`buildPluginDist` → `bundleEntries`
（`packages/quay/scripts/build-plugin-dist.mjs:669`）用 `for (const rel of entries) { … await esbuild.build({ entryPoints: [entryAbs], bundle: true, … }) }`
**逐个**入口打包，实测 **115 个入口**（113 scripts + 2 gate-scripts），≈127ms/个。
一次 publish 的其余**全部**步骤合计 ≤0.82s（rsync、两个 TS-strip node、prune 19 个 .sh、rewrite 53 个 invoker、
dist-closure 校验、git commit）。

⇒ ~54s 的测试里，**约 44s 是把同一份未改动的源码，用同一个 115 入口的串行 loop 打包了三遍**。
探针读数（本机实测）：单次 publish 分步 `115 bundled entrypoints` = **14,660ms**；
同一组 115 入口在 /tmp stub 副本上重跑等效循环 —— 串行 **14,115ms**、并发 width=4 **4,286ms**、width=8 **2,341ms**。

### 为什么上一次的修复没有守住

`gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet`（**done**，同样挂 `goal_ac: AC-334`）
在 2026-10-07 authored 了这个测试与这条 55s 预算，但它把预算写在**未经测量的余量**上：测试诞生时就约 54s 对 55s 上限，
当轮"通过"靠的是 <1s 的间隙。此后产物只增不减（2026-10-09 +2 文件；2026-10-13 +15 文件，discovery engine 随产物发出），
每次 publish 的打包量随之上升，"通过"于是变成抛硬币（本轮实测余量已降到 **0.04s**）。⇒ 本次不再把预算当作可依赖的常量，
而是**把余量本身做成可核对的读数**。

同形先例（机制不同，仅作判据口径参考）：`gap-select-preflight-json-real-store-too-slow`（done）——
同样是"测试对预算的余量≈0 ⇒ 必然 flaky"，同样以**余量**而非绝对速度为缺陷。

### 修法（两条路，均已实测；执行者自选，但必须达成 AC 里的余量要求）

- **(A) 去掉重复装配**：上表第 2、3 行是**逐字相同**的活 —— 同一个 stub、同一处 `'"${RSYNC_EXCLUDES[@]}" '` 变异、
  同样 `--no-build`，产出同一份 full-tree 产物。3 次 → 2 次，直接省 ~17s（→ ~37s）。第 3 行已 memoize，第 2 行是独立的第二次。
  ⚠️ 单靠 (A) 到不了 AC 的 30s 线，需与 (B) 或 (C) 并用。
- **(B) 把 `bundleEntries` 的串行 `await` 循环改成有界并发**（esbuild 的 JS API 支持并发 `build()`；
  每个入口的 options 不变，产物应逐字节不变）。单此一项即可把每次 publish 的 14.7s 压到 2.3–4.3s。
  ⚠️ 必须实测**峰值内存**（本仓库有 suite 内存包络）与**产物逐字节一致**（见 AC4）。
- **(C) 纯测试侧**：把剩余两次 publish 并发跑。同样按 AC4 验产物一致。

⛔ **不许把这条判据"修"成通过**：不得把 RED 控制退化成 fixture 重实现（该文件的设计前提是"在真实产物上做两向控制"）；
不得改动 AC 记录里的 `criterion` 文本（那是 AC 记录变更，不在本任务范围）。

## AC
- [x] AC-334 的判据实跑退出 0 且**不为 124**，完成记录贴出原始输出：`timeout 55 node --experimental-strip-types --test plugin/test/shipped-set.test.mjs`（等价于 AC 记录里那条 criterion）。
- [x] 余量做成读数：同一宿主上 `time` 实测该测试墙钟 **≤ 30s**（余量 ≥1.8×），完成记录贴出 `real` 行。
- [x] 两向控制未被削弱：`grep -c 'AC2 control' plugin/test/shipped-set.test.mjs` ≥ 2；完成记录贴出【把 `publish-dist-branch.sh` 的 rsync 排除表恢复成全量后该测试转红】的实跑输出（`rc≠0`，失败信息指名 `test` / `fixtures` / `scripts/checker-mutation-cases` 之一）。
- [x] 产物未因提速而改变：改动前后各装配一次，`plugin/shipped-set-baseline.json` 的 `shipped`（`files` 与 `shLines`）仍与产物自身读数一致；若 `files` 变化必须给出逐项差异并说明原因（默认期望不变、**不 reanchor**）。
- [x] 同一条 `bundleEntries` 路径的其它消费者未被改红：`node --experimental-strip-types --test packages/quay/test/npm-pack-e2e.test.mjs plugin/test/shipped-shell-reachability.test.mjs` 退出 0。
- [x] `bash scripts/test.sh --for-task gap-shipped-set-test-exceeds-55s-budget-sequential-bundling` 退出 0 且执行 ≥1 个测试文件。

## DoD
真实落地：AC-334 的判据在本机**实跑**变绿，且**余量有原始读数支撑**（不是"测试存在"、也不是"fixture 绿"）。
完成记录里同时贴出：①判据命令的退出码；②`time` 的 `real` 行；③改动前后产物 `files`/`shLines` 的对照读数；
④两条 RED 控制的实跑输出。`bundleEntries` 若改成并发，须另贴**峰值 RSS** 读数（本仓库有 suite 内存包络）
与"并发产物 vs 串行产物一致"的比较结果（对同一 WORK 树两次装配后 `diff -r`，或两次产物的 tar 哈希相等）。
仅把 55s 上限调高、或把控制削成 fixture、或只让本测试变快却使同路径的 npm-pack-e2e / shipped-shell-reachability 转红，均不算完成。

## 完成记录

修法 = **(B)**：`bundleEntries` 里逐个 `await esbuild.build()` 的串行循环改成**宿主推导宽度的有界并发池**
（`packages/quay/scripts/build-plugin-dist.mjs`，本任务唯一改动的产品文件；宽度 = `os.availableParallelism()`，只被入口数封顶，
⛔ 不写并发字面量 —— CLAUDE.md 硬规则 4 推论二）。**未做 (A)/(C)**：单 (B) 已把判据从 57.7s 压到 14.9s，
不需要再削减两条 RED 控制各自独立的那次真实装配（保留两次独立装配，控制面更强）。

**根因的一处实测更正（与 Proposal 的推断不同，按读数写）**：每个 `build()` 的那 ~110ms **不是"入口多/包大"**，
而是**装配树所在文件系统**的每次调用常数。同一台机、同一个 esbuild，对**单行模块** `export const x = 1;` 连打十次：

| 位置 | 每次 |
|---|---|
| `/tmp`（ext4, /dev/vda2；tmp root 目录下约 18 万条目） | **116ms** |
| `/data`（xfs, /dev/vdb） | **14ms** |

真实 publish 在 `resolveTmpRoot()` 选出的 `/tmp` 下的 throwaway 树里装配，所以每次 publish 都吃慢的那一侧
（115 × ~127ms ≈ 15s/次）。这也解释了为什么"把循环改成并发"能线性收敛：那部分是 I/O 等待，不是 CPU。

### ① 判据退出码（AC 记录 `criterion` 原样脚本实跑）

```
AC-334 criterion: PASS (rc=0, not 124)
```
内层 `timeout 55 node --experimental-strip-types --test plugin/test/shipped-set.test.mjs` → `rc=0`，`ℹ tests 10 / pass 10 / fail 0`。

### ② 余量读数（同一宿主的 `real` 行）

```
real	0m14.943s
```
同宿主、同命令、改动前：`real 0m57.670s`。⇒ 对 55s 预算余量 **3.68×**；对 AC 的 30s 线 **2.01×**（AC 要求 ≥1.8×）。

### ③ 产物对照（同一 stub 树；PRE = develop 版 `build-plugin-dist.mjs`，POST = 本改动）

| 装配 | files | shLines | bytes |
|---|---|---|---|
| PRE（串行，develop 版） | 280 | 7345 | 59,270,830 |
| POST（并发池） | 280 | 7345 | 59,270,836 |
| 当前工作树产物（vendor 补齐后） | 281 | 7345 | 59,415,269 |
| `plugin/shipped-set-baseline.json` 的 `shipped` | 281 | 7345 | 58,847,285 |

⇒ **`files` 未因改动变化（280 = 280）、`shLines` 未变（7345 = 7345）**；vendor 补齐后的产物读数 281 / 7345
与 `baseline.shipped` 的 281 / 7345 **逐位相同**，`judgeShippedSize` 的 `over` 为空。**未 reanchor。**
PRE/POST 那两跑读到 280 而非 281，原因不在改动：`.worktreeinclude` 只声明 `/plugin/vendor/*/dist/*.js`，
`dashboard-kernel-vectors.json` 是后来由 vendor 刷新带入工作树的（补齐后即 281）。
`bytes` 未被门禁（esbuild 的 per-module 路径注释让字节总数随装配树位置变，见 `SIZE_GATED_AXES`），差 6 字节即该注释。
逐文件 sha256：PRE/POST 集合 **0 增 0 删**，仅两类 1 行差异 —— esbuild 的随机 throwaway 目录名注释，
以及**改动前就已存在**的 `__toESM(require_dist(), 1)` / `__toESM(require_dist())` 元数抖动：
用 develop 版串行循环连跑两次同样复现（3 个文件各差这 1 行），与并发无关。

### ④ 两条 RED 控制

- 文件内控制未被削弱：`grep -c 'AC2 control' plugin/test/shipped-set.test.mjs` = **2**。
- 源码级控制（把 `publish-dist-branch.sh` 的 rsync 排除表恢复成全量后实跑该测试）→ **rc=1**，失败信息指名三个禁项：

```
✖ AC2: the published artifact carries no dev-only content, and its totals are within the recorded clean build
  AssertionError: the artifact must carry no rule-excluded path (619 found)
  + 'fixtures <- fixtures/'
  + 'test <- test/'
  + 'scripts/checker-mutation-cases <- checker-mutation-cases/'
```
（变异用 `cp` 备份还原，还原后 md5 `a8ba5d821c04d238be10119176f77357` 与备份一致。）

### ⑤ 并发 ⇒ 峰值 RSS + 并发/串行逐字节对照

- 峰值 RSS（`/proc/self/status` `VmHWM`，同一 126 入口树，同一进程内逐宽度实测）：
  width=1 **113MB** · 4 → 113MB · 8 → 114MB · 16 → 113MB · 32 → 113MB · 115 → **112MB** ⇒ **宽池不比串行多占内存**。
- 整次 publish 的 maxRSS（`/usr/bin/time -v`）：串行 **107MB** → 并发池 **106MB**。
- 同一棵 WORK 树、同一入口集：`bundleEntries(concurrency=1)` 与 `bundleEntries(concurrency=<host>)` 各装配一次，
  126 个产物的 sha256 集合 **0 增 0 删**，返回的 outfiles 数组逐项相同（保持输入序）。
- 整次 publish 耗时：串行 **17,486ms** → 并发池 **3,952ms**。

### ⑥⑦ 同路径其它消费者与 scoped 门

- `node --experimental-strip-types --test packages/quay/test/npm-pack-e2e.test.mjs plugin/test/shipped-shell-reachability.test.mjs` → **rc=0**（19 pass / 0 fail）。
- `bash scripts/test.sh --for-task gap-shipped-set-test-exceeds-55s-budget-sequential-bundling` → **rc=0**（73 pass / 0 fail），
  实跑了 `plugin/test/shipped-set.test.mjs` 与 `plugin/test/shipped-shell-reachability.test.mjs` 两个测试文件（≥1）。
- 反漂移 Touches 检查：`ANTI-DRIFT OK — 1 actual file(s), all within declared Touches`。

## Touches
- `plugin/test/shipped-set.test.mjs`
- `packages/quay/scripts/build-plugin-dist.mjs`
- `plugin/shipped-set-baseline.json`
- `packages/quay/test/npm-pack-e2e.test.mjs`
- `plugin/test/shipped-shell-reachability.test.mjs`
- `tasks/gap-shipped-set-test-exceeds-55s-budget-sequential-bundling.md`
