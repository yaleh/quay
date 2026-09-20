---
id: gap-classify-delta-registry-path-layout-aware
title: --classify-delta 的 registry
  查找认打包安装布局（<插件根>/scripts/runner-static-gate.ts），装好的 quay 在外部项目里对非 flip 的 delta
  也能出结论
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-fan-in-cert-flip-commit-identity-inert
---
## Proposal

<!-- dedup-ref -->相关已完成任务（仅追溯）：gap-ff-merge-suite-cert-classifier-unshipped-and-misreported（把分类器与 registry 装进产物）。

**问题（读码，2026-09-20）**：`plugin/scripts/select-static-checks-for-touches.ts:60` 硬编码 `TEST_SH_REL = "plugin/scripts/runner-static-gate.ts"`，`:770` 按 `<root>/${TEST_SH_REL}` 读，找不到 ⇒ exit 2。而 `packages/quay/scripts/package.sh:170-178` 打包时把注册表放在 `<插件根>/scripts/runner-static-gate.ts`（拍平，没有 `plugin/` 层）。`ff-merge.ts` 的 `classifyRootCandidates` 给出 `[root, scriptsDir/../.., scriptsDir/../../.., scriptsDir/..]`，其中 `scriptsDir = <插件根>/scripts/dist`，于是 `<插件根>/plugin/scripts/…` 在纯打包安装里永不存在。本机 0.7.0 缓存能命中只是因为缓存里恰好带了一份嵌套 `plugin/`；0.6.1–0.6.3 缓存里则根本没有该文件。结果：任何非 quay 自宿主项目里，装好的 quay 对**非 flip 提交**的 delta（例如 worker 在 suite 之后又提交了别的文件）也无法分类。

**做法**：让 registry 查找同时接受 `<root>/plugin/scripts/runner-static-gate.ts` 与 `<root>/scripts/runner-static-gate.ts`（先前者、后者作兜底），⛔ 不引入第二份路径常量副本（导出一个候选列表，供 `classifyRootCandidates` 与分类器共用）；`classifyRootCandidates` 保证包含打包布局的插件根。**不改语义**：外部项目既无自身 registry、又不在打包布局下 ⇒ 仍是 `not-evaluated`（不发明「空 registry」判决）。

## AC

- [x] `node --test plugin/test/select-static-checks-for-touches.test.mjs` exit 0，新增用例：① `<root>/plugin/scripts/runner-static-gate.ts` 存在 ⇒ 现有行为不变；② 仅 `<root>/scripts/runner-static-gate.ts` 存在 ⇒ 命中；③ 两者皆无 ⇒ exit 2 且 stderr 含原有 "registry file … not found" 文案（负控制：证明没有伪造判决）。
- [x] `node --test plugin/test/fan-in-ff-merge.test.mjs` exit 0，新增用例：以打包布局（`scriptsDir=<pluginroot>/scripts/dist`，registry 在 `<pluginroot>/scripts/`）为 scriptsDir、外部项目为 root，对 `tasks/x.md` 判惰性、对 `src/app.ts` 判 non-inert（均为**已评估**，不是 not-evaluated）。
- [x] 路径常量单一：`grep -rn "runner-static-gate.ts" packages/quay/src/fan-in/ff-merge.ts plugin/scripts/select-static-checks-for-touches.ts` 打印命中并确认只有一处常量定义，其余为引用/注释（前 3 条命中贴出）。
- [x] `scripts/test.sh --for-task gap-classify-delta-registry-path-layout-aware` exit 0。

## DoD

用真实 `package.sh` 产出的打包布局（不是 fixture 拼出来的目录）作 scriptsDir，对一个外部临时 git 项目运行证书闸的分类路径：`tasks/x.md` 判惰性、`src/app.ts` 判 non-inert，且两者均为已评估结论；拿掉打包 registry 后同命令回到 not-evaluated（对照）。

## Acceptance Criteria

- [x] `node --test plugin/test/select-static-checks-for-touches.test.mjs` exit 0，新增用例：① `<root>/plugin/scripts/runner-static-gate.ts` 存在 ⇒ 现有行为不变；② 仅 `<root>/scripts/runner-static-gate.ts` 存在 ⇒ 命中；③ 两者皆无 ⇒ exit 2 且 stderr 含原有 "registry file … not found" 文案（负控制：证明没有伪造判决）。
- [x] `node --test plugin/test/fan-in-ff-merge.test.mjs` exit 0，新增用例：以打包布局（`scriptsDir=<pluginroot>/scripts/dist`，registry 在 `<pluginroot>/scripts/`）为 scriptsDir、外部项目为 root，对 `tasks/x.md` 判惰性、对 `src/app.ts` 判 non-inert（均为**已评估**，不是 not-evaluated）。
- [x] 路径常量单一：`grep -rn "runner-static-gate.ts" packages/quay/src/fan-in/ff-merge.ts plugin/scripts/select-static-checks-for-touches.ts` 打印命中并确认只有一处常量定义，其余为引用/注释（前 3 条命中贴出）。
- [x] `scripts/test.sh --for-task gap-classify-delta-registry-path-layout-aware` exit 0。

## Definition of Done

