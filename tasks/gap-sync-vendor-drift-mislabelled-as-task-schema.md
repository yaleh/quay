---
id: gap-sync-vendor-drift-mislabelled-as-task-schema
title: M136 fails deterministically and its error names a file that does not
  exist — the drift is the vendored dist bundle
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`M136 (DIR-070-A): sync-vendor.sh --check dynamic scanning …` 在 master 上失败。它被判定为
「既有 vendor-sync flaky」并据此放行了 M243 的收尾。**两处判定都不对。**

### 一、它不是 flaky，是确定性的

连查三次，每次恰好 1 行 DRIFT：

```
第 1 次: DRIFT 行数 1
第 2 次: DRIFT 行数 1
第 3 次: DRIFT 行数 1
```

真正 flaky 的检查不会这样。**「flaky」这个定性会让它被无限期忽略**，而它每次都失败。

### 二、错误消息指向一个不存在的文件

```
[sync-vendor --check] DRIFT: vendor/task-schema.ts differs between source and destination
```

`plugin/vendor/task-schema.ts` **不存在**（`plugin/vendor/` 下只有 `quay/`）。

成因在 `plugin/scripts/sync-vendor.sh:82`：

```bash
cmp_or_report "vendor/task-schema.ts" \        # ← 标签
  "${SRC}/dist/quay.js" "${DEST}/dist/quay.js" # ← 实际比对的文件
```

**标签与实参不符。** 对照同一函数的其它调用（第 103、123、129 行），标签都与实参一致——
只有第 82 行是从下方 task-schema 段复制粘贴留下的。

**这个错标是它被误读三轮的直接原因**：读到 `task-schema` 就往「task-schema 组是 expected-diff、
所以是既有容差问题」上想，而真正漂移的东西根本没被提到。

### 三、真正漂移的是 vendored dist bundle

```
packages/quay/dist/quay.js        1,313,034 字节   19:13:16
plugin/vendor/quay/dist/quay.js   1,315,188 字节   19:04:25
```

字节数不同——vendored 副本是**旧源码状态**的产物，源码今天改了很多次而它从未重新同步。

**为什么现在每次都可见**：B5-1 让 `scripts/test.sh` 在任何测试前重建 `dist/quay.js`
（`scripts/test.sh:154`）。源侧因此永远是最新的，于是 vendored 副本的陈旧**从偶发变成永久可见**。
这不是 B5-1 的缺陷——它让一个本来就存在、只是间歇暴露的不同步变成了确定性失败。

## Chosen mechanism

**先修标签，再修同步；顺序不能反。**

1. **修 `sync-vendor.sh:82` 的标签**，改为它实际比对的东西（`vendor/quay/dist/quay.js`）。
   这一步单独有价值：在标签错着的时候修同步，下一个人仍会被同一条消息误导。
2. **决定 vendored bundle 的同步时机**。它是生成镜像不是第二份真相
   （`sync-vendor.sh` 头注释自己写的）。源侧既然每次跑测试都重建，vendored 副本要么
   （a）在同一时机一并更新，要么（b）明确声明为「仅在发布时同步」并把 `--check` 的这一项
   改为发布前检查而非每次套件都跑。**两条路都可以，但必须选一条并写下来**——现在是
   两边都不成立：既不自动同步，又在每次套件里硬检查。
3. **给 M136 一个确定的归属**：它现在既不在任何任务名下，也没有「已知失败」记录，
   于是每次有人看到红都要重新调查一次。今天就查了三轮。

**不做**：不把 M136 改成 skip，不降级为 advisory。本仓库已有四次「造了检测机制 → 它正确报警 →
警报无人处理」的先例（RED 测试被改 skip、golden replay 被当预存失败、clause-14 降为 advisory、
既有失败记在已 done 的任务体里）。**这次它报的是真事**：vendored 镜像确实陈旧。

## Contract

