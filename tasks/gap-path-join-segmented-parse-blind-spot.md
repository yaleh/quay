---
id: gap-path-join-segmented-parse-blind-spot
title: path.join 分段拼接解析盲区——24 个文件归属信息以解析器读不出的形式存在，使保底成为常规入口
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-bucket-second-truth-source-page-recompute
---
**type:** execution

## Proposal

**实测规模（按 effectiveBucketSet 完整三步含镜像折叠，复现 #633 的 245 个文件）**：
```
① 重归属表 judgment 命中     132 (54%)
② 静态归属含 M（含镜像折叠）  89 (36%)
③ UNRESOLVED 保底           24 (10%)
```
⛔ 用 **24** 这个数，⛔ 不用 50（50 是漏了镜像折叠那一步的粗算——补上后 experiments/ 那 26 个全部正确解析为 M）。

**根因（抽查三个，模式完全一致）**：
```js
// manager-arm-loop.test.mjs
const pluginDir = path.resolve(__dirname, "..");
const MANAGER_ARM = path.join(pluginDir, "scripts", "manager-arm-loop.sh");
// measure-suite.test.mjs
const reporterPath = path.join(repoRoot, "plugin", "scripts", "measure-suite-reporter.mjs");
```
两个信号都抓不到：
- 信号②（相对引用正则）要求**整路径在一对引号内**，分段形式 `"plugin", "scripts"` 不匹配；
- 信号③（全文字面量 `plugin/scripts`）要求**连续文本**，逗号空格隔开不匹配。

**⇒ 这 24 个不是「无法归属」，是「归属信息以当前解析器读不出的形式存在」——目标在源码里写得清清楚楚。**

**修法方向**：给解析器加一条——识别 `path.join(...)` / `path.resolve(...)` 的**连续字符串字面量参数序列**，拼接后再分类。纯静态可判定，不需执行。

**⛔ 保底机制本身保留**（fail-closed 是对的），但**保底该是异常出口不是常规入口**——修后落到保底的应趋近零。

**顺序理由**：条①（gap-bucket-second-truth-source-page-recompute）的落盘产物提供本条的天然验收判据（保底计数可直接查），故 ① 先 ② 后。

## Plan

1. `suite-bucket-attribution.ts` 的静态归属信号加一条：识别 `path.join(...)` / `path.resolve(...)` 的连续字符串字面量参数序列，拼接后按既有分类规则分类。
2. 复现 #633 的 245 文件，验证 24 个 UNRESOLVED 中「分段拼接」形态命中的能正确归属。

## Acceptance Criteria

- [ ] AC1（能取假，分段拼接可解析）：解析器识别 path.join/path.resolve 的连续字符串字面量参数序列并拼接后分类，24 个 UNRESOLVED 中该形态命中的可正确归属；（⛔ 仍 UNRESOLVED ⇒ 假）。
- [ ] AC2（能取假，保底降为异常）：修后落到 UNRESOLVED 保底的文件数从 24 显著下降（趋近零）——以条①的落盘产物直接查保底计数；（⛔ 仍 ~24 ⇒ 假）。
- [ ] AC3（能取假，保底保留）：保底机制（fail-closed）保留、未破坏；（⛔ 保底被删 ⇒ 假）。

## Definition of Done

分段拼接解析落地；AC1-AC3 全勾；保底从常规入口降为异常出口；24 个 UNRESOLVED 中可静态归属的都被正确归属。

## Touches

- plugin/scripts/suite-bucket-attribution.ts（加 path.join/path.resolve 分段拼接解析信号）
- plugin/test/suite-bucket-attribution.test.mjs（分段拼接解析测试 + 保底降为异常负控制）
- tasks/gap-path-join-segmented-parse-blind-spot.md（自身）

## Needs-Human

**执行 2026-08-27T21:31:18.486Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
