---
id: gap-archguard-scope-expand-provider-packages-experiments
title: archguard 扫描 scope 扩至 quay-native/quay-github/quay-backlog/experiments（人
  2026-09-06 裁定，接现有 archguard-runner.ts SCOPES 数组）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

> **人 2026-09-06 裁定（逐字）**：「把 quay-native/quay-github/quay-backlog/experiments 加进扫描。」——回应 manager 现场复核 `docs/proposals/archguard-generation-era-primitives.md` §2.10 记录的盲区①（3 个 provider 包 + `experiments/` 从未被 archguard 扫描）今天（2026-09-05/06）依然真实存在的报告。

## Proposal

**现状（manager 读码 + 现场复核，非转述）**：archguard 只有一个正本机制决定"扫哪里"——`plugin/scripts/archguard-runner.ts` 里字面量数组 `SCOPES`（`gap-archguard-zero-production-calls`/`gap-archguard-structural-gate-in-fan-in-driver` 两个已 done 任务落地，接进 fan-in driver 机械步骤，`每轮`跑）：

```
const SCOPES = [
  { source: "packages/quay/src", label: "src" },
  { source: "plugin/scripts",    label: "scripts" },
];
```

`.archguard/query/manifest.json`（MCP 交互查询用的索引，`archguard_find_entity`/`archguard_get_dependencies` 等工具读它）是 `analyze` 跑完后的**副产物**——manifest 里两个 scope 的 key/entityCount 与 `SCOPES` 数组逐字对应，无独立配置文件（仓库里没有 `archguard.config.json`）。**⇒ 只有一处要改：`SCOPES` 数组**，两个消费面（fan-in 结构闸 + MCP 查询索引）会同步跟上，不是两套独立机制。

`packages/quay-native`（30 个源文件）/`packages/quay-github`（18）/`packages/quay-backlog`（6）三个完整 Provider 实现，以及 `experiments/quay-perpetual-stream/scripts`（59 个文件，是 `plugin/scripts` 的结构对应物——P2 身份复制检测器已发现的 45 对字节相同镜像文件正长在这两个目录之间）**都不在 `SCOPES` 里**，因而对结构环检测（`sccCount`）与 MCP 交互查询完全不可见。

**现场探测已验证的两个事实（非假设，见 Invoke Evidence）**：
1. **四个候选目录真实可解析、非退化**——手工 `archguard analyze` 单独跑通 `packages/quay-native/src`（4 entities/6 relations，sccCount=0）与 `experiments/quay-perpetual-stream/scripts`（**649 entities/565 relations**，sccCount=0）；`experiments` 被根 `tsconfig.json` 的 `exclude` 排除**不影响** archguard 解析（archguard 不依赖该 tsconfig，直接语法解析源码）。
2. **⚠️ 一个真实的落地陷阱**：archguard 的输出 label 默认取 source 目录的 **basename**——`packages/quay-native/src`、`packages/quay-github/src`、`packages/quay-backlog/src` 三者 basename 全是 `src`，与既有 `packages/quay/src` 的 label `"src"` **撞名**；若直接加四条 `{source, label: basename(source)}` 形态的 entry，后跑的会静默覆盖 `.archguard/output/src/class/all-classes.json`，四个 scope 的产物互相吃掉、且吃掉既有 `quay/src` 那一条的数据（我探测时已实测复现：三个包顺序跑完，`output/src/` 目录里只剩最后一个包的 4 entities）。**⇒ 新增的每个 label 必须显式取一个不与既有两条、也不与彼此冲突的字符串**（如 `quay-native-src`/`quay-github-src`/`quay-backlog-src`/`experiments-scripts`），不能沿用「basename 默认」的隐含约定。

## Plan

1. `plugin/scripts/archguard-runner.ts` 的 `SCOPES` 数组追加 4 条，label 显式去重（不用 basename 默认值）：
   - `{ source: "packages/quay-native/src", label: "quay-native-src" }`
   - `{ source: "packages/quay-github/src", label: "quay-github-src" }`
   - `{ source: "packages/quay-backlog/src", label: "quay-backlog-src" }`
   - `{ source: "experiments/quay-perpetual-stream/scripts", label: "experiments-scripts" }`