```
# 回填（gap-dispatch-gate-has-no-checklist-and-no-trace AC4）：外层两次介入——「M243 语料修复」的
# 否掉 sync-first（control），「M136 第三轮」的消除干扰源（invariant）+ 负控制（control）。
measure  drift        = `bash plugin/scripts/sync-vendor.sh --check` 的 DRIFT 行数   # 确定性 1 行，非 flaky；DRIFT 消息指向真实文件
band     clean_ok     = 0 DRIFT 行数                                                # 连跑 3 次一致才算确定性消除
invariant shared_dist = 无测试中途改写共享 packages/quay/dist/quay.js               # 第三轮：消除干扰源，非让 --check 追同步
invoke   `sync-vendor.sh --check`                                                  # 改后干净树应 CLEAN
control  `--check` 前先 `--sync-dist` ⇒ 永不失败 = 掩盖；--check 必须只读              # 否掉 sync-first（外层裁定 23:0x）
control  改脏 vendor 副本 ⇒ 全量套件必须红                                          # 负控制：修法不是掩盖
resume   n/a: 单次检查无中途产物
```

## Dispatch review

> 回填：外层两次介入的留痕。

reviewer: outer
at: 2026-08-02T23:05:00Z
changed: 1. 否掉「--check 前先 --sync-dist」——检查前先修好被检对象的检查永不失败＝掩盖（`control`）
         2. 第三轮定向：5 个写 dist/vendor 的文件里哪些必须写共享路径——一个都不必须；修法是消除干扰源（`invariant shared_dist`）
         3. 负控制：改脏 vendor → 全量套件必须红（`control`）

## Acceptance Criteria

- [x] AC1: `sync-vendor.sh:82` 的标签与实参一致；对照第 103/123/129 行的写法
- [x] AC2: 全部 `cmp_or_report` 调用逐个核对标签与实参是否匹配（第 82 行是复制粘贴错误，
      同类错误可能不止一处）
- [x] AC3: 修标签后重跑 `--check`，DRIFT 消息指向 `vendor/quay/dist/quay.js` 而非不存在的文件
- [x] AC4: vendored bundle 的同步时机被明确选定并写进 `sync-vendor.sh` 头注释：
      随测试自动同步，或仅发布时同步 + `--check` 相应调整
- [x] AC5: 选定方案落地后，干净树上 `scripts/test.sh` 的 M136 通过
- [x] AC6: 连跑 3 次 `sync-vendor.sh --check`，结果一致（证明确定性已消除而非转成真 flaky）
- [x] AC7: 任务体记录改前/改后的 DRIFT 输出原文
- [x] AC8: 测试带 `// @test-group product` 声明（`sync-vendor` 属产品打包路径）

## Definition of Done

- [x] AC3/AC6 的实测输出贴进任务体
- [x] `scripts/test.sh` 绿（M136 所在文件 34/34 通过；并发缺陷修正后针对性范围验证
      plugin-packaging + build-dist + npm-pack-e2e 并行（concurrency 8）连跑 8 次全绿；
      全量套件留给外层 fan-in）
- [x] 明确记录：**错误消息指向错误的文件，比缺少错误消息更糟**——它把调查引向了错误的方向，
      本次实测代价是三轮误判（内层两轮判为 flaky、外层一轮怀疑 M243 引入）

## Touches

- plugin/scripts/sync-vendor.sh
- experiments/quay-perpetual-stream/scripts/sync-vendor.sh
- scripts/test.sh
- plugin/test/plugin-packaging.test.mjs

## Execution record (2026-08-02, gap-sync-vendor-drift-mislabelled-as-task-schema)

### 同步时机决策：随测试自动同步（选项 a）

选定 **（a）随测试自动同步**，写进 `plugin/scripts/sync-vendor.sh` 头注释的
`SYNC TIMING` 块。理由：

1. vendored bundle 是**开发期实时消费**的产物——`plugin/.mcp.json` 让插件 MCP server
   从 `${CLAUDE_PLUGIN_ROOT}/vendor/quay/dist/quay.js` 运行；若只在发布时同步，
   开发期的 MCP server 会静默跑旧码。
2. 源侧每次跑测试都重建（`scripts/test.sh` 的 `build_dist_once`，B5-1），vendored 副本
   在同一时机一并更新，`sync-vendor.sh --check` 在测试里就不再是确定性假 DRIFT。
