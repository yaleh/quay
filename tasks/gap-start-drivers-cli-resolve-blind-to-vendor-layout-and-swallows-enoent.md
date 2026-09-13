---
id: gap-start-drivers-cli-resolve-blind-to-vendor-layout-and-swallows-enoent
title: start-drivers 在第三方项目上静默失败——CLI 解析不认 vendor 布局，且 ENOENT 被吞
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（2026-09-13 实测，全新项目 /home/yale/work/quay-fleet，经 quay-init + upgrade-channel 安装）**：

```
node --experimental-strip-types plugin/scripts/start-drivers.ts --root <third-party> --port 4174
⇒ EXIT=1，stdout 0 字节，stderr 432 字节且全部是 node 的 MODULE_TYPELESS_PACKAGE_JSON warning
⇒ 零诊断。四个 driver 一个没起，web server 没起。
```

**决定性对照（同一命令只加 `--cli`，结论翻转）**：

```
--cli /home/yale/work/quay/plugin/vendor/quay/dist/quay.js
⇒ EXIT=0，promotion: already running / worker: started / outer: started / goal: started
⇒ serve: started (pid=…) on http://0.0.0.0:4174，实测 HTTP 200、52798 bytes、/dashboard
```

底层 `quay driver start --kind promotion --root <third-party>` 单独跑是 **EXIT=0 正常启动**的，
所以故障完全在 start-drivers 这一层。

**根因（已定位到行）**：`plugin/scripts/start-drivers.ts:83` `resolveCliInvocation`：

```ts
const srcTs = path.join(root, "packages", "quay", "bin", "quay.ts");   // quay 开发检出布局
if (fs.existsSync(srcTs)) return { argv0: process.execPath, args: ["--experimental-strip-types", srcTs] };
return { argv0: "quay", args: [] };                                     // ← 第三方项目落到这里
```

两个独立缺陷叠加：

1. **CLI 解析不认 vendor / upgrade-channel 布局。** 它只认 ①显式 `--cli` ②`<root>/packages/quay/bin/quay.ts`
   （只有 quay 自己的开发检出有）③PATH 上的 `quay`。而 **`quay-init.sh` 自己的 upgrade-channel
   runtime migration 正是把 provider 指向 `<plugin-root>/vendor/quay-native`**（init 输出原文：
   `migrated: path './node_modules/quay-native' -> /home/yale/work/quay/plugin/vendor/quay-native`），
   同目录下还有 `<plugin-root>/vendor/quay/dist/quay.js`——**这条安装路径不会把 `quay` 放进 PATH**。
   ⇒ init 与 start-drivers 对「quay 装在哪」的认知不一致，而两者都在同一个 plugin 里。

2. **spawn ENOENT 被吞，违背本文件自己的文档化承诺。** `argv0: "quay"` 不存在时
   `spawnSync` 返回的是 `status: null` + `error: ENOENT`（**不是**非零 status），
   诊断因此丢失。而 `start-drivers.ts` 头注释第 21-24 行逐字写着：

   > Failure paths are RELAYED, never swallowed: `quay driver start` exiting non-zero … has its
   > stderr forwarded verbatim and this script exits non-zero with the same reason.
   > **This is 硬规则 3b: a "read-unable" state must not look like success.**

   实测它做到了「exit 非零」，没做到「relay」——**exit 1 + 零字节输出，与「读不懂」同形**，
   正是该注释声称要防的那一类。

## Plan

1. `resolveCliInvocation` 增加第三个探测分支（优先级置于 dev 源码树之后、PATH 之前）：
   `<plugin-root>/vendor/quay/dist/quay.js` —— plugin root 从
   `process.env.CLAUDE_PLUGIN_ROOT` 或该脚本自身路径（`<plugin-root>/scripts/start-drivers.ts`）解析。
   命中 `.js` 走 `{ argv0: process.execPath, args: [p] }`（`.ts` 分支已有）。
2. `runCli` 的结果判读补 `error`/`status===null` 分支：spawn 失败（ENOENT/EACCES/timeout）时
   把 `inv.argv0`、完整 argv、`error.code` 写进 stderr 再退出——让「CLI 找不到」与
   「CLI 跑了但失败」在输出上可区分，且都不是零字节。
3. 解析成功时把最终选中的 CLI invocation 打印到 stderr 一行（便于第三方现场自证跑的是哪个 quay）。

## Acceptance Criteria

- [ ] AC1（负控制，改前必须红）：在一个**无 `packages/quay/bin/quay.ts`、PATH 上无 `quay`**
      的临时 root 上跑 start-drivers，改前 stdout+stderr（剔除 node warning 后）为 **0 字节**且 exit≠0；
      改后同一条件下 stderr 含被尝试的 argv0 与 `ENOENT`（或已成功解析到 vendor 并启动）。
- [ ] AC2：`resolveCliInvocation` 单测——给定一个只含 `<plugin-root>/vendor/quay/dist/quay.js`
      的伪 plugin root、且 root 下无 `packages/quay/bin/quay.ts`，返回值为
      `{ argv0: process.execPath, args: [<那个 js 的绝对路径>] }`，**不是** `{ argv0: "quay" }`。
- [ ] AC3：`runCli` 单测——spawn 一个确定不存在的 argv0，返回结果被判为失败且携带 `error.code === "ENOENT"`；
      调用方据此产出非空 stderr。
- [ ] AC4：三条解析分支的优先级单测（显式 --cli > dev 源码树 > vendor > PATH），每条各一个断言。
- [ ] AC5：全量 `scripts/test.sh` 绿。

## Definition of Done

在一个**真实的第三方项目**（非 fixture）上，**不传 `--cli`** 跑
`node --experimental-strip-types <plugin>/scripts/start-drivers.ts --root <该项目> --port <空闲端口>`，
四个 driver 全部 `alive=1` 且 web server 返回 HTTP 200。
fixture 满足不算数（硬规则 4 推论三）。

## Touches

- plugin/scripts/start-drivers.ts
- test/start-drivers-cli-resolution.test.mjs
- tasks/gap-start-drivers-cli-resolve-blind-to-vendor-layout-and-swallows-enoent.md

## 相关（查重记录，非重复）

- `gap-driver-runtime-driver-path-anchored-at-project-root-not-dist`（done）—— 机制不同：
  它修的是 **driver-runtime 拼 `<opts.root>/plugin/scripts/<driver>.ts`** 的路径锚点，以及
  **start-drivers 只信 `quay driver start` 退出码**而不读活体状态（其 AC3）。
  本任务修的是 **start-drivers 解析「用哪个 quay CLI」**（`resolveCliInvocation`，该任务未触及）
  与 **spawn 层 ENOENT 未 relay**（`runCli` 的 `error`/`status===null` 分支）。
  机制查重实测：全库 `resolveCliInvocation` / `resolveCli` 命中 **0** 条任务
  （谓词负控制：同一搜索对 `spawnSync` 命中 61、`start-drivers` 命中 13、`argv0` 命中 4 ⇒ 谓词有效，零计数为真零）。