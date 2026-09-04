---
id: gap-skill-start-drivers-webserver
title: 新增"启动 drivers + web server"skill——会话内一次调用封装 quay driver start / quay serve
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

人 2026-09-04 描述的 quay 实际启用流程（`orchestration/SPEC-tmux-retirement-2026-09-03.md`
§1.4/Layer 3b）：① user scope 安装 quay ② 手动启动 Claude Code 会话 ③ 会话内调用 skill 初始化
quay ④ 会话内调用 skill 启动 drivers + web server ⑤ 会话内调用 skill 启动 manager（④⑤可合一）。

第③步已有正例——`plugin/skills/init/SKILL.md`（`quay-init.sh` 委托，会话内调用，幂等），
本任务不改动它,只作为设计参照。第④步是**纯粹的缺口**：`find plugin/skills -iname "*driver*"`
只命中 `loop-driver`（inner tick 循环逻辑文档，不是"启动 driver 进程"的机制），没有任何
skill 会调 `quay driver start --kind promotion` / `quay driver start --kind worker` /
`quay serve`——目前唯一入口是人手动敲 CLI 命令。

这是本 SPEC Layer 3b 判断的三个 skill 缺口（③已有/④本任务/⑤见另一任务）里**工作量最小的
一个**：不涉及"变身"这类身份切换语义（不像 manager 那样需要会话开始按一套行为规范持续行事），
只是把几条已经不依赖 tmux 的 CLI 命令（`packages/quay/src/cli/driver.ts` 的 `VERBS =
["start","stop","drain","resume","status","restart"]`、`packages/quay/bin/quay.ts` 的
`serve` 分发）包装成一次会话内调用，且要幂等（重复调用不应重复启动/报错，参照 `init` skill
的幂等设计）。

**新 skill 落点**：`plugin/skills/drivers/SKILL.md`（新目录，与 `init`/`manager`/`execute`
同级命名风格；确认此前无 `plugin/skills/drivers/` 目录，不与已有的 `loop-driver` 混淆——
后者是 inner tick 循环的行为文档，不是启动进程的机制）。

**需要覆盖的具体命令（2026-09-04 实测 `quay driver --help`）**：
```
quay driver start --kind promotion [--root <path>]
quay driver start --kind worker    [--root <path>]
quay serve --host <ip> --port <p>                    # web UI
```
`quay driver start` 明确文档"Refuses (exit non-zero) if the driver is halted — clear the
halt with resume first"、"Starting from a git worktree is REJECTED — 必须从 main checkout
（workspace root）执行"——skill 需要处理/传达这两种已知的失败路径,不能只包装 happy path。

**不在本任务范围内**：⑤"变身为 manager"skill（另一任务，Layer 3b 判断依赖本任务已验证的
封装模式，建议本任务先落地）；`cold-start`/`session-topology` 两份 skill 文档仍描述过时的
两窗口拓扑（§4 非目标，单独立案）。

## AC

- [x] `plugin/skills/drivers/SKILL.md` 存在——该 skill 在会话内调用后，
      `quay driver status --kind promotion` 与 `quay driver status --kind worker` 均报告
      `alive: true`（或已有等价日志证明其已启动）
- [x] `quay serve` 已被同一 skill（或该 skill 明确文档化的配套调用）覆盖，调用后可通过
      `curl -sf http://<host>:<port>/` 或等价探针确认 web server 已监听
- [x] 幂等性验证：对同一 workspace 连续调用两次该 skill，第二次调用不产生"重复启动"错误，
      不产生第二组重复的 driver/serve 进程（对照 `init` skill 的幂等设计手法）
- [x] 已知失败路径被正确处理/传达：driver halted 时的报错信息引导用户先 `quay driver resume`；
      从非 worktree-root（如任务 worktree）调用 `quay driver start` 时的拒绝行为被正确透传，
      不被 skill 吞掉或误报成别的错误
- [x] 若实现新增了 `plugin/scripts/*.ts` 脚本文件（而非纯 SKILL.md 内直接调用既有 CLI），
      已完成三面注册（outline + capability-catalog + laydown，
      `plugin/scripts/capability-catalog.sh` 头注释）——若无新脚本，在完成时注明
      "无新脚本，不适用"，不能留空
- [x] `node scripts/test.sh`（或等价 scoped 调用）全绿，新增至少一个测试文件覆盖该 skill
      的封装脚本/逻辑（若 SKILL.md 是纯文档型 skill 无可测代码,以 skill 自身的
      dry-run/结构检查作为等价覆盖并说明）

## DoD

人在一个刚初始化过 quay（已跑过 `init` skill）的项目里，只需在会话内调用
`plugin/skills/drivers/SKILL.md` 这一个 skill，drivers（promotion + worker）与 web server
就都进入可用状态——不需要人另外手动敲三条独立的 `quay driver`/`quay serve` CLI 命令，也不
需要任何 tmux 操作。skill 本身对已经在跑的 driver/server 是安全的（幂等），对已知失败路径
（halted / worktree-root 限制）给出可操作的错误信息而不是静默失败或吞异常。

## Touches

- plugin/skills/drivers/SKILL.md
- plugin/scripts/start-drivers.ts
- plugin/scripts/capability-catalog.sh
- plugin/test/start-drivers.test.mjs
- tasks/gap-skill-start-drivers-webserver.md