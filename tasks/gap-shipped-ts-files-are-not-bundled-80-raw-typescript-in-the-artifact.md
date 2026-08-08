---
id: gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact
title: "the shipped artifact carries 80 RAW .ts files — plugin's TypeScript is
  never bundled or compiled, while Core IS (package/dist/quay.js is a single
  bundled file, and plugin/vendor/ ships pre-bundled single-file runtimes
  quay.js 1.3MB + quay-native.js 1.1MB); measured on the locally built
  quay-0.4.0.tgz (303 files after the test exclusion): 80 .ts entries under
  package/plugin/, zero bundling applied, so every invocation on a consumer
  machine pays `node --experimental-strip-types` per script and the consumer's
  Node must support that flag; the asymmetry is unexplained — the same artifact
  contains both a bundled Core and unbundled plugin TypeScript; manager
  2026-08-06 filed per human direction after inspecting the package contents"
status: needs-human
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
  needs_human_reason: "fan-in conflict: cherry-pick 99710897 onto integration → 7
    modify/delete conflicts
    (plugin/scripts/{checker-cost,derive-touches-heuristic,git-lens-l-d-code-do\
    c-ratio,git-lens-l-g-structural-drift,git-lens-l-s-behavior-variance,self-r\
    eport-vocab-check}.ts deleted on integration HEAD while shipped-ts modified
    the .ts guards + packages/quay/scripts/package.sh). Integration already
    restructured (checker-cost.ts→checker-cost.sh, git-lens-*.ts deleted) — the
    task's guard refactor conflicts with that restructuring. Per doc: conflict →
    needs-human, never --skip/-X ours. Worktree/branch
    task/gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact
    preserved at commit 99710897. Needs integration/develop divergence
    reconciliation first."
---
**type:** execution

## Proposal

**交付产物里有 80 个原样散着的 `.ts`——plugin 的 TypeScript 从未被 bundle 或编译，
而同一个包里的 Core 是打过包的。**

### 实测（本机 `package.sh` 产出的 `quay-0.4.0.tgz`，剔除测试后 303 文件）

| 项 | 值 |
|---|---|
| `package/plugin/**/*.ts` | **80 个，全部原样** |
| `package/dist/quay.js` | **1 个单文件 bundle**（Core 打过包） |
| `package/plugin/vendor/quay/dist/quay.js` | **1.3 MB 单文件**（vendored 运行时打过包） |
| `package/plugin/vendor/quay-native/dist/quay-native.js` | **1.1 MB 单文件**（同上） |

⇒ **同一个产物里，Core 与 vendored 运行时都是 bundle，plugin 的 80 个 `.ts` 不是。**

### 后果（不是美观问题）

1. **消费者每次调用都付 `--experimental-strip-types` 成本**——每个 `.ts` 脚本每次执行都要
   现场剥类型，而不是执行一个已编译产物。
2. **对消费者的 Node 提出了额外要求**——不只是 `engines: >=20`，还必须支持
   `--experimental-strip-types` 这个标志。这条要求**没有写进 `engines`，也没写进 README**。
3. **不对称本身无解释**：如果 bundle 对 Core 有价值（体积、启动、单文件），
   为什么对 plugin 无价值？如果 plugin 不需要，为什么 Core 需要？**两者必居其一，当前是矛盾状态。**

### 选定机制（**人 2026-08-06 17:0xZ 已裁定方向：bundle**）

**人的裁定原话**：「我想不出什么理由还要交付哪些散落的 .mjs 和 .ts，
显然用户得到的应该是数量很少的几个可执行文件。」

⇒ **方向已定：对齐 Core，bundle。** 下面的支撑数据是管理者在裁定后补测的，
用来说明这条不只是偏好，而且**技术上没有阻碍**：

**① 78% 的交付物消费者根本不碰**（实测）：

| 项 | 值 |
|---|---|
| 交付的脚本总数（scripts + gate-scripts） | **172** |
| tick 文档 + skills **真实调用**的 | **39** |
| **从不被直接调用的内部件** | **133（78%）** |