3. `--check` 仍是硬门（不清零、不降 advisory）：手动/发布前跑它仍会因真实陈旧而 fail。

落地：
- `scripts/test.sh` 的 `build_dist_once` 在重建源 dist 后调用
  `bash plugin/scripts/sync-vendor.sh --sync-dist`（新增的仅镜像 dist、不重建、不碰
  git 跟踪资产的模式），镜像失败即 fail-loud。
- 发布路径不变：`postinstall`（npm install）与 `publish-plugin-dist.yml` 仍走全量
  `sync-vendor.sh`。

### 第二个潜藏缺陷：M136 的脚本计数断言 27 !== 25

修好错标后 `--check` 首次 GREEN，随即暴露 M136 **另一个**从未跑绿过的断言：
`okCount = 27`（`OK (identical): scripts/` 行数）而期望值只从 `SYNC_SCRIPTS` 数组派生
（25）。成因：DIR-124-A2（M243）新增了**第二个** `scripts/` 标签的 `cmp_or_report`
循环（`A2_SCRIPTS`：workflow-event-schema.mjs、workflow-replay.ts），M136 的计数
派生没有跟进——它在 master 上被错标 DRIFT 短路（先挂在 exitOk 断言上），从未到过
这个计数断言，所以从未 GREEN。修法：期望值改为 `SYNC_SCRIPTS + A2_SCRIPTS`
两个数组条目数之和（仍是「从 sync-vendor.sh 自身数组派生」，未回到硬编码字面量）。

### AC2 全量 `cmp_or_report` 逐条核对结果

9 处字面调用点（其中 A2 fixtures 的 README.md 为条件调用），仅第 1 处（dist bundle）
错标，已修：`"vendor/task-schema.ts"` → `"vendor/quay/dist/quay.js"`。
其余 8 处标签与 src/dst 一致：`skills/${name}`（目录级标签，指向 author/execute 技能
对）、`task-schema/${name}`、`task-schema/gate-script-lib.sh`、`scripts/${s}.ts`
（SYNC_SCRIPTS）、`scripts/${s}`、`test/${t}`、`fixtures/workflow-replay/${c}/${f}`
（A2 fixtures events/expectations）、`fixtures/workflow-replay/${c}/README.md`（条件调用）。
无第二处错标。

### Touches 第二条路径核实：不存在

`experiments/quay-perpetual-stream/scripts/sync-vendor.sh` **不存在**（无文件、无符号链接、
无镜像）。repo 里唯一的 `sync-vendor.sh` 是 `plugin/scripts/sync-vendor.sh`；experiments/
scripts 下相关 symlink 都指向 `plugin/scripts/`（如 `select-tests-for-touches.ts`），
但 sync-vendor.sh 本身无 experiments 副本。故两条 Touches 实际收敛到同一文件，无需第二处修改。

### M136 归属记录

M136（DIR-070-A: sync-vendor.sh --check 动态扫描）此前不属于任何任务、无「已知失败」记录，
每次红都要重新调查（今日实测三轮误判：内层两轮判 flaky、外层一轮怀疑 M243）。
本次任务即其归属：根因是 `sync-vendor.sh:82` 复制粘贴错标（指向不存在的
`vendor/task-schema.ts`）+ vendored bundle 未随测试同步。修复后 `--check` 在干净测试树上
GREEN（M136 34/34 通过）。**错误消息指向错误的文件，比缺少错误消息更糟**——它把调查
引向错误方向。

### 改前 / 改后 DRIFT 输出原文（AC7 / DoD）

改前（错标 `vendor/task-schema.ts`，vendored 陈旧时）：

```
[sync-vendor --check] verifying vendor dist bundle ...
[sync-vendor --check] DRIFT: vendor/task-schema.ts differs between source and destination
[sync-vendor --check]   src: /tmp/quay-wt-syncvendor/packages/quay/dist/quay.js
[sync-vendor --check]   dst: /tmp/quay-wt-syncvendor/plugin/vendor/quay/dist/quay.js
[sync-vendor --check] FAIL: drift detected (see DRIFT lines above).
```

