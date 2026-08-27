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

- [x] AC1（能取假，分段拼接可解析）：解析器识别 path.join/path.resolve 的连续字符串字面量参数序列并拼接后分类，24 个 UNRESOLVED 中该形态命中的可正确归属；（⛔ 仍 UNRESOLVED ⇒ 假）。→ 新增 `extractJoinedPathSegments`（`suite-bucket-attribution.ts` signal ④：识别 `path.join`/`path.resolve` + 裸 `join`/`resolve` 的相邻字符串字面量参数序列、以 `/` 拼接、`classifyPath` 分类）；4 个该形态命中：integration-batch-merge/measure-suite/sync-lag-check → M、plugin-vendor-standalone → P（实测 `--write-effective` 落盘）。
- [ ] AC2（能取假，保底降为异常）：修后落到 UNRESOLVED 保底的文件数从 24 显著下降（趋近零）——以条①的落盘产物直接查保底计数；（⛔ 仍 ~24 ⇒ 假）。→ **24 → 20（4 个分段拼接命中）⛔ 未达趋近零**：剩余 20 非「连续字符串字面量」形态，分三类另盲区——①变量前缀 2（manager-arm-loop/user-scope-reinstall：`pluginDir = path.resolve(__dirname,"..")` 后 `path.join(pluginDir,"scripts",…)`）；②相对锚 1（outer-tick-log-check：`join(import.meta.dirname,"..","scripts",…)`）；③helper 模块 17（session-liveness×10 + quay-init-loop-vendor×7：subject 在 `*-helpers.mjs`，不在测试文件自身文本）。**本信号（字面量拼接）不覆盖①②③——见 Evidence。**
- [x] AC3（能取假，保底保留）：保底机制（fail-closed）保留、未破坏；（⛔ 保底被删 ⇒ 假）。→ `bucketSetOf` 返回空集仍映射 UNRESOLVED、绝不静默默认；负控制 `delivery-status-single-source`（相对 `../../packages/…` 分段 run 不被 `classifyPath` 子串误判为 P）+ `a15-ruling5-counter`/`acceptance-env` 保持原桶，测试钉住。

## Definition of Done

分段拼接解析（连续字符串字面量参数序列）落地；AC1/AC3 全勾、AC2 未达（24 → 20，非趋近零——剩余 20 是三种另类盲区，非本信号范围）；「24 个中**可经字面量拼接静态归属的**」4 个全部正确归属。

## Evidence（inner 2026-08-27 实跑）

**实现**：`plugin/scripts/suite-bucket-attribution.ts` 加 signal ④ —— `extractJoinedPathSegments` 识别 `path.join(…)`/`path.resolve(…)`（含裸 `join`/`resolve`，lookbehind 排除 `arr.join(` 成员访问）的相邻字符串字面量参数序列（`parseArgList` 跳嵌套 `()[]{}` 与字符串；`staticLiteralValue` 拒绝 `${…}` 模板插值），`≥2` 相邻字面量以 `/` 拼接；`bucketSetOf` 只对**仓库相对**（非 `.` 开头）的拼接串 `classifyPath`。

**验证（落盘产物直查）**：
```
node --experimental-strip-types plugin/scripts/suite-bucket-select.ts --write-effective
  baseline  unresolved = 24
  after     unresolved = 20
```
4 个命中（UNRESOLVED → 桶）：
- integration-batch-merge → M、measure-suite → M、sync-lag-check → M（`join/path.join(repoRoot, "plugin", "scripts", …)`）
- plugin-vendor-standalone → P（`path.join(repoRoot, 'packages', 'quay-native', 'bin', …)`）

**剩余 20（三类另盲区，超本信号范围，建议各自立案）**：
- ①变量前缀 2：manager-arm-loop、user-scope-reinstall —— `pluginDir = path.resolve(__dirname, "..")` 后 `path.join(pluginDir, "scripts", …)`；字面量拼接只得 `scripts/…`，`plugin` 前缀在变量里。
- ②相对锚 1：outer-tick-log-check —— `join(import.meta.dirname, "..", "scripts", …)`；需 `..` 相对解析（本信号跳过 `.` 开头串，防 `classifyPath` 子串误判）。
- ③helper 模块 17：session-liveness×10（hangguard/restart/scd-busy/scd-config-gates/scd-develop-active/scd-fire/scd-inflight-changing/scd-multitask/scd-progress/scd-unsaturated）+ quay-init-loop-vendor×7 —— subject 在 `session-liveness-helpers.mjs`/`quay-init-loop-helpers.mjs`，测试文件自身文本无该路径，需扫 helper 模块。

**测试**：`suite-bucket-attribution.test.mjs` 10/10 pass（新增 AC2(d) 分段拼接桶断言 + `extractJoinedPathSegments` 单测 + 相对分段负控制 `delivery-status-single-source` 不子串误判 P）；`suite-bucket-select.test.mjs` 12/12 pass（回归无破坏）。

## Touches

- plugin/scripts/suite-bucket-attribution.ts（加 path.join/path.resolve 分段拼接解析信号）
- plugin/test/suite-bucket-attribution.test.mjs（分段拼接解析测试 + 保底降为异常负控制）
- tasks/gap-path-join-segmented-parse-blind-spot.md（自身）