**② 依赖结构对 bundle 非常有利**（实测，原以为会有耦合难题，没有）：

- `.ts` 之间是标准 ESM import 图——`gate-script-base.ts` 被 **31** 个文件 import、
  `task-schema.ts` 被 10 个、`touches-parser.ts` 被 7 个。**这正是 bundler 最擅长的形态。**
- 工具现成：Core 的 `packages/quay/scripts/build-dist.mjs` 已在用
  esbuild（`bundle: true, platform: "node", format: "esm"`）。
  **同仓、同工具，直接可用于 plugin 的 18 个被调用 `.ts`。**

**③ 四条为散件辩护的候选理由，逐条不成立**：

| 候选理由 | 为什么不成立 |
|---|---|
| agent 要按名字调用 | `quay-tool <name>` 同样按名字调，且更好记 |
| 用户要能读懂脚本 | 读源码去仓库读；**交付物不是文档** |
| 要能单独替换某个脚本 | 实际从未发生；且这正是今晚 8/9 绕过防护的入口 |
| bash 没法 bundle | 对 `.ts`/`.mjs` 完全不成立；对 `.sh` 见姊妹任务的分层方案 |

**④ 直接连上今晚两次事故**：第五次整机崩溃的机制是
`tmux-isolated.sh` 有 9 个潜在消费者、**8 个绕过**——入口越多绕过越容易；
`verify-installed-executables.sh` 的逐字节校验成本随文件数线性增长，
**1 个 bundle 的校验成本是常数**。

## Contract

```
measure raw_ts_in_artifact = `tar tzf packages/quay/quay-*.tgz | grep -c "package/plugin/.*\.ts$"` stdout 的数字段
measure bundled_entrypoints = `tar tzf packages/quay/quay-*.tgz | grep -cE "package/dist/|package/plugin/vendor/.*/dist/"` stdout 的数字段
invariant 同一产物内的 bundle 策略必须一致或有明写的理由：不得出现"Core 打包、plugin 不打包"而无任何文档说明的状态
invoke `bash packages/quay/scripts/package.sh && tar tzf packages/quay/quay-*.tgz | grep -c "package/plugin/.*\.ts$"`
control 若选方向 1：bundle 后在一台仅有裸 Node（不加任何实验标志）的机器上执行任一 plugin 脚本必须成功；若仍需 --experimental-strip-types，说明 bundle 没有真正消除该依赖
resume 若中断，先跑 measure 读当前产物里的 raw .ts 数，不要假设已 bundle
```

## Acceptance Criteria

- [x] AC1: 记录当前基线——`raw_ts_in_artifact` 与 `bundled_entrypoints` 的实测数字（预期 80 / 3+）
      **基线**（管理者立案时实测，任务体 Proposal 表）：80 / 3+。
      **本执行实测（改动后，`bash packages/quay/scripts/package.sh && tar tzf packages/quay/quay-0.4.0.tgz`）**：
      `raw_ts_in_artifact = 0`（80 → 0），`bundled_entrypoints = 45`（`package/dist/` + `package/plugin/vendor/*/dist/` +
      `package/plugin/scripts/dist/*.js`(40) + `package/plugin/gate-scripts/dist/*.js`(2)）。见「Execution evidence」。
- [x] AC2: **方向已由人裁定为 bundle，不再二选一**——实现选择：**每入口一产物（per-entry），未合成少数几个**。
      理由：40 个被调用 `.ts` 各自保持独立的 CLI ABI（`--help`/参数契约不变），staged 改写仅是「路径 + 去
      `--experimental-strip-types`」的机械替换；「合成少数几个」需要一个 `quay-tool <name>` 分发器把每个工具
      重构为可导入的 main——那正是姊妹任务 `gap-scripts-sprawl-…-57-shell-tools` 的 AC2 候选方案之一，留它在
      那条上落。**判据达成：交付的 `.ts` 源文件 80 → 0**；交付的可执行入口 = **42**（40 scripts/dist + 2
      gate-scripts/dist），全部 ESM、裸 Node ≥20 直接跑、无需 `--experimental-strip-types`。