改后（标签已修，vendored 陈旧时——证明 AC3 消息指向真实文件）：

```
[sync-vendor --check] DRIFT: vendor/quay/dist/quay.js differs between source and destination
[sync-vendor --check]   src: /tmp/quay-wt-syncvendor/packages/quay/dist/quay.js
[sync-vendor --check]   dst: /tmp/quay-wt-syncvendor/plugin/vendor/quay/dist/quay.js
[sync-vendor --check] FAIL: drift detected (see DRIFT lines above).
```

改后（`--sync-dist` 已镜像，干净态——AC6 连跑 3 次一致）：

```
[sync-vendor --check] CLEAN: all files verified, no drift detected.
[sync-vendor --check] CLEAN: all files verified, no drift detected.
[sync-vendor --check] CLEAN: all files verified, no drift detected.
```

M136 实测：`scripts/test.sh --for-task gap-sync-vendor-drift-mislabelled-as-task-schema --allow-thin`
→ `plugin/test/plugin-packaging.test.mjs` 34/34 pass（M136 ✔）。

### 并发缺陷修正（coordinator 第二轮发现）

全量套件（`--test-concurrency=8`）下 M136 仍会失败（`must exit 0`），但隔离跑
plugin-packaging.test.mjs 34/34 绿、套件跑完后 `--check` 也干净。根因：
`packages/quay/test/build-dist.test.mjs`（test d，跑 `build-dist.sh`）与
`packages/quay/test/npm-pack-e2e.test.mjs`（before hook，跑 `package.sh`）会在测试**中途**
重建 `packages/quay/dist/quay.js`；esbuild 是**原地写**（truncate+write，实测文件在构建期间
经过 size 0 / 部分长度，全量套件负载下可延续数秒）。M136 的 `--check` 与它们并行时，`cmp`
读到写了一半的文件 → 假 DRIFT。`--sync-dist` 只在套件开头同步一次，覆盖不到「测试中途重建」。

**第一版修正（60×50ms=3s 有界重试）仍不够**：全量套件复跑仍挂 M136（5729ms），根因是负载下
重建持续时间超过 3s 预算，重试耗尽时源文件仍在写。改为**稳定性检测**：
`cmp_or_report` 在文件不同时观察源文件的 size/mtime——只要它在变，就说明重建进行中，**继续等**
（预算 200×50ms=10s）；只有源文件在连续多次读取间稳定、且尺寸接近完整（≥ 目标一半）仍然不同，
才判定为真 drift 并立即上报。构建是确定性的（连跑两次 sha256 相同），所以重建完成后源文件
必然回到与镜像一致 → 重试期间的 `cmp` 直接命中 OK。这既不掩盖真事（稳定全尺寸差异立即 DRIFT），
又对「并行重建中途」免疫。验证：
1. 干净树 `--check` CLEAN（常见路径零重试延迟）
2. 真陈旧 vendored（稳定全尺寸差异）→ DRIFT，exit 1（~0.67s，不掩盖）
3. 确定性撕裂读：源为部分尺寸 4s 后恢复 → CLEAN（等到稳定，~4.4s）
4. 确定性撕裂读：源为 size 0（truncate）3s 后恢复 → CLEAN（~3.3s）
5. coordinator 复现组合（plugin-packaging + build-dist + npm-pack-e2e，concurrency 8）
   连跑 **8 次全绿**（M136 ✔，fail 0）——这是本缺陷的针对性子集，全量留给外层 fan-in。

注：coordinator 列的 4 个重建 dist 的测试文件中，实测只有 `build-dist.test.mjs`（test d，跑
`build-dist.sh`）与 `npm-pack-e2e.test.mjs`（before，跑 `package.sh`）会写规范
`packages/quay/dist/quay.js`；`build-dist-smoke.test.mjs` 写临时树、`package-json-bin.test.mjs`
只读 manifest。但修复对任意数量的并发重建都成立。

### 跨文件状态干扰诊断（2026-08-02 22:50，外层假设验证）

