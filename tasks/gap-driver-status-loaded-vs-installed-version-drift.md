---
id: gap-driver-status-loaded-vs-installed-version-drift
title: driver status 以查询者自己的 kernel 目录判新鲜度：运行中 anchor 落后已安装版本 3 天仍报 fresh
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：`quay driver status` 的新鲜度判定（`plugin/scripts/driver-runtime.ts:2145` `statusForKind` → `supervisor_stale` / `source_watch` / `source_watch_dir`）比较的是**执行 status 命令的那个 kernel 自己的目录**，而不是**正在运行的 anchor/driver 进程实际加载的目录**。插件升级后，旧 anchor 仍在跑旧 cache 目录里的代码，status 却从新 kernel 的角度报「fresh」。另外 `.quay/config.yml` 的 provider `path` 写的是安装当时的 cache 版本目录，插件升级后不会跟着变，这是第二个漂移源。

**生产实测（2026-09-23，本机）**：
- claudecodeui 的 anchor（pid 2166980）自 2026-09-20 10:28 起运行 `…/quay/0.10.0/scripts/dist/driver-anchor.js`（`ps` 可读）；
- 插件已安装 0.11.0（`~/.claude/plugins/installed_plugins.json`，2026-09-23 14:42）；
- 用 0.11.0 kernel 执行 `driver-runtime.js status --kind worker --root /data/home/yale/work/claudecodeui --json`，读出 `supervisor_stale: "fresh"`、`source_watch: "unwatched"`、`source_watch_dir: "…/0.11.0/scripts/dist"`——**一个落后 3 天的进程被报成 fresh**（硬规则 3b：读错对象 ⇒ 与合格同形）；
- `.quay/config.yml` 的 provider `path` 仍指向 `…/0.10.0/vendor/quay-native`。

后果：上游 `caeca6f9c`（2026-09-20 17:14 +0800，晚于 0.10.0 cache 的构建时刻 10:18）等修复在 claudecodeui 整整 3 天未生效，而没有任何读数能显示这一点。

**修法（方向）**：
1. anchor/driver 启动时把**自己加载的 kernel 目录与版本**（`VERSION` 文件、构建指纹）写进它的运行记录（pid 文件或 round 载体）。
2. `driver status` 读**运行中进程**的这份记录（或 `/proc/<pid>/cmdline` 作为直接量，硬规则 4b），与「当前已安装版本」（本 kernel 的 VERSION + `installed_plugins.json` 中对应 scope 的条目）比较，输出三态：`loaded-version-current` / `loaded-version-behind`（附两个版本与安装时刻）/ `not-evaluated`（读不到运行记录）。
3. 同时比较 `.quay/config.yml` provider `path` 中的版本段与已安装版本，不一致时单列 `config-provider-path-behind`。
4. `loaded-version-behind` 在人类可读输出中放在第一行，并给出 `quay driver restart` 的提示；⛔ 不自动重启（重启时机由人或 manager 决定）。

## AC

- [ ] `node --test plugin/test/driver-runtime-loaded-version-drift.test.mjs` 退出 0（新文件），用例：①运行记录声明 kernel 0.10.0、当前安装 0.11.0 ⇒ `loaded_version: "behind"`，并带 `loaded: "0.10.0"`、`installed: "0.11.0"`；②同版本 ⇒ `current`；③运行记录缺失 ⇒ `not-evaluated`（⛔ 不与 `current` 同形）；④config provider path 版本段落后 ⇒ `config_provider_path: "behind"`。
- [ ] 取假：把判定改回「以查询者自己的目录为准」后，用例①红（附实跑输出）。
- [ ] 实跑：在本机对 claudecodeui 执行含修复版本的 `driver status --kind worker --json`（anchor 未重启时）读出 `loaded_version: "behind"`；输出原文贴进完成记录。
- [ ] `bash scripts/test.sh --for-task gap-driver-status-loaded-vs-installed-version-drift` 退出 0，且执行了 ≥1 个测试文件。

## DoD

真实落地判据：对一个真实运行中、加载旧版本的第三方 anchor（claudecodeui 当前正是这种状态，若届时已重启则在临时 workspace 用旧版本 cache 启动一个 anchor 再升级），`quay driver status` 报 `behind` 并给出两个版本号；执行 `quay driver restart` 后再次 status 报 `current`。完成记录附前后两次输出原文。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/scripts/driver-anchor.ts
- packages/quay/src/cli/driver.ts
- plugin/test/driver-runtime-loaded-version-drift.test.mjs (new)
- tasks/gap-driver-status-loaded-vs-installed-version-drift.md