2. 确认 `readScopeSignal`/`runAnalyze`/fail-closed 逻辑对 6 个 scope 通用（不依赖数组长度为 2 的隐含假设——grep 一遍 `archguard-runner.ts` 全文，若发现写死 "两个 scope" 字样的地方一并改）。
3. `plugin/scripts/worker-driver.ts` 里接了 archguard 结构闸的 fan-in 机械步骤原样复用（它读 `SCOPES` 而非重复硬编码——若发现该处也独立写了 scope 列表，视为 5b「修好一处≠全局」的实例，一并改）。
4. 更新相关文档/清单里出现「两个 scope」字样的地方（`plugin/scripts/capability-catalog.sh` 的 `INVALIDATION[archguard-runner.ts]`「两个 scope（packages/quay/src + plugin/scripts）目录结构不变」等）——保持它们与实际 scope 数一致，避免下一次审计再靠人工复核才发现口径漂移。
5. **本任务不做**：不新增 `archguard.config.json` 或任何声明式配置层（现有 `SCOPES` 字面量数组已是唯一正本且够用，CLAUDE.md 硬规则「先查有没有同类工具，不手搓新机制」——加配置文件是没有理由的额外抽象）；不扩大到 `experiments/` 下 `test/`/`fixtures`/`milestones` 子目录（本任务只覆盖用户点名的 `experiments`，具体解释为其结构对应物 `experiments/quay-perpetual-stream/scripts`，与 `plugin/scripts` 的既有 scope 一一对应）；不改动 P1/P2/P4/P5 检测器（它们走独立的 grep/位置判定，不依赖 archguard scope，见 `docs/proposals/archguard-generation-era-primitives.md` §2.10 原有论证——本任务与那条论证不矛盾，只是把 archguard 自身的结构环检测面扩大，不代替 P-series）。

## Acceptance Criteria

- [ ] AC1（能取假，scope 数量与来源）：`plugin/scripts/archguard-runner.ts` 的 `SCOPES` 数组含 6 条，新增 4 条的 `source` 精确匹配 Plan 步骤1 列出的 4 个路径；（⛔ 少于 6 条，或路径拼写/大小写不匹配 ⇒ 假）。
- [ ] AC2（能取假，label 无冲突——对着上面探测到的真实陷阱验证）：6 个 label 两两不同（`node -e` 或等价脚本对数组去重计数=6）；`.archguard/output/` 下产出 6 个不同的输出子目录，每个子目录的 `class/all-classes.json` 的 `metricVector.totalEntities` 互不因覆盖而清零/雷同（⛔ 任意两个 scope 输出目录同名，或某 scope 产物被后跑的另一 scope 覆盖 ⇒ 假——这正是探测阶段实测复现过的失败模式）。
- [ ] AC3（能取假，新增 scope 非退化解析）：4 个新 scope 各自的 `totalEntities > 0`（experiments-scripts 应 ≥ 500，量级对齐探测阶段实测的 649；quay-native-src/quay-github-src/quay-backlog-src 允许个位数到几十不等，但不得为 0）；（⛔ 任一新 scope entities=0 ⇒ 假——空解析与真无内容不可区分需要人工核实该 scope 是否语言/路径写错）。
- [ ] AC4（能取假，既有 2 个 scope 不回归）：加入新 scope 后，`packages/quay/src`（label 仍为 `src`）与 `plugin/scripts`（label 仍为 `scripts`）两个既有 scope 的 `totalEntities`/`totalRelations` 与加入前的基线（Invoke Evidence 记录的加入前读数）一致或因代码自然演进而合理变化（不能因新增 scope 的接线而意外清零或跌至个位数）；（⛔ 既有两个 scope 的产物因本次改动被破坏 ⇒ 假）。
- [ ] AC5（能取假，负控制——sccCount fail-closed 逻辑对 6 个 scope 仍生效）：把 `runAnalyze` 对某一个新增 scope 的调用注掉（或删掉该 scope 对应的产物文件），`archguard-runner.ts --root .` 必须 exit 1（fail-closed 覆盖到新 scope，不是只覆盖旧的 2 个）；（⛔ 仍 exit 0 ⇒ 假——新 scope 被静默排除在 fail-closed 判定之外）。
- [ ] AC6（能取假，生产载体——硬规则 4 推论三，落地后主检出真跑一次，不采信 worktree/fixture）：`.archguard/metrics-history.jsonl` 在本任务落地并经过一次 post-landing fan-in 后，出现一条 `scopes` 数组长度为 6 的新记录，其 `timestamp` 晚于本任务实现的落地提交时刻；同时 `.archguard/query/manifest.json`（MCP 查询索引）的 `scopes` 数组也变为 6 条（验证"改一处、两个消费面同步跟上"的 Proposal 论断，而非停在实现完成、未在生产真跑过——若 manifest.json 不随 analyze 自动更新，则本任务需补一个显式的 reindex 接线并把该发现记进本节）；（⛔ 落地后无新记录，或 manifest.json 仍停在 2 条 ⇒ 假）。
- [ ] AC7（DoD 负控制）：`scripts/test.sh` 全量 suite 与本任务 `--for-task` scoped 静态检查在改动后仍绿（无回归）。

