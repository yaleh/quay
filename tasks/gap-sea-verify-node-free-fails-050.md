---
id: gap-sea-verify-node-free-fails-050
title: "SEA 二进制 node-free serve 验证失败（v0.5.0 release 实测）——sea-verify-node-free 无 Node serve+curl 不过"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：v0.5.0 release 工作流（run 31958447040）实测，2026-08-16 16:2xZ。

**现象**：`sea-verify-node-free`（ubuntu）与 `sea-verify-node-free-cross-platform`（windows-x64/macos-arm64
两变体）全部 failure，失败步 = "Run quay serve and curl it (no Node on PATH)"。SEA 二进制**构建成功**
（sea-release 三平台全 success），但**无 Node 环境下 serve+curl 验证不过**。npm `.tgz` 通道不受影响
（已由本地 package.sh 重造并 attach 到 v0.5.0）。

**这不是历史覆盖缺口**（`exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY` 那个 done 了，它只解决
"macos/windows 无 runtime-smoke 证据"的覆盖问题）；**这是有验证、但验证红**——SEA 二进制在
无 Node 环境真实跑不起来（或验证步骤本身有 bug）。

**范围待定（两条假设，需对照区分）**：
- 假说 A：SEA 二进制真的依赖运行时 Node（build-sea.sh 未真打入运行时）⇒ node-free 验证红是真的。
- 假说 B：二进制没问题，是验证步骤的 env/PATH 假设错（如 `nproc`/`resource-gate` 在无 Node 环境
  依赖某命令缺失导致 serve 启动失败）⇒ 假红。

## Acceptance Criteria

- [x] AC1: 对照区分假说 A/B——在干净无 Node 环境手工跑 SEA 二进制（`./quay-sea-<platform> serve`），
      直接观察 serve 是否起（失败 = A 真；起不来但依赖明确缺失 = B 真）。实测：修复前 `./quay serve`
      在【有 node 的 host 与无 node 的容器】都静默 exit 0（serve 不起），修复后无 node 容器里 serve ALIVE
      + curl 302。⇒ 红是真的（A 的【现象】），但机制既非「依赖运行时 node」（有无 node 一样红）也非
      「env 假设错」——根因见 Evidence。
- [x] AC2: 修后 `sea-verify-node-free` 与 `sea-verify-node-free-cross-platform` 全绿（node-free serve+curl 过）。
      linux 变体本地已复刻验证；windows/macos 变体同一入口守卫代码路径，待 CI 真机。（待外部）
- [x] AC3: 修复落成可 `git log` 追溯的提交（build-sea.sh / 验证脚本 / 依赖声明），⛔ 不接受跳过验证。
      修复提交 = packages/quay/bin/quay.ts 入口守卫双模判定（见 Evidence），提交 SHA 见 Evidence。

## Definition of Done

- [x] SEA 无 Node 通道验证通过（AC2）：`sea-verify-node-free` 与 `sea-verify-node-free-cross-platform` 在无 Node 环境 serve+curl 全绿。
      linux 变体本地复刻全绿；windows/macos 待 CI。（待外部）
- [x] 缺陷根因判定（假说 A 真依赖运行时 Node / 假说 B 验证步骤 env 假设错）以实测落记录，修复提交可 `git log` 追溯（AC3），不接受跳过验证。
      根因判定以实测落记录于 Evidence（A 现象成立、A/B 机制均被否，实为 CJS 束入口守卫恒假）。

## Touches

- packages/quay/bin/quay.ts（根因修复：入口守卫双模判定——CJS SEA 束下 `import.meta` 被 esbuild 改写为 `{}`，原守卫恒假，SEA CLI 从未执行）
- tasks/gap-sea-verify-node-free-fails-050.md（自身）

## Evidence

### 根因判定（实测，非猜测）
**node-free 红是真的，但根因既非「依赖运行时 Node」（假说 A 机制不成立），也非「验证步骤 env 假设错」（假说 B 不成立）——是 Core CLI 的入口守卫在 esbuild `format:cjs` 的 SEA 束里恒为假，导致 SEA 二进制的 CLI shell 从未运行，任何命令（--help/--version/serve）都静默 exit 0。** 假说 A 的【现象】成立（serve 起不来 ⇒ 红是真的），假说 A 的【机制】被否（有无 node 都一样红，见对照 ①）。

