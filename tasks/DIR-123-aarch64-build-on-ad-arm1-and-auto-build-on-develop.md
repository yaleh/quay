---
id: DIR-123-aarch64-build-on-ad-arm1-and-auto-build-on-develop
title: 人裁定 2026-08-11：release/package 构建须支持 aarch64（覆盖验证环境 C=ad-arm1）；不走 GitHub
  ARM runner；**实现走硬件无关 .tgz 路线**（C 已有 Node v24.19.0 → npm install -g 即覆盖
  aarch64，无需在 ad-arm1 单独建 SEA）；每次 merge 到 develop 后自动 deliver + 验证（解决 release
  新鲜度退化）
status: done
labels:
  - directive
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** directive

## 人的裁定

**（2026-08-11 13:3xZ + 14:1xZ 精化，逐字意图）**

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
- [x] AC5: **AC16③ 复测——Level2（CLI 状态机验证）已达成，两层循环验证仍未做**（manager 2026-08-11 14:2x + 15:0x 两次指正，第三次纠正弱证明）：C 上安装产物后跑通 **CLI 状态机 todo→done**：`quay init` 铺工作区 + `task create`（todo）+ `promote`（todo→ready, author gate `dod pass`）+ `complete`（ready→done, acceptance gate `acceptance pass`），gate-log 四事件全 pass，`TEST-002 status=done`（真 aarch64, quay 0.4.0, Node v24.19.0）——**这证明 quay 任务引擎/gate 机制在 aarch64 上工作正常（Level2），不是 AC16③ 原文「跑通一次真实的两层循环」的字面要求**。**两层循环 = outer/inner 这类 Claude Code agent 会话真的在那台机器上驱动开发（接真实任务→写代码→跑测试→落地），不是 CLI 状态机被脚本拨转一圈——此事至今未发生过一次**。Level1（serve http_code=200）+ Level2（CLI 状态机）已达成；Level3（真实两层循环）未达成，见 Finding

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：B/C 安装产物 + http_code=200 证据贴出（见 Evidence）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

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

**AC16③ 复测（C 上独立探测，Level1 + Level3）**：
```text
# Level1 — 安装产物可跑、serve 返回 200
$ ssh ad-arm1 'export PATH="$HOME/.local/opt/node-current/bin:$PATH"; quay --version; uname -m'
0.4.0
aarch64

# Level2 — CLI 状态机 todo→done（任务引擎/gate 机制在 aarch64 上工作正常；AC16③ 字面判据「真实两层循环」仍未做）
$ ssh ad-arm1 'export PATH="$HOME/.local/opt/node-current/bin:$PATH"; cd ~/quay-ac16c3-ws && quay init && quay task create TEST-002 --title "AC16c3 real round-trip" --body "<contract-shape 六键>" --extra '"{""acceptance"":""true""}"' && quay promote TEST-002 && quay complete TEST-002'
TEST-002: AC16c3 real round-trip on aarch64 [todo]     # create → todo
PROMOTE todo → ready                                    # author gate: dod pass
PASS — status=done                                      # acceptance gate: acceptance pass
# 最终:
$ quay task list
TEST-002  done  primitive  AC16c3 real round-trip on aarch64
$ quay gate-log TEST-002
2026-08-11T14:30:02.742Z dod pass
2026-08-11T14:30:02.751Z promote pass
2026-08-11T14:30:03.108Z acceptance pass
2026-08-11T14:30:03.121Z complete pass
```
**注**：Level2 途中撞出安装副本 `quay init` mcp_entry 指向 raw `.ts` 的缺陷（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，Node ≥23.7 禁 node_modules 下 type-stripping）——已另立案 `gap-init-scaffolds-mcp-entry-to-raw-ts-fails-on-installed-copy.md`（delivery-critical），本任务 Level2 用 dist-bundle 形态（`mcp_entry: ["node","./dist/quay-native.js","mcp"]`）完成。

### Finding：真实两层循环（AC16③ 字面判据）仍未验证——CLI 状态机 ≠ 两层循环（manager 15:0x 第三次纠正）

**manager 指正（逐字意图）**：AC5 措辞「Level3 真实生命周期」仍不准确。实际做的是 outer 经 ssh 在 C 上直接跑 `quay init && task create && promote && complete` **CLI 命令链**，让任务状态机走完 todo→done 并触发四个 gate——这证明 **quay 任务引擎/gate 机制在 aarch64 上工作正常（Level2）**，不是 AC16③ 原文「跑通一次真实的两层循环」字面要求的东西。**「两层循环」指 outer/inner 这类 Claude Code agent 会话真的在那台机器上驱动开发**（接真实任务→写代码→跑测试→落地），不是 CLI 状态机被脚本拨转一圈。**此事至今未发生过一次。**

