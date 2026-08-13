---
id: gap-cli-import-migration-ts-typecheck-regression
title: cli-import-migration fan-in 引入 tsc 回归（73 错，ctx 类型注解丢失）
status: ready
labels:
  - gap
  - defect
---

**type:** execution

## Proposal

`gap-cli-import-command-migration-into-src` fan-in（commit 7b5e0385）把 17 个 verb handler 从
`packages/quay/bin/quay.ts` 的 dispatch 体逐字搬进 `packages/quay/src/cli/*.ts`，但**上下文类型注解
在搬迁中被丢弃**。根因模式：handler 从 `CliCtx` 解构（如 `handleGateLog({ sub, rest }: CliCtx)`），
内部却引用 `vf.gate` / `vf.file` / `vf.json` / `vf.provider` / `vf.root`（`vf = parseVerbless(...).flags`），
而 `src/cli/shared.ts` 的 `parseVerbless` / `parseFlags` / `resolveJsonFlag` / `resolvePageSize`
**没有显式返回类型** ⇒ `vf` 推断为 `{}`，每个 `vf.<field>` 都是 TS2339。

**证据**：`npx tsc --noEmit -p tsconfig.json` 全量 73 个错误，全部在 `packages/quay/src/cli/*`：
lifecycle 17、migrate 16、gate 11、run 6、init 5、gate-log 5、manager 4、serve 3、task-list 2、
shared 2、task-edit 1、adr 1（adr.ts:45 是 `FileHandle` overload 单独问题——路径参数丢了类型）。

**性质**：纯类型注解恢复，零行为变更（golden-replay 等价由 `packages/quay/test/cli.test.mjs` 验证）。

## Plan

1. 给 `src/cli/shared.ts` 的四个 helper 补显式返回类型（正本字段形态在 pre-migration
   `git show 96ec81c7:packages/quay/bin/quay.ts`）：
   - 新增 `CliFlags = Record<string, any>`（flags 是动态键袋子——string / boolean / 重复 flag 数组）。
   - `parseFlags(argv: string[]): { flags: CliFlags; positional: string[] }`
   - `parseVerbless(sub, rest): { flags: CliFlags; id: string | undefined }`
   - `resolveJsonFlag(flags: CliFlags): { json: boolean } | null`
   - `resolvePageSize(flags: CliFlags): { pageSize: number | null; error: string | null }`
2. `context.ts` 的 `CliCtx.flags` 从 `Record<string, unknown>` 收紧为 `CliFlags`
   （修 task-list 的 `prefix.toUpperCase()` 与 adr.ts:45 的 `fs.readFile(flags["body-file"])`）。
3. `task-edit.ts:174` 的 `...(patch.extra ?? {})` 展开 `unknown` → 断言为 `Record<string, unknown>`（TS2698）。
4. `withProvider(fn, { providerId, root })` 的 options 参数补 `{ providerId?: string; root?: string }`。
5. 验证：`npx tsc --noEmit -p tsconfig.json` → **0 错误**；`ts-typecheck-gate.test.mjs` 隔离绿；
   `scripts/test.sh --for-task gap-cli-import-migration-ts-typecheck-regression` scoped 绿。

## AC

- [ ] AC1: `npx tsc --noEmit -p tsconfig.json` 0 错误（73 → 0）
- [ ] AC2: `ts-typecheck-gate.test.mjs` 隔离绿（tsc 门被 scoped 覆盖，round-52 教训）
- [ ] AC3: 行为不变——`packages/quay/test/cli.test.mjs` golden-replay 未退化
- [ ] AC4: `scripts/test.sh --for-task gap-cli-import-migration-ts-typecheck-regression` scoped 绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] tsc 错误数 before/after 记录（73 → 0）
- [ ] scoped 门 + ts-typecheck-gate 隔离绿
- [ ] 只提交本任务改动的文件到 `task/gap-cli-import-migration-ts-typecheck-regression` 分支

## Touches

- packages/quay/src/cli/shared.ts
- packages/quay/src/cli/context.ts
- packages/quay/src/cli/task-edit.ts
- tasks/gap-cli-import-migration-ts-typecheck-regression.md（自身）

## Test-Files

- packages/quay/test/ts-typecheck-gate.test.mjs
- packages/quay/test/cli.test.mjs
