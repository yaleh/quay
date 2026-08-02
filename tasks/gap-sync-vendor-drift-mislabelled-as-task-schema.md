---
id: gap-sync-vendor-drift-mislabelled-as-task-schema
title: "M136 fails deterministically and its error names a file that does not
  exist — the drift is the vendored dist bundle"
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