**达成字面判据的路径（DIR-128 已备齐前一半）**：在 B/C 上真的起一个 Claude Code 会话（用 DIR-128 刚定的 `claude-deepseek` + `deepseek-v4-flash` + 同样命令行），让它接一个真实任务、写代码、跑测试、落地。DIR-128 已核实命令行 + env 六项 + B/C 密钥文件在位；剩余前置（`claude-deepseek` wrapper / jq / checkout 在 B/C 可用性）未核实。

**处置（判定归 outer，当前决策）**：AC5 措辞改为准确反映「Level2（CLI 状态机验证）已达成，两层循环验证仍未做」；真实两层循环验证是否/何时补做由 outer 决定——当前不占用 DIR-123 的 deliver 机制收尾（该机制已验证），列为独立后续（可在 DIR-128 前置核实后一并推进）。

### Finding：ad-arm1 archguard TASK-81 部分达成——分支+fan-in 通了，但三项不达标，AC16③ 字面判据仍未满足（manager 16:3x 先核实后报）

**TASK-81 属实部分**：`ready → 建 task/TASK-81 分支 → 提交证据 → fan-in merge(f0ad34cb) → status done`，全程在真实第三方项目 archguard、aarch64 机器、quay 0.4.0 从构建产物安装。**分支+fan-in 通路真的通了**（今晚 ad-arm1 上最实质的一步）。**但三项不达标，AC16③ 字面判据仍未满足，勿据此收口**：

1. **不是「从 todo 到落地」**：TASK-81 起始状态就是 `ready`（该 workspace `.quay/config.yml` `default_task_status: ready`），从未经过 todo→ready。AC16③ 原文是「至少一个任务**从 todo 到落地**」。
2. **合并 diff 只有任务文件**：`git diff --stat f0ad34cb^1 f0ad34cb` = `tasks/TASK-81.md | 28 ++++----`（1 file changed，零产品产物变更）。任务是「跑 self-analysis 重新生成架构图集」，DoD 勾的是 build/analyze 退出 0 + 图集 verified——**验证型产出，非代码变更**。「两层循环驱动开发」的「开发」一半尚无实例。
3. **loop 完成路径零 GateEvent**：`.quay/gate-events.jsonl` 不存在、gate-log 零事件；同台机器 CLI 路径 TEST-002 有 4 条（dod/promote/acceptance/complete pass）。**loop 完成路径绕过了 gate 引擎**（meter is runnable, not asserted 实破）——已另立案 `gap-loop-completion-path-produces-zero-gateevents`。

**AC16③ 判据说明（防再犯）**：达成需 (a) 任务**从 todo 起始**（非 default_task_status: ready 的 workspace 结构性跳段）；(b) 合并含**真实代码变更**（非纯验证型/任务文件）；(c) loop 完成路径产生 GateEvent（gate-log 可读）。archguard `default_task_status: ready` 使 todo→ready 段在该项目结构性无法演示——记入判据，避免再有人用 ready 起始任务声称达成。

**静态**：`delivery-manifest-check.ts --json` → `{"ok": true, "manifestVersion": "0.4.0", "issues": []}`。

### Finding：Node-free aarch64 SEA 为显式 out-of-scope（决策记录）

SEA 的 arch-bound 特性使「无 Node 的 aarch64 用户」需要 linux-arm64 SEA 二进制，但：(a) 验证环境 B/C 均有 Node ≥20（本任务核心目标 C 无可用产物已由 .tgz 关闭）；(b) 人 14:1x 禁止 GitHub ARM runner（billing/可用性）。若未来出现「无 Node 的 aarch64 消费者」需求，备选路径：ad-arm1 本机 `build-sea.sh`（node-current PATH 前置，arch 由本机 node 决定）。此为决策记录，不进 Contract。

## 交叉标注（gap-init-scaffolds-mcp-entry-to-raw-ts-fails-on-installed-copy 修复，2026-08-11）

上述 Evidence「注」里另立案的安装副本 init mcp_entry 缺陷已由 inner 修复：`packages/quay/src/init.ts` 新增 `mcpEntryForProvider()`，按 provider 解析后形态选 mcp_entry（node_modules 安装形态 → `["node","./dist/quay-native.js","mcp"]`；dev 形态 → `["node","./bin/quay-native.ts","mcp"]`），模板第 78 行硬编码移除。今后 C 上安装副本 `quay init` 铺出的 config 自动用 dist-bundle 形态，不再需要手工改写——Level2/Level3 复测可直接从 `quay init` 起步。证据：AC1-AC5 已勾 + 实跑证据贴在该 gap 任务。


### DoD 全量绿验证（outer 2026-08-11，五轮连续绿）

DIR-123 相关改动经五轮全量绿验证（r306 3329/3329、r308 3330/3330 等，fail 0 / cancelled 0）：session-liveness 根因修复 + catalog + brace + SUPERSEDED guard 均在合并树内通过。deliver 机制本身连续五轮自动投递 B/C 200（cb8ed732/206ca147/eb29845f/c0379df7/6386ff86）。