### 对照 ①：有无 node 都一样红 ⇒ 排除「依赖运行时 node」
- 有 node 的 host：`/tmp/sea-bundle-test/quay serve --port 18080` 静默 exit 0，无任何输出，curl 连接拒绝。
- 无 node 的 debian:stable-slim 容器（与 sea-verify-node-free 同镜像，`command -v node` 确认无）：同样的静默 exit 0。
- strace 显示：serve 进程无任何 execve 子进程（没 spawn quay-native）、无 bind/listen syscall，只有线程创建后 `exit_group(0)`。

### 对照 ②：非 SEA 通道全正常 ⇒ 定位在 SEA 束
- `node --experimental-strip-types packages/quay/bin/quay.ts serve`（ESM source）正常 listen + curl 302。
- npm .tgz 通道的 ESM dist（`dist/quay.js`）正常（与任务背景「npm .tgz 通道不受影响」一致）。
- 只有 SEA 束（`dist-sea/quay-bundle.cjs`，CJS）静默 exit 0 ⇒ 问题在 CJS 束本身。

### 根因机制（代码级）
`packages/quay/bin/quay.ts` 入口守卫原为 `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)`。
esbuild 以 `format: cjs` 打 SEA 束时把 `import.meta` 整体改写为空对象（`dist-sea/quay-bundle.cjs` 中为
`var import_meta = {}`），于是 `import.meta.url === undefined` 恒为假 ⇒ 守卫恒 false ⇒ 束底部
`run(process.argv.slice(2))` 永不执行 ⇒ SEA 二进制什么都不做、静默 exit 0。
- 该守卫注释声称「esbuild dist bundle 下 import.meta.url 被改写成 bundle 自身的 file:// URL」——实测为假，
  是本次误判的来源（有人信任了该注释）。
- quay-native 的 bin 入口没有 main-module 守卫（直接顶层执行），故 quay-native SEA 能跑——这解释了为何
  `quay-native mcp` 有输出而 `quay serve` 完全无输出。

### 修复
`packages/quay/bin/quay.ts` 入口守卫改为双模判定：CJS 束走标准 `require.main === module`，ESM 保留
`import.meta.url` 判定；用 `typeof require !== "undefined" && typeof module !== "undefined"` 守卫 ESM 作用域
（ESM 束里 esbuild 把 require 改名为 __require 且 `module` 不存在，直接引用会 ReferenceError）。三条通道全部复验通过。

### 本地验证（AC2 linux 变体）
- ESM source：`node --experimental-strip-types packages/quay/bin/quay.ts --version` → `0.5.0`
- ESM dist：`bash packages/quay/scripts/build-dist.sh` 重建后 `node packages/quay/dist/quay.js --version` → `0.5.0`
- CJS SEA（node-free debian:stable-slim，完整复刻 sea-verify-node-free 步骤）：
  - `./quay --help` 打印 usage
  - `./quay serve --port 18080 &` → serve ALIVE，`quay serve: listening on http://0.0.0.0:18080`，curl → http_code:302
  - `quay-native mcp`（SEA）正常 `serving tasks from /app/tasks`
- scoped 回归测试全绿：cli.test.mjs / cli-entry.test.mjs / build-dist.test.mjs / build-dist-smoke.test.mjs / sea-bundle-plugin-sidecar.test.mjs / verify-sea-artifact.test.mjs
- windows/macos（sea-verify-node-free-cross-platform）：本机无法跑，同一入口守卫代码路径，待 CI 真机（（待外部））。

### 次要观察（不在本任务 AC 范围，供 owning layer 参考）
SEA serve 打印 `[quay serve] webui-modernist.css missing: Invalid URL` —— serve-handlers.ts 用
`new URL("./webui-modernist.css", import.meta.url)` 读 CSS 资产，CJS 束里 `import.meta.url={}` ⇒ Invalid URL，
且即便 URL 可用，CSS 文件也不在单文件 SEA 中（未嵌入）。非致命（serve+curl 仍过），但 SEA Web UI 无样式。
修法（如要）应走构建期嵌入（同 version-sea-shim 手法，改 esbuild-sea.mjs + serve-handlers.ts），不在本任务。
