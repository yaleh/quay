---
id: gap-fan-in-ts-typecheck-gate-cannot-read-third-party-config
title: fan-in ts-typecheck 闸在第三方 TS 项目上结构性必然失败（canonical 回落写死 quay 的 packages/
  布局 + loader 导入基准错用被取证项目）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**判据**：第三方（非 quay 自身布局的）TypeScript 项目里，一条**新增/移动了 `.ts` 文件**的任务，
其机械 fan-in 的 ts-typecheck 闸**必须**能用该项目自己的类型检查命令跑，而不是必然失败。

**实测缺陷（2026-09-14，ad-arm1 上的真实第三方项目 archguard，非推断）**：

```
fan-in-ts-typecheck-gate: typecheck RED — BLOCKED (exit 1); do NOT fan in on scoped-green alone
fan-in-ts-typecheck-gate: last lines:
error TS5058: The specified path does not exist: 'packages/*/'.
```

`task TASK-ERRMSG-TOTAL`（实现提交 `fe6e1652`，scoped 门绿）因此 **`exited-not-landed`**，
worktree 与分支被保留。archguard 里根本没有 `packages/` —— 那段命令是 **quay 自己的**布局。

**根因（两段，任一段单独成立都足以让第三方项目读不到自己的配置）**：

1. `plugin/scripts/fan-in-ts-typecheck-gate.ts:81`
   `CANONICAL_TYPECHECK_CMD = 'for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done'`
   —— 缺省回落值写死了 quay 的单仓布局。无 `packages/` 时 `for` 拿到未展开的字面量，
   `npx tsc -p 'packages/*/'` ⇒ TS5058（失败形态与「项目类型有错」同形，硬规则 3b）。

2. 同文件 `resolveTypecheckCommand()`（`:88` 起）读目标项目配置的方式是
   `await import(path.join(moduleRoot, "packages/quay/src/gate/config/loader.ts"))`，其中
   `moduleRoot = repoRoot(configRoot)` 而 `configRoot` 是**被 fan-in 的那个项目**。
   第三方项目下 `packages/quay/src/gate/config/loader.ts` **不存在** ⇒ `import` 抛 ⇒ `catch {}`
   ⇒ 回落到 (1) 的 canonical。**⇒ 即使该项目在 `.quay/config.yml` 里正确定义了
   `gates.testPass[].name == "ts-typecheck"`，那份配置也永远不会被读到。**

**⇒ 结构性后果**：任何第三方 TS 项目里「新增或移动 `.ts` 文件」的任务在本项目里**不可能落地**
（`requiresTypecheck` 只看 `git diff --diff-filter=ACR` 的 `.ts` 条目，见同文件 `listNewMovedTsFiles`），
而失败读数（`typecheck RED`）与「实现真的写错了类型」完全同形。

## Plan

1. 让 (2) 的配置读取**穿过项目边界**：`loader` 的导入基准不能是被取证项目自己（它没有 quay 源码），
   必须住在脚本自己那一侧（`$SCRIPT_DIR/../..` 或交付物根）——这正是 `repo-root.ts` 存在的理由，
   而这里用错了它的入参（`repoRoot(configRoot)` 而不是 `repoRoot(SCRIPT_DIR)`）。
2. 让 (1) 的 canonical 回落**不再假定 quay 布局**：读不到该项目自己的 `ts-typecheck` 声明时，
   取一个对第三方项目成立的可区分取值（例如回落 `npx tsc --noEmit`，或按 3b 报
   `not-evaluated` 而不是把一个必然失败的 quay 专属命令当成合格判定）。⛔ 二者择一必须在
   代码里写明理由，⛔ 不用「加一个 `packages/` 空目录」的办法盖住。
3. 负/正控制（hermetic）：一个**没有 `packages/` 树、且 `.quay/config.yml` 里声明了**
   `name: ts-typecheck` 的夹具项目 ⇒ 断言用的是**该项目声明的命令**；把该声明去掉 ⇒ 断言回落到
   一个**对第三方项目成立**的命令（⛔ 不是 `packages/*/`）。两条都要能取假。

## Acceptance Criteria

- [ ] AC1 夹具：无 `packages/` 树 + `.quay/config.yml` 有 `name: ts-typecheck` ⇒ `resolveTypecheckCommand` 返回**该项目声明的字符串**（逐字相等），⛔ 不是 canonical。
- [ ] AC2 夹具：同一项目删掉该声明 ⇒ 返回值**不含** `packages/*/`（贴返回值原文）。
- [ ] AC3 在真实第三方项目（archguard，ad-arm1）上复跑本闸：一条改动 `.ts` 的既有任务不再以 TS5058 收场（贴前后两条读数）。
- [ ] AC4 既有控制不回归：`plugin/test/fan-in-ts-typecheck-gate.test.mjs` 全绿。

## Definition of Done

- [ ] `resolveTypecheckCommand` 在**没有 quay 源码树**的项目里能读到该项目自己的 `ts-typecheck` 声明，改动可在 git log 中查到。
- [ ] AC3 的真实第三方复跑读数（前：TS5058；后：该项目自己的命令）已落档。
- [ ] 未改坏的行为：quay 自身仓库的 ts-typecheck 判定逐字不变。

## Touches

- plugin/scripts/fan-in-ts-typecheck-gate.ts
- plugin/test/fan-in-ts-typecheck-gate.test.mjs
- tasks/gap-fan-in-ts-typecheck-gate-cannot-read-third-party-config.md
