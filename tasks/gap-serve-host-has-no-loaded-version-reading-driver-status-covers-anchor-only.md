---
id: gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only
title: serve 宿主没有"加载版本 vs 已安装版本"读数——driver status 的 loaded_version 只覆盖
  anchor，/health 的 latestCodeCommitAt 对已安装产物恒为 null
status: todo
labels:
  - gap
  - priority:p2
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**症状(2026-10-06,cantus 实测)**:插件 pin 于 11:22:42Z 从 0.15.0 换成 0.16.0,anchor 四个 driver 仍跑 0.15.0(`quay driver status --kind worker` 正确报出 `loaded-version-behind: loaded=0.15.0 installed=0.16.0`),而同一 workspace 的 `quay serve` 宿主没有任何等价读数,无从知道它跑的是哪一版。

**机制(已读代码)**:
1. `plugin/scripts/driver-runtime.ts` 的 loaded-version 读数(约 2455 行起;状态 current/behind/ahead/not-evaluated,来源 `/proc/<pid>/cmdline`)针对 anchor/driver,没有针对 serve 宿主的调用。
2. serve 的 `/health` 暴露 `latestCodeCommitAt`/`evaluated`(`packages/quay/src/serve.ts` 约 212-250 行):它读 workspace 中 serve 源码的 git 提交时间并与进程启动时间比(`isStale`);对装在插件缓存里的第三方项目,workspace 里没有 quay 源码提交,输入恒为 null ⇒ `evaluated:false`——对已安装产物结构上取不到,与 anchor 曾经恒报 `supervisor_stale=fresh/unwatched` 同形。`plugin/scripts/start-drivers.ts` 的 STALE⇒重载分支用的同一个时间比较,不是版本号。
3. 输入其实够用:serve 宿主的 `/proc/<pid>/cmdline` 是真实版本目录(`plugin/bin/quay` 用 `cd -P` 解析真实路径,2026-10-06 实测 pid 4000576 的 cmdline 为 `node …/cache/quay/quay/0.16.0/vendor/quay/dist/quay.js serve`)。缺的只是有人去读。

**修法**:serve 宿主增加与 anchor 同一套的 loaded-version 读数——**复用** driver-runtime 的读版本逻辑(⛔ 不复制一份),对象为 `.quay/server.json` 载体里的宿主 pid;在 `quay server status`(`packages/quay/src/cli/server.ts`,JSON 与人读输出)中输出 `loaded_version`(current/behind/ahead/not-evaluated)、`loaded`、`installed`、`source`(proc-cmdline)。cmdline 读不出版本目录(例如符号链接路径、进程已死、非 Linux)⇒ `not-evaluated` 并给原因,⛔ 不与 `current` 同形。只报告,⛔ 不自动重启。注意 Core(`packages/quay`)不得静态依赖 plugin 层,需经现有动态解析手段(`plugin-root.ts` 的 `resolvePluginScript*`)取用 driver-runtime 的读版本函数,或把该纯函数提到 Core 与 plugin 共享的位置——由实现者选,AC 约束行为与单一实现。

**不在范围**:自动重载 stale 宿主;serve 进程级监管与 systemd 单元模板;/health 的 latestCodeCommitAt 语义改造(保留,另案)。

<!-- dedup-ref -->相关(追溯,非前置):gap-driver-status-loaded-vs-installed-version-drift(done,anchor 的 loaded_version);gap-project-quay-pointer-is-init-plugin-root-and-version-records-derive-from-it(done,`pointer` 读数)。

## Touches
- `packages/quay/src/cli/server.ts`
- `packages/quay/src/server-state.ts`
- `plugin/scripts/driver-runtime.ts`
- `packages/quay/test/server-status-web-control-same-pid.test.mjs`
- `plugin/test/driver-runtime-loaded-version-drift.test.mjs`
- `tasks/gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only.md`

## AC
- [ ] 新增用例(`packages/quay/test/server-status-web-control-same-pid.test.mjs` 或同目录新测试):伪造 `.quay/server.json` 载体指向一个 cmdline 含 `…/cache/quay/quay/0.15.0/vendor/quay/dist/quay.js serve` 的夹具进程,伪造注册表安装版本 0.16.0 ⇒ `quay server status --json` 含 `loaded_version:"behind"`、`loaded:"0.15.0"`、`installed:"0.16.0"`、`source:"proc-cmdline"`;版本相同 ⇒ `current`;宿主 pid 已死或 cmdline 读不出版本目录 ⇒ `not-evaluated` 且 `reason` 非空(与 `current` 取值不同)。`node --experimental-strip-types --test` 对应测试文件退出 0。
- [ ] 取假:把判定改成"总是 current"后 behind 用例红(附实跑输出)。
- [ ] 单一实现:`grep -rn "proc.*cmdline" packages/quay/src plugin/scripts --include=*.ts` 排除测试后,读 `/proc/<pid>/cmdline` 取版本的逻辑只有一份实现被 anchor 与 serve 共用(先列出改前命中)。
- [ ] 版本比较用目录里的 `VERSION`/`plugin.json`,⛔ 不用 `quay --version` 输出:夹具让 `--version` 打印与 VERSION 不同的值,读数仍取 VERSION。
- [ ] Core 不新增对 plugin 层的静态 import:`bash scripts/test.sh --for-task gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only` 退出 0 且执行了 ≥1 个测试文件(其中包括既有的依赖方向/导入图检查)。
- [ ] 读生产载体:在本机 cantus(宿主与 pin 版本不一致的真实 workspace,若届时已一致则在临时 workspace 用旧版本缓存起一个宿主再升级 pin)实跑 `quay server status --json`,读出 `loaded_version` 与 `driver status` 的 anchor 读数并列;原文贴进完成记录。该 AC 在撤销本任务改动后必须变红(负控制)。

## DoD
真实落地:一个跑着旧版本的真实 serve 宿主,在插件 pin 升级后,`quay server status` 读出 `loaded_version: behind` 并给出 `quay server restart` 提示;读不出时为 `not-evaluated`。仅 fixture 绿不算完成。