**外层假设**：M136 全量红/隔离绿 ⇒ 与并发度无关，是**跨文件状态干扰，不是竞态**。5 个测试文件写
dist/ 或 vendor/，M136 通过 `sync-vendor --check` 读它们。

**验证**（主 checkout 配对跑）：
1. `plugin-packaging.test.mjs + plugin-vendor-standalone.test.mjs` 配对 → **M136 绿**（37/37）。
   核实 `plugin-vendor-standalone` 是**只读复制**（copyFileSync 到 mkdtemp 临时目录，不写回
   vendor/quay）——不是干扰源。
2. `plugin-packaging.test.mjs + build-dist.test.mjs` 配对 → **M136 绿**（38/38），但**跑后**
   `sync-vendor --check` 报 **DRIFT: vendor/quay/dist/quay.js differs**。

**机制确认**：`build-dist.test.mjs`（跑 `build-dist.sh`）重建 `packages/quay/dist/quay.js`（源侧），
但 `plugin/vendor/quay/dist/quay.js`（镜像侧）**不同步**。配对跑时 M136 的 `--check` 恰好避开重建
窗口所以绿；全量套件里 M136 与 build-dist 在不同文件进程**并行**，`--check` 撞上重建窗口 → 红。

**结论**：M136 全量红 = **源 dist 被并行测试重建、vendor 镜像不同步**，确定性（非竞态）、与并发度
无关。c4/c8 下都红（4vs8 任务 6/6 证实）与此一致。**subagent 第二轮修复（`cmp_or_report` 等源
稳定再判 DRIFT）未覆盖此路径**——它等的是「源文件稳定」，但重建完成后源与镜像仍不同（镜像没同步），
等到稳定也 DRIFT。

**真正的修法方向（外层裁定 2026-08-02 23:0x，否掉第一个选项）**：
- **✗ 不做**「`--check` 前先 `--sync-dist`」——检查前先把被检对象修好的检查永远不会失败，那不是
  检查是掩盖。今天已为「检测器正确报警却被处理掉」花了一整天（M136 flaky 两轮、错标三轮误诊、
  外层怀疑过 M243）。把它改成永远绿 = 丢掉一整天成果。**`--check` 必须保持只读。**
- **✓ 正确方向**：**消除干扰源**——不是让 `--check` 追着干扰同步，而是让那些中途重建共享产物的
  测试**不再改写共享产物**。build_dist_once 已在开跑前构建并 `--sync-dist` 过一次，之后仍不同步
  说明有测试文件中途又调 build-dist.mjs，改写了 `packages/quay/dist/quay.js` 这个其它测试正在
  依赖的共享状态。
- **第三轮先回答**：那 5 个写 dist/vendor 的文件（build-dist 2 处、build-dist-smoke 2、
  cli-entry 1、npm-pack-e2e 5、plugin-vendor-standalone 4）里，哪些**必须**写共享路径？
  猜测是**一个都不必须**——构建产物的测试完全可以构建到临时目录验证，而不是覆盖全仓共用的那一份。
  若如此，修法是让这些测试不再改写共享产物。
- **验收判据**：修完后 M136 在全量套件里**真的绿**（不是因为 --check 先同步过）。**负控制**：故意把
  vendor 副本改脏，跑全量，M136 必须红。负控制不通过 = 修法是掩盖不是修复。

### 第三轮修复（2026-08-02，干扰源消除：共享产物写入 → 测试自身临时目录）

**先回答问题：那 5 个写 dist/vendor 的文件里，哪些必须写共享路径？——一个都不必须。**

逐个核实每个写点（写 `packages/quay/dist/quay.js` 共享路径 vs 写 mkdtemp 临时路径）：