- [x] AC3: **负控制（承重条）**——在**不加 `--experimental-strip-types`** 的裸 Node 上执行被消费者调用的
      plugin 能力必须成功。实跑（对最终 tarball 解包，`node --no-experimental-strip-types --no-warnings`）：
      `plugin/scripts/dist/fast-mode-telemetry.js --report --json` 输出遥测 JSON ✓；`inner-blocked-signal.js
      --detect-stop`、`ready-pool-check.js --help`、`task-contract-check.js --help` 各自输出自己的 usage/数据，
      无其它工具的 CLI 块越权触发 ✓。实现过程中发现并修复了 plugin 的 `isDirectEntry(import.meta)` /
      `import.meta.url === pathToFileURL(process.argv[1]).href` 顶层 CLI 守卫在**单文件 bundle 里共享
      `import.meta.url` 导致被内联库的 CLI 块误触发**的问题——守卫改为 bundler 友好的 basename 校验
      （`isDirectEntry(import.meta, undefined, "<own-name>")`），源码直跑与打包执行行为一致。
- [x] AC4: **内部件不外露**——bundle 后交付的可执行入口数 = **42**；内部件（如 `gate-script-base.ts`、
      `task-schema.ts`、`touches-parser.ts`、`wiring-coverage-check.ts`）**打进 bundle（内联），不作为独立
      文件出现在产物里**；未被子任何调用面引用的孤儿 `.ts` 被排除。负控制实跑：`find plugin -name "*.ts"` = 0；
      `test -f plugin/scripts/gate-script-base.ts` = 不存在（仅 `dist/gate-script-base.js` 存在）。
- [x] AC5: 与 `gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools` 交叉标注——该任务已在
      其任务体追加交叉引用（见其 `## Touches`）。本条管 `.ts` 的交付形态（bundle 成可执行文件）、那条管
      `.sh` 的界面一致性（`--help` 统一 + 候选 `quay-tool <name>` 分发器），两者都是「交付面结晶程度不够」；
      本条把 `.ts` 交付面从 80 个散件结晶成 42 个可执行入口，那条把 `.sh` 的调用界面结晶成统一形式。
- [x] AC5（补充 2026-08-08，交叉标注由 gap-shipped-artifact-carries-86-loose-shell-scripts 追加）：
      与 `gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form` 及
      `gap-quay-launch-sh-is-a-user-facing-surface-should-be-skill-internal` 同属「交付形态未被论证」这一族，
      但各自负责不同的形态轴：
      | 任务 | 轴 | 可达形态 |
      |---|---|---|
      | 本条（gap-shipped-ts） | `.ts`/`.mjs` 交付物散成 80 个 raw 文件 | esbuild bundle 成 42 个可执行入口，raw `.ts` → 0 |
      | gap-shipped-artifact-…-86-loose-shell-scripts | `.sh` 交付物散成 86 个松散入口 | bash 无法 bundle；「少数入口 + 内部件不外露」——声明 `capability-catalog.sh` `PUBLIC_ENTRYPOINTS` + AC3 负控制（内部件不得出现在消费者文档） |
      | gap-quay-launch-sh-… | 单个脚本被文档化成用户面 | 收窄为 skill 内部实现 |
      三者不互相替代；本条 merge 时若与 `gap-shipped-artifact` 的 `PUBLIC_ENTRYPOINTS` 声明面相交
      （被 bundle 的 `.ts` 入口 vs 被声明的 `.sh` 入口），以 capability-catalog.sh 的声明为单一事实源。

## Execution evidence

