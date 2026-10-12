---
id: gap-routine-semantic-dedup-scan-serveheapcapmb-cross-layer-copy
title: "semantic-dedup-scan: two byte-identical bodies including the
  incident-derived magic numbers 4096/512/5 — drifting policy rather than a leaf
  constant — and the 'kernel does not reac"
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
two byte-identical bodies including the incident-derived magic numbers 4096/512/5 — drifting policy rather than a leaf constant — and the 'kernel does not reach into Core' justification is inconsistent with the same file already importing Core's serve-log.ts and systemd-scope.ts; the sanctioned plugin→packages direction means the copy is unnecessary.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791821278116` · ts `2026-10-12T16:07:58.116Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`serveHeapCapMb`、`withServeHeapCap`
- 涉及文件：
- `plugin/scripts/start-drivers.ts:114`
- `plugin/scripts/start-drivers.ts:118`
- `packages/quay/src/cli/server.ts:90`
- `packages/quay/src/cli/server.ts:96`
- kind：`real-duplication`
- verdict：`real-duplication`

## Requested action
merge — start-drivers.ts should import withServeHeapCap from packages/quay/src/cli/server.ts

## 处置（2026-10-13，由派发链实跑；⛔ 非「已注意到」）

**诊断成立，已修掉。** 两处 `serveHeapCapMb` / `withServeHeapCap` 逐字节相同；`4096/512/5` 是 2026-09-17
全局 OOM 复盘得出的**策略值**、不是叶常量 ⇒ 两份可以各自被调参而互不知情。start-drivers.ts 原来那条
「kernel 不为一个常量伸手进 Core」的理由，**在同一文件里已被它自己证伪**（它早已 import Core 的
`serve-log.ts` 与 `systemd-scope.ts`）。

**修法偏离 finding 的 `suggestedAction`，偏离理由是可测量的**：`suggestedAction` 建议从
`packages/quay/src/cli/server.ts` import。该模块静态可达整个 serve 宿主（serve.ts + serve-handlers +
serve-board + serve-dashboard + observation + control-plane-http + config + provider-client），而 esbuild
（`bundle:true`，`packages/quay/scripts/build-plugin-dist.mjs`）会把它**内联进 shipped 的
`plugin/scripts/dist/start-drivers.js`**。本机 2026-10-13 用真实 build 配置对两种写法实测：
**32,143 B → 784,043 B（24×）** —— 为一个两行函数把整个 Web UI 宿主塞进驱动启动脚本。

改用本仓库既有的跨边界共享形状（`serve-log.ts` / `serve-binding.ts` / `systemd-scope.ts` 同款）：把两个
纯函数提到 **Core 叶模块 `packages/quay/src/serve-heap-cap.ts`**（只 import `node:os`），两侧 spawn 点从
同一处取符号。最终 start-drivers bundle = **32,183 B，内含 1 份实现**。

- ① Core（`cli/server.ts`）不得静态 import `plugin/**`（import-graph-check 的 reverseEdges 棘轮）⇒ 共享实现不能落在内核侧；
- ② `plugin/` → `packages/` 是受认可方向，esbuild 把它内联 ⇒「安装包自足」与「只有一份实现」不冲突；
- ③ 叶模块纪律：只 import node 内建、本身不引入边 ⇒ 不碰 import-graph-check 的零 SCC 基线。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `serveheapcapmb-cross-layer-copy`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791821278116`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**E1 · 策略副本数（判据能取假：0 ⇒ 没修掉；2 ⇒ 没修干净）**
```
$ grep -rn "Math.min(4096, Math.max(512" --include=*.ts --include=*.mjs --include=*.js . \
    | grep -v node_modules | grep -v plugin/vendor
packages/quay/src/serve-heap-cap.ts:53:  return Math.min(4096, Math.max(512, Math.round(os.totalmem() / (1024 * 1024) / 5)));
（共 1 命中）
```
两份旧定义已消失：`grep -c "function serveHeapCapMb\|function withServeHeapCap"` 在
`plugin/scripts/start-drivers.ts` 与 `packages/quay/src/cli/server.ts` 均为 **0**（改动前各为 2）。

**E2 · 两侧 spawn 点从同一处取符号**
```
plugin/scripts/start-drivers.ts:109:import { withServeHeapCap } from "../../packages/quay/src/serve-heap-cap.ts";
packages/quay/src/cli/server.ts:84:import { serveHeapCapMb, withServeHeapCap } from "../serve-heap-cap.ts";
packages/quay/src/cli/server.ts:85:export { serveHeapCapMb, withServeHeapCap };   ← CLI 既有导出面原样保留
```
运行时恒等（进程内实测）：`(await import('…/cli/server.ts')).withServeHeapCap === (await import('…/serve-heap-cap.ts')).withServeHeapCap` ⇒ **true**（`serveHeapCapMb` 同）。

**E3 · `suggestedAction` 的代价实测 / 本实现的负对照**
同一 esbuild 配置（`bundle/node/esm` + `core-src-alias` 插件，取自 `build-plugin-dist.mjs`）：
```
改动前                        dist/start-drivers.js =  32,143 B   （2 份实现）
suggestedAction（从 cli/server.ts import）      = 784,043 B   （24×，整个 serve 宿主被内联）
本实现（Core 叶模块）         dist/start-drivers.js =  32,183 B   （1 份实现）
```

**E4 · 判据实跑**
```
$ node_modules/.bin/tsc --noEmit                                   exit 0
$ node --experimental-strip-types plugin/scripts/import-graph-check.ts
  valueSccs=0 typeSccs=0 reverseEdges=0 ; kernelChecked=true (violations=0) ; PASS
$ bash scripts/test.sh plugin/test/start-drivers.test.mjs          tests 21 / pass 21 / fail 0
$ bash scripts/test.sh packages/quay/test/server-restart.test.mjs  tests  7 / pass  7 / fail 0
```
两条套件分别真实 spawn 两个 spawn 点的宿主（`startServe` / `spawnHost`），故 `withServeHeapCap` 的
调用路径被实际执行 —— ⛔ 不是只做静态检查。

**E5 · 落地载体**：实现提交 `bd5f60f41`（`packages/quay/src/serve-heap-cap.ts` 新增 60 行；`cli/server.ts`
改为 import + 原样再导出；`start-drivers.ts` 改为 import 叶模块，并顺带修正其底部 direct-entry guard 注释里
「Its one cross-tree import」这句已随实现失效的描述）。

## Touches
- `plugin/scripts/start-drivers.ts`
- `packages/quay/src/cli/server.ts`
- `packages/quay/src/serve-heap-cap.ts`
- `tasks/gap-routine-semantic-dedup-scan-serveheapcapmb-cross-layer-copy.md`