用真实 `package.sh` 产出的打包布局（不是 fixture 拼出来的目录）作 scriptsDir，对一个外部临时 git 项目运行证书闸的分类路径：`tasks/x.md` 判惰性、`src/app.ts` 判 non-inert，且两者均为已评估结论；拿掉打包 registry 后同命令回到 not-evaluated（对照）。

## Evidence

AC1 — `node --test plugin/test/select-static-checks-for-touches.test.mjs` ⇒ **exit 0**（23 tests / 23 pass / 0 fail）。新用例 `AC1 — the registry lookup accepts the PACKAGED layout (<root>/scripts/…) as well as the dev layout` 三态：① 两种布局都在时 `<root>/plugin/scripts/…` **胜出**（断言 `--list` 里没有 fallback 的标记名）；② 只有 `<root>/scripts/runner-static-gate.ts` 时 exit 0，且 `--list` 打印的 checker 名是**只有那份拷贝才有**的 `shipped-fallback-probe`（出处证明，不是只看 exit 0）；③ 两者皆无 ⇒ exit 2、stdout 空、stderr 含原文案 `registry file (runner-static-gate.ts) not found`。

AC2 — `node --test plugin/test/fan-in-ff-merge.test.mjs` ⇒ **exit 0**（52 tests / 52 pass / 0 fail）。新用例 `AC2 — flat packaged layout + an EXTERNAL project…`：外部 git 项目（自证无 registry）+ `scriptsDir=<pluginroot>/scripts/dist`、registry 在 `<pluginroot>/scripts/` ⇒ `tasks/…md` 判惰性并 ff 落地（exit 0，develop 前进到 tip）、`src/app.ts` 判 `non-inert (src/app.ts)` 拒（exit 2，⛔ 非 NOT-EVALUATED）、拿掉打包 registry 后同命令退回 NOT-EVALUATED（对照）。

**取假验证（负控制）**：把候选列表临时改回单条 `plugin/scripts/…` 后，上述两条新用例**双双变红**（`✖ AC1 — the registry lookup accepts…`、`✖ AC2 — flat packaged layout…`），恢复后复绿 —— 判据能取假，不是恒真。

AC3 — `grep -rn "runner-static-gate.ts" packages/quay/src/fan-in/ff-merge.ts plugin/scripts/select-static-checks-for-touches.ts` 前 3 条命中：
```
packages/quay/src/fan-in/ff-merge.ts:362: *  `<root>/plugin/scripts/runner-static-gate.ts` FIRST and `<root>/scripts/runner-static-gate.ts` as the
plugin/scripts/select-static-checks-for-touches.ts:60:export const REGISTRY_BASENAME = "runner-static-gate.ts";
plugin/scripts/select-static-checks-for-touches.ts:63: *  registry is the single source for the mapping (`runner-static-gate.ts`'s `run_static_checks()`
```
过滤掉注释行后，**唯一一处代码级常量定义**是 `select-static-checks-for-touches.ts:60` 的 `REGISTRY_BASENAME`（`REGISTRY_REL_CANDIDATES` 与 `TEST_SH_REL` 都由它派生，无第二份字面量）；ff-merge.ts 里没有任何路径字面量，只有注释引用。

AC4 — `bash scripts/test.sh --for-task gap-classify-delta-registry-path-layout-aware --allow-thin` ⇒ **exit 0**（160 tests / 160 pass / 0 fail；scoped 静态层全绿）。另跑全量层的 `kernel-sibling-resolution-check` ⇒ PASS（0 naive 解析），`registry-bare-filename-scan`（14/14）、`scoped-static-checks`（14/14）全绿。

DoD — 真跑 `bash packages/quay/scripts/package.sh` 产出 `quay-0.10.0-dev.tgz`（artifact 的 dist-closure gate 自报 101 个被引用的 dist bundle 全部在包内），把 tarball 装进一个**外部**临时项目的 `node_modules/quay/`，以 `<install>/plugin/scripts/dist` 为 scriptsDir 驱动证书闸（`ff-merge.ts`）：
- 实测布局：`plugin root = <install>/plugin`，registry = `<install>/plugin/scripts/runner-static-gate.ts` 存在，`<install>/plugin/plugin` **不存在**（正是打包拍平形）；
- A) `tasks/x.md` ⇒ 判惰性、`exit 0`、develop 快进到 tip（落地）；
- B) `src/app.ts` ⇒ `delta classified non-inert (src/app.ts)`、`exit 2`（**已评估**，不是 not-evaluated）；
- C) 对照：`mv` 走打包 registry 后同一命令 ⇒ `NOT-EVALUATED`（stderr 逐候选根列出两条候选路径都被试过），`exit 2`。
脚本与完整输出：`.quay/dod-packaged-layout.sh` / `.quay/dod-packaged-layout.evidence.txt`（未跟踪）。

## Touches

- plugin/scripts/select-static-checks-for-touches.ts
- plugin/test/select-static-checks-for-touches.test.mjs
- packages/quay/src/fan-in/ff-merge.ts
- plugin/test/fan-in-ff-merge.test.mjs
- tasks/gap-classify-delta-registry-path-layout-aware.md