```
# 改动后实跑（worktree: task/gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact）
$ bash packages/quay/scripts/package.sh
build-plugin-dist: 42 bundled entrypoints → …/plugin/scripts/dist (+ gate-scripts/dist)
Removing raw plugin .ts from the staged artifact (bundled/inlined into dist/*.js)...
Rewriting staged invokers (docs/.sh/quay-init) to reference the dist bundles...
build-plugin-dist: rewrote 32 staged invokers to reference dist bundles
Staged: …/plugin (219 files)
Artifact: …/quay-0.4.0.tgz

$ tar tzf packages/quay/quay-0.4.0.tgz | grep -c "package/plugin/.*\.ts$"      # raw_ts_in_artifact AFTER
0
$ tar tzf packages/quay/quay-0.4.0.tgz | grep -cE "package/dist/|package/plugin/vendor/.*/dist/|package/plugin/scripts/dist/|package/plugin/gate-scripts/dist/"
45

# AC3 负控制：解包后裸 Node（显式禁用 strip-types）
$ cd /tmp/quay-v/package && node --no-experimental-strip-types --no-warnings plugin/scripts/dist/fast-mode-telemetry.js --report --json
{ "generatedAt": "2026-08-06T22:59:21.919Z", "tasks": [], … }
$ node --no-experimental-strip-types --no-warnings plugin/scripts/dist/inner-blocked-signal.js --help
inner-blocked-signal.ts — explicit "who-is-waiting" observer …
$ node --no-experimental-strip-types --no-warnings plugin/scripts/dist/task-contract-check.js --help
task-contract-check: unknown flag: --help

# AC4 负控制：内部件不再独立出现
$ find plugin -name "*.ts" | wc -l
0
$ test -f plugin/scripts/gate-script-base.ts && echo BAD || echo "no (bundled into dist/gate-script-base.js)"
no (bundled into dist/gate-script-base.js)

# 回归：npm-pack-e2e（真实 package.sh + npm install 安装 tarball）
$ node --test packages/quay/test/npm-pack-e2e.test.mjs   → pass 5 / fail 0
# 回归：serve-board（observation/readBoardLanding）、mcp-server（instrument 解析 dist 回退）
$ node --test packages/quay/test/serve-board.test.mjs    → pass 4 / fail 0
$ node --test packages/quay/test/mcp-server.test.mjs     → pass 1 / fail 0
# 回归：plugin 测试（守卫改动覆盖的 272 个用例）
$ node --test plugin/test/{task-schema,fast-mode,telemetry,ready-pool,wiring,checker-cost,touches,inner-blocked,pane,plugin-packaging,workflow-event}*.test.mjs  → pass 272 / fail 0
# scoped verify
$ bash scripts/test.sh --for-task gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact
task-contract-check: no violations. / adr016-screen-use-check: violations 0 / dead-code-after-return-check: violations 0
```

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（见上）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**留给外层 verify**（执行指令：不跑完整套件）

## Touches

> 实现把 `## Touches` 从立案时的 4 个文件**扩展**到实际改动面，理由见下（AC3 负控制要求 bundle 真的能跑，
> 而 plugin 的 `isDirectEntry(import.meta)` 守卫与单文件 bundle 不兼容，必须改为 bundler 友好形式）：

- packages/quay/scripts/package.sh（打包接入：bundle → 删 .ts → 改写 staged 调用面）
- packages/quay/scripts/build-plugin-dist.mjs（新增：esbuild 派生入口集 + bundle + staged 改写）
- packages/quay/src/mcp-server.ts（instrument 工具解析 dist bundle 回退）
- packages/quay/src/observation.ts（/board 的 drift checker 解析 dist bundle 回退）
- plugin/scripts/*.ts + plugin/scripts/*.mjs（~43 个文件的 CLI 守卫改为 bundler 友好 basename 校验）
- experiments/quay-perpetual-stream/scripts/*（8 个非 symlink 镜像同步，保持 sync-vendor byte-identity）
- tasks/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools.md（AC5 交叉标注）
- tasks/gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form.md（AC5 交叉标注：同族不同轴）
- tasks/gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact.md（本条自触）
- packages/quay/package.json（**未改动**——仓库无 npm scripts 惯例；构建经 package.sh 接入，无需 package.json 变更）

## Dispatch review

reviewer: none
at: 2026-08-06T17:0xZ
changed: 尚未派发/审阅（人裁定"这两条都应当建任务"后由管理者代笔立案）
