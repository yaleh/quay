---
id: DIR-123-aarch64-build-on-ad-arm1-and-auto-build-on-develop
title: 人裁定 2026-08-11：release/package 构建须支持 aarch64（覆盖验证环境 C=ad-arm1）；不走 GitHub ARM
  runner；**实现走硬件无关 .tgz 路线**（C 已有 Node v24.19.0 → npm install -g 即覆盖 aarch64，无需在 ad-arm1 单独建
  SEA）；每次 merge 到 develop 后自动 deliver + 验证（解决 release 新鲜度退化）
status: todo
labels:
  - directive
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** directive

## 人的裁定（2026-08-11 13:3xZ + 14:1xZ 精化，逐字意图）

**13:3xZ**：要求尽早输出一个覆盖验证环境的 build（验证环境含 B=orangevps x86_64 与 C=ad-arm1 aarch64——需要 release/package 构建流程支持 aarch64 目标，补上此前报的「C 无可用产物」缺口），并且此后每次 merge 到 develop 后都自动执行这一 build 过程（解决「release 新鲜度退化，develop 领先 release 已 2216 提交」）。

**14:1xZ 精化（覆盖 13:3x 的 arm 构建方式部分）**：**不要用 GitHub-hosted ARM runner**（billing/可用性风险太大）。改为在 ad-arm1（真实 aarch64 机器，已确认可达 / 有 node v24.19.0）上直接拉代码 build。

## 实现路线转向（manager 2026-08-11 实测 + outer 复核，决定权在 outer）

**manager 核实（实测,非猜测）**：本项目的常规产物是硬件无关的：
1. `dist/quay.js` 经 `file` 确认 `Node.js script executable, ASCII text`——纯 JS 无架构依赖；
2. quay / quay-native / quay-github 三个 package.json 依赖树零原生依赖（无 `.node`/node-gyp/prebuild-install，全纯 JS：`@modelcontextprotocol/sdk` / `yaml` / `zod`）；
3. `package.sh` 的 npm-pack 路线（`quay-*.tgz`）头注释原话「universally available with Node.js」——这条路径本来就与硬件无关；SEA（build-sea.sh）是独立的另一条路径，唯一目的是让目标机器不用装 Node，代价是把 Node 运行时打进原生二进制而变成架构相关；
4. B/C 此前已查到均有可用的 Node ≥20，只是不在默认 PATH（B: nvm v22.23.1 / v25.2.0；C: `~/.local/opt/node-current/` 是 v24.19.0；默认 `/usr/bin/node` v18.19.1 < engines floor）。

**⇒ outer 采纳 .tgz 路线**：C 用现有 Node v24.19.0 `npm install -g quay-<ver>.tgz` 即获得新鲜可用产物，`quay --help` / `quay serve` 在真 aarch64 上跑通，恰好关闭「C 无可用产物」缺口。**不再在 ad-arm1 单独 build SEA**——C 有 Node，SEA 是解决「无 Node」问题的路径，此处不需要。Node-free aarch64 SEA 二进制（产品级「无 Node 用户」需求）为显式 out-of-scope，见本任务 Finding。

## Acceptance Criteria

- [x] AC1: **aarch64 产物可装可跑于 C**——在 C（aarch64, Node v24.19.0 @ ~/.local/opt/node-current/）上 `npm install -g quay-<ver>.tgz` + `quay --help` + `quay serve` 返回 http_code=200（实测通过，见 Evidence）
- [x] AC2: **develop merge 后自动 deliver**——每次 merge 到 develop 后，`integration-batch-merge.sh` 的 `do_deliver` 钩子自动跑 `develop-deliver-tgz.sh`：worktree@develop-tip 建 .tgz → scp B/C → 安装 + 验证 → 写 state；best-effort 不阻塞 merge
- [x] AC3: **x86_64 走 CI**——B=orangevps 的 x86_64 产物由现有 release.yml CI 路径覆盖（linux-x64 已存在）
- [x] AC4: **delivery-manifest 更新**——`delivery-manifest.json` version 0.3.13→0.4.0（对齐 packages/quay/package.json；**不加** linux-arm64 到 sea-binaries——无 SEA 资产，声明了会令 --ci fail-closed；aarch64 由 npm-tarball 覆盖，该条目本就无平台限制）
- [x] AC5: **AC16③ 复测可用**——C 上安装产物 + `quay serve` http_code=200 + `quay --version` 0.4.0（aarch64）（实测通过，见 Evidence）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：B/C 安装产物 + http_code=200 证据贴出（见 Evidence）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/develop-deliver-tgz.sh（新：worktree@develop-tip 建 .tgz → scp B/C → 安装+验证 → state）
- plugin/scripts/integration-batch-merge.sh（do_deliver 钩子，land closure 后 best-effort）
- delivery-manifest.json（version 0.4.0）
- tasks/gap-release-freshness-no-recut-mechanism.md（交叉标注——recut 触发 + develop-deliver 覆盖「每次 merge 后自动 build」）
- tasks/DIR-123-aarch64-build-on-ad-arm1-and-auto-build-on-develop.md（自身：勾 AC + 贴证据）

