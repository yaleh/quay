# Evidence — gap-fanin-rerun-attribution-blind-to-spec-reporter

Date: 2026-11-01

## What changed

`plugin/scripts/worker-fan-in.ts` 的 `parseSuiteLogFailures`（fan-in 本轮重跑失败文件归因的输入）此前只认
TAP `^not ok` 与 `__PERFILE__ … passed=false` 两支；node spec reporter 的 `test at <file>:<line>:<col>` +
`✖ <name> (<ms>)` 一行都不匹配 ⇒ 任何 spec 格式的抖动红点在两轮后被机械停派成 needs-human。

修复：

1. `parseSuiteLogFailures` 增加 spec 分支：以 `test at` 的 `<file>` 为身份源，配对的 `✖` 是「这是一个失败点」
   的判据（无配对 ⇒ 不归因、不计数）；文件 token 经既有 `toRepoRelToken` 转 repo-relative。
2. 把 `parseFailureSignatures`（基线 A/B，既有 done 任务已修）里的 spec 配对前瞻**抽成共享叶函数**
   `specFailurePair`，两个消费者共用，⛔ 不写第二份正则。
3. TAP `not ok` 与 `passed=false` 两支逐字节不变；混合输出取并集去重（`addFile` 已有的去重路径）。

⛔ 本修复只让 spec 红点**可归因/可重跑**——它不豁免任何真实红（rerun 仍按退出码三态判定，红仍是红）。

## AC1 正控（spec 摘录 → 归因到两个文件）

输入：quay-fleet 两轮生产日志的逐字摘录（Round 259 `notification-pipeline-resolution-gate` + Round 260
`dogfood-p0`）：

```
✖ failing tests:

test at test/notification-pipeline-resolution-gate.test.mjs:645:1
✖ AC-064(1) DoD: on the REAL persistent home, the closed ones leave the sendable set — recomputed read-only (603.98359ms)

test at test/dogfood-p0.test.mjs:344:1
✖ AC-012's criterion pipeline runs verbatim through sh -c against the real checkout and exits 0 (13462.952177ms)
```

命令：`node --test plugin/test/worker-fan-in-spec-attribution.test.mjs`
（用例 `AC1 (positive control) — the verbatim production spec-reporter excerpt attributes both failing files`）

结果：退出码 0；`readFailedTestFiles(AC1_SPEC_EXCERPT, "/wt/repo")` 返回

```json
{"evaluated":true,"files":["test/notification-pipeline-resolution-gate.test.mjs","test/dogfood-p0.test.mjs"]}
```

同一摘录走真实 in-round rerun 路径（e2e，`runMechanicalFanIn` 收到 spec 格式 suite 日志 + 声明
`loop.rerun_command`）：用例 `AC1+DoD (in-round rerun path)` 退出码 0，`outcome=landed`、
`rerun.state=rerun-green`、`failedTestFiles={evaluated:true, files:["test/dogfood-p0.test.mjs"]}`——
⛔ 不再落 `rerun-not-evaluated: no-failing-lines-in-suite-log`。

## AC2 负控（逐条贴读数）

命令：`node --test plugin/test/worker-fan-in-spec-attribution.test.mjs`，全部退出码 0。

- (a) 只有 `✖ failing tests:` + 独立 `✖ name`、无任何 `test at` ⇒
  `readFailedTestFiles = {"evaluated":false,"reason":"no-failing-lines-in-suite-log"}`。
- (b) 只有 `ℹ fail 1` 摘要行 ⇒ 同样 `{"evaluated":false,"reason":"no-failing-lines-in-suite-log"}`。
- (c) `test at` 后没有配对的 `✖` ⇒ `evaluated:false`，`files=[]`（不伪造文件）。
- (d) 既有 TAP / `__PERFILE__` 夹具逐字节不变：
  - `__PERFILE__ duration_ms=10 plugin/test/x.test.mjs passed=false end_ms=1` ⇒
    `{"files":["plugin/test/x.test.mjs"],"failingLines":1,"pseudoStages":[],"unclassified":[]}`；
  - `not ok 1 - plugin/test/b.test.mjs: b is broken` + `not ok 2 - plugin/test/c.test.mjs: c is broken` ⇒
    `{"files":["plugin/test/b.test.mjs","plugin/test/c.test.mjs"],"failingLines":2,"pseudoStages":[],"unclassified":[]}`；
  - `__PERFILE__ … lint passed=false` ⇒ `{"files":[],"failingLines":1,"pseudoStages":["lint"],"unclassified":[]}`。
- (e) 变异臂：把 `parseSuiteLogFailures` 里的 spec 分支整体删掉后重跑同一测试文件——AC1 / AC1+DoD / AC3
  转红，AC2(a)(b)(c)(d) 四臂**全部保持绿**。删除前该文件 8/8 绿。已还原。

## AC3 真实重放（quay-fleet 生产日志逐字节副本）

Fixture：`plugin/test/fixtures/spec-reporter-suite-log-bda3e2.txt`，是 quay-fleet
`.quay/fan-in-suite-gap-knowledge-live-carrier-derivation~wk-prod-anchor~1793522910959-bda3e2.log`
第 40469–40492 行（`✖ failing tests:` 到文件末尾）的逐字节拷贝。

```bash
md5sum plugin/test/fixtures/spec-reporter-suite-log-bda3e2.txt
# 0387353af971e669e7c544ff895d6b8c  （与源日志同区间 sed 抽取逐字节一致）
```

命令：

```bash
node --experimental-strip-types -e '
import { readFailedTestFiles, parseSuiteLogFailures } from "./plugin/scripts/worker-fan-in.ts";
import fs from "node:fs";
const log = fs.readFileSync("./plugin/test/fixtures/spec-reporter-suite-log-bda3e2.txt", "utf8");
console.log(JSON.stringify(readFailedTestFiles(log, "/wt/repo")));
console.log(JSON.stringify(parseSuiteLogFailures(log, "/wt/repo")));
'
```

verdict JSON：

```json
readFailedTestFiles:  {"evaluated":true,"files":["test/dogfood-p0.test.mjs"]}
parseSuiteLogFailures: {"files":["test/dogfood-p0.test.mjs"],"failingLines":1,"pseudoStages":[],"unclassified":[]}
```

归因到 `test/dogfood-p0.test.mjs` ✓（Round 260 的真实红点）。

## AC4 回归

命令：

```bash
node --test plugin/test/worker-driver.test.mjs plugin/test/worker-driver-fan-in-s04.test.mjs plugin/test/worker-driver-fan-in-s07.test.mjs plugin/test/worker-fan-in-spec-attribution.test.mjs
```

结果：退出码 0；`tests 184 / pass 184 / fail 0`。

补充（本修复还触及 `parseFailureSignatures` 的 spec 分支抽叶，另行回归其两个直接消费者）：

```bash
node --test plugin/test/worker-fan-in-baseline-red.test.mjs   # tests 15 / pass 15 / fail 0
node --test plugin/test/worker-driver-retry-classification.test.mjs  # tests 30 / pass 30 / fail 0
```

## 落点（Touches）

- `plugin/scripts/worker-fan-in.ts`
- `plugin/test/worker-fan-in-spec-attribution.test.mjs` (new)
- `plugin/test/fixtures/spec-reporter-suite-log-bda3e2.txt` (new)
- `docs/evidence/2026-11-01-fanin-rerun-spec-attribution.md` (new, self)
- `tasks/gap-fanin-rerun-attribution-blind-to-spec-reporter.md` (self)
