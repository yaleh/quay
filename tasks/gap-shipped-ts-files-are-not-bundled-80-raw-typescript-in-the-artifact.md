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
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
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

- [ ] AC1: 记录当前基线——`raw_ts_in_artifact` 与 `bundled_entrypoints` 的实测数字（预期 80 / 3+）
- [ ] AC2: **方向已由人裁定为 bundle，不再二选一**——任务体记录实现选择（每入口一产物 vs
      合成少数几个）及理由。**判据：交付出去的 `.ts` 源文件数应当大幅下降**，
      目标形态是"数量很少的几个可执行文件"（人裁定原话），具体数字由执行时定并记录
- [ ] AC3: **负控制（承重条）**——在**不加 `--experimental-strip-types`** 的裸 Node 上
      执行任一被消费者调用的 plugin 能力必须成功；仍需该标志则 bundle 未真正消除依赖
- [ ] AC4: **内部件不外露**——实测 172 个交付脚本里仅 **39** 个被 tick 文档/skills 真实调用，
      其余 **133（78%）** 是内部件。bundle 后需给出「交付出去的可执行入口数」，
      并说明内部件是被打进 bundle 还是被排除；**负控制**：随机挑一个内部件，
      确认它不再作为独立文件出现在产物里（或有明写理由说明为何必须保留）
- [ ] AC5: 与 `gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools` 交叉标注——
      那条管 `.sh` 的界面一致性，本条管 `.ts` 的交付形态，两者都是"交付面结晶程度不够"的实例

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- packages/quay/scripts/package.sh
- packages/quay/package.json
- tasks/gap-scripts-sprawl-no-uniform-cli-convention-across-57-shell-tools.md（交叉标注）
- tasks/gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact.md

## Dispatch review

reviewer: none
at: 2026-08-06T17:0xZ
changed: 尚未派发/审阅（人裁定"这两条都应当建任务"后由管理者代笔立案）