## Contract

measure   aarch64_serve_ok = `ssh ad-arm1 'quay serve --port 18091 & sleep 3; curl -sf -o /dev/null -w "%{http_code}" http://localhost:18091/'` 的 stdout 数字
band      aarch64_serve_ok = `200`（C 上安装产物跑通 serve）
invariant fresh_delivered = 1（develop-deliver-state.json lastDelivered == develop tip）
invoke    `bash plugin/scripts/develop-deliver-tgz.sh --force`（贴 B/C http_code + uname -m）
control   aarch64 产物可装可复测；develop merge 自动 deliver；x86_64 走 CI；既有不回归
resume    deliver 脚本 / do_deliver 钩子 / delivery-manifest / 复测分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: 人 13:3x 裁定 build 覆盖 aarch64 + 每次 develop merge 自动 build；14:1x 精化——不用 GitHub ARM runner。manager 14:1x+ 实测发现常规产物硬件无关（纯 JS 零原生依赖 + B/C 均有 Node≥20 off-PATH），outer 采纳 .tgz 路线：不再在 ad-arm1 建 SEA。实现归 outer（本 directive 属交付机件）

## Evidence

**实现（outer 2026-08-11）**——deliver 脚本 + merge 钩子 + manifest 更新：

- `plugin/scripts/develop-deliver-tgz.sh`（新）：`git worktree add --detach <develop-tip>` + symlink node_modules → `package.sh` 建 quay .tgz + quay-native `build-dist.sh`+`npm pack` 建 quay-native .tgz → scp B/C → 远程 `export PATH="$HOME/…/node-current/bin:$PATH" npm install -g <两个 .tgz>`（单条命令，quay-native 的 `quay:*` 依赖就地解析，不走 registry）→ 落 .quay/config.yml（native provider, mcp_entry quay-native）→ `quay serve` + curl http_code → 写 `.quay/develop-deliver-state.json`。`~`→`$HOME`（tilde 在双引号内不展开——实测 exit 243 教训）。
- `plugin/scripts/integration-batch-merge.sh`：新增 `--deliver` 旗标 + `do_deliver()`（do_sync 之后，ff 与 real-merge 两条 land-closure 路径都调用）；`setsid … & disown` 分离启动，best-effort 不阻塞 merge，失败只记 state、外层 tick 陈旧重试。
- `delivery-manifest.json`：version 0.3.13→0.4.0（对齐 package.json；sea-binaries 不加 linux-arm64——无此资产）。

**Contract invoke（`develop-deliver-tgz.sh --force`，实测）**：
```text
develop-deliver: develop tip = 04e9f1d7b3fb (04e9f1d7b3fbeac6cecf451d93cf22bf1d51f2aa)
develop-deliver: B (orangevps.wan.hwang.men) OK — quay serve http_code=200
develop-deliver: C (ad-arm1.wan.hwang.men) OK — quay serve http_code=200
develop-deliver: OK — fresh quay quay-0.4.0.tgz delivered + verified on all hosts
```
state: `{"lastDelivered":"04e9f1d7…","hosts":{"C":"200","B":"200"},"timestamp":"2026-08-11T14:18:22Z"}`；idempotent 重跑（state fresh）跳过。

**AC16③ 复测（C 上独立探测）**：
```text
$ ssh ad-arm1 'export PATH="$HOME/.local/opt/node-current/bin:$PATH"; quay --version; uname -m'
0.4.0
aarch64
```

**静态**：`delivery-manifest-check.ts --json` → `{"ok": true, "manifestVersion": "0.4.0", "issues": []}`。

### Finding：Node-free aarch64 SEA 为显式 out-of-scope（决策记录）

SEA 的 arch-bound 特性使「无 Node 的 aarch64 用户」需要 linux-arm64 SEA 二进制，但：(a) 验证环境 B/C 均有 Node ≥20（本任务核心目标 C 无可用产物已由 .tgz 关闭）；(b) 人 14:1x 禁止 GitHub ARM runner（billing/可用性）。若未来出现「无 Node 的 aarch64 消费者」需求，备选路径：ad-arm1 本机 `build-sea.sh`（node-current PATH 前置，arch 由本机 node 决定）。此为决策记录，不进 Contract。