## Definition of Done

`archguard-runner.ts` `SCOPES` 扩至 6 条（新增 quay-native-src/quay-github-src/quay-backlog-src/experiments-scripts，label 显式去重不撞既有 2 条）；fail-closed 逻辑与既有 2 个 scope 的产物均不回归；AC1-AC7 全部满足并有真实生产载体证据（非 fixture/worktree 自证）；文档/清单里的「两个 scope」口径同步更新。

## Touches

- plugin/scripts/archguard-runner.ts（SCOPES 数组追加 4 条 + 通用性核实）
- plugin/scripts/worker-driver.ts（若发现独立写了 scope 列表则同步；否则本文件不改，仅核实原样复用）
- plugin/scripts/capability-catalog.sh（`INVALIDATION[archguard-runner.ts]` 等「两个 scope」口径字样更新为 6 个）
- .archguard/metrics-history.jsonl（生产载体，AC6 证据落点，gitignored 不提交但需现场核验）
- .archguard/query/manifest.json（MCP 查询索引，AC6 证据落点，gitignored 不提交但需现场核验）
- plugin/test/archguard-structural-gate-fan-in.test.mjs（若既有测试对 SCOPES 长度/label 有硬编码断言则同步更新）
- tasks/gap-archguard-scope-expand-provider-packages-experiments.md（自身）

## Invoke Evidence

**探测阶段真实实测（立案前，job dir 隔离 work-dir，不污染生产 `.archguard/`）**：
```
$ archguard analyze --lang typescript --format json --work-dir <scratch> -s packages/quay-native/src
  → output/src/class/all-classes.json: totalEntities=4, totalRelations=6, sccCount=0（最终读数，因下方 quay-backlog 顺序跑最后而覆盖——见下方陷阱记录）
$ archguard analyze --lang typescript --format json --work-dir <scratch> -s experiments/quay-perpetual-stream/scripts
  → output/scripts/class/all-classes.json: totalEntities=649, totalRelations=565, sccCount=0

⚠️ 陷阱复现：packages/quay-native/src、packages/quay-github/src、packages/quay-backlog/src 三次 analyze
   均写入同一个 output/src/（basename 撞名），最终该目录内容 = 最后一次跑的 quay-backlog（4 entities）——
   quay-native/quay-github 各自的产物已被静默覆盖、无法从残留文件区分。AC2 直接对着这个复现的失败模式验证。
```

**加入前基线（用于 AC4 负控制对照，落地时须重新现场核对一次，不采信本次探测的旧读数）**：`.archguard/query/manifest.json` 当前（2026-09-05 复核）：`src`（= packages/quay/src）367 entities/758 relations；`scripts`（= plugin/scripts）2017 entities/1370 relations。
