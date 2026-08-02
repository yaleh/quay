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

- [ ] AC1: `sync-vendor.sh:82` 的标签与实参一致；对照第 103/123/129 行的写法
- [ ] AC2: 全部 `cmp_or_report` 调用逐个核对标签与实参是否匹配（第 82 行是复制粘贴错误，
      同类错误可能不止一处）
- [ ] AC3: 修标签后重跑 `--check`，DRIFT 消息指向 `vendor/quay/dist/quay.js` 而非不存在的文件
- [ ] AC4: vendored bundle 的同步时机被明确选定并写进 `sync-vendor.sh` 头注释：
      随测试自动同步，或仅发布时同步 + `--check` 相应调整
- [ ] AC5: 选定方案落地后，干净树上 `scripts/test.sh` 的 M136 通过
- [ ] AC6: 连跑 3 次 `sync-vendor.sh --check`，结果一致（证明确定性已消除而非转成真 flaky）
- [ ] AC7: 任务体记录改前/改后的 DRIFT 输出原文
- [ ] AC8: 测试带 `// @test-group product` 声明（`sync-vendor` 属产品打包路径）

## Definition of Done

- [ ] AC3/AC6 的实测输出贴进任务体
- [ ] `scripts/test.sh` 绿
- [ ] 明确记录：**错误消息指向错误的文件，比缺少错误消息更糟**——它把调查引向了错误的方向，
      本次实测代价是三轮误判（内层两轮判为 flaky、外层一轮怀疑 M243 引入）

## Touches

- plugin/scripts/sync-vendor.sh
- experiments/quay-perpetual-stream/scripts/sync-vendor.sh
- scripts/test.sh
- plugin/test/plugin-packaging.test.mjs