| 文件 | 写点核实 | 共享路径? | 处理 |
|---|---|---|---|
| `packages/quay/test/build-dist.test.mjs` | (a)(b)(c) `buildDist({outfile})` 写 tempTree；**(d) `bash build-dist.sh` 写 canonical `dist/quay.js`** | **test (d) 是** | test (d) 改用 `QUAY_BUILD_DIST_OUTFILE` env hook（新加，`QUAY_BUILD_DIST_ENTRY` 的孪生 hook）把 outfile 指到本测试 mkdtemp 目录，wrapper 本体照跑，写完删除 |
| `packages/quay/test/build-dist-smoke.test.mjs` | `buildDist({outfile: bundle})`，bundle 在 `mkdtemp/bundleRoot` 树 | 否 | 无需改 |
| `packages/quay/test/cli-entry.test.mjs` | `makeFakePkg` 全写 mkdtemp 假树 | 否 | 无需改 |
| `packages/quay/test/npm-pack-e2e.test.mjs` | before 跑 `bash package.sh`（内部 build-dist.sh）→ canonical `dist/quay.js`；其余写 scratch/temp | **before 是** | 把 package.sh 整个搬到 `mkdtemp` 的包树副本里跑（package.json+bin+src+scripts+README+LICENSE 复制 + node_modules 符号链接），tgz 在临时目录产出，装到 scratch 验证，after 清理 |
| `plugin/test/plugin-vendor-standalone.test.mjs` | 只读 vendor/quay，copyFileSync 到 mkdtemp | 否 | 无需改（已核实只读） |

结论与第 2 轮 coordinator 的猜测一致但更精确：**真正改写共享 `packages/quay/dist/quay.js` 的只有
build-dist.test.mjs test (d) 与 npm-pack-e2e.test.mjs before 两个写点**；build-dist-smoke / cli-entry /
plugin-vendor-standalone 本来就写临时目录（task 描述的「2/1/4 处写」是把临时目录写也计入了，逐写点核实后
它们不碰共享产物）。两处共享写点都已改为「构建到测试自己的 mkdtemp 目录，验证完删除」。

**`--check` 保持只读**：未改 `sync-vendor.sh --check` 任何逻辑（既未加 --sync-dist 前置，也未降级/跳过）。
build_dist_once 仍是套件开跑前构建源 dist + `--sync-dist` 镜像一次；此后不再有任何测试中途重建共享
`packages/quay/dist/quay.js`，所以 M136 的 `--check` 在并行套件里看到的源与镜像始终一致。

**全量套件验收（修后干净树）**：`scripts/test.sh`（concurrency 8）2298 tests，**fail 0**，M136 绿。不是
因为 --check 先同步过——修的是干扰源（共享产物不再被中途重写）。

**负控制（改脏 vendor → 全量必红）**：改脏 `plugin/skills/author/SKILL.md`（`--sync-dist` 不碰 git 跟踪的
skills；但 `--check` 扫它，且它是真实独立文件非符号链接，所以脏能存活到 M136 检查）→ 全量套件复跑，
M136 **必须红**。实测 `sync-vendor.sh --check` 报：

```
[sync-vendor --check] DRIFT: skills/author differs between source and destination
[sync-vendor --check]   src: .../packages/quay-native/skills/author/SKILL.md
[sync-vendor --check]   dst: .../plugin/skills/author/SKILL.md
[sync-vendor --check] FAIL: drift detected (see DRIFT lines above).
```

exit 1。全量套件（concurrency 8）复跑：**M136 ✖（fail 2 之一；另一个失败是「author/execute skills
byte-identical」——同一份脏文件被两个断言扫到，预期内）**。改脏后 `git checkout` 还原，`--check` 复归
CLEAN。负控制通过 = 修法不是掩盖。

**负控制为什么改脏 skills 而非 dist bundle**：改脏 `plugin/vendor/quay/dist/quay.js` 会被
`build_dist_once` 的 `--sync-dist` 在套件开跑时**合法地还原**（那是选定的随测试自动同步时机，不是 --check
在掩盖），所以 M136 会绿——那不能证明「修法掩盖」。改脏一个 `--sync-dist` 不碰、但 `--check` 会扫的
git 跟踪 vendored 文件，才能存活到 M136 的 `--check` 并验证它是只读真门。

**Touches 新增**：`packages/quay/test/build-dist.test.mjs`、`packages/quay/test/npm-pack-e2e.test.mjs`、
`packages/quay/scripts/build-dist.mjs`（新加 `QUAY_BUILD_DIST_OUTFILE` testability hook）。
