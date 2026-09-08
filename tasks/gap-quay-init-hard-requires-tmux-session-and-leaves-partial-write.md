---
id: gap-quay-init-hard-requires-tmux-session-and-leaves-partial-write
title: quay-init 在无 tmux 环境硬失败 exit 2（tmux 模型已于 2026-09-03 退役），且失败点在闭集写到一半 ⇒
  目标项目被留在半初始化态
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
  deliveryCriticalSource: adhoc
---
## Proposal

**实测（2026-09-08，B=orangevps，第三方项目 /tmp/xproj-metacc = meta-cc 克隆，用【已安装 tgz 里 shipped 的】quay-init.sh）**：

```
$ bash $(npm root -g)/quay/plugin/scripts/quay-init.sh --root /tmp/xproj-metacc --auto-commit-skip
quay-init (plugin v0.6.1)
  detected test command: go test ./...        ← 自动探测正确
ERROR: quay-init needs the target project's tmux session but none could be detected.
exit=2
```

**失败后的写入状态（逐项核，不是抽查）**：
```
.quay/config.yml               PRESENT
tasks/                         PRESENT
.gitignore                     PRESENT
.quay/profiles.yml             MISSING
.claude/launch.settings.json   MISSING
.claude/settings.json          MISSING     ← 项目级 enabledPlugins 就在这里
```
⇒ **六项闭集写了 3 项就中止**，且失败信息只谈 tmux，不提「已写了一半」。
显式补 `--tmux-session <任意串>` 后 exit 0、六项齐全、`.claude/settings.json` 内容正确
（`enabledPlugins {"quay@quay": true}` + `permissions.allow ["mcp__plugin_quay_quay__*"]`）
⇒ **tmux session 对这六项的产出没有任何实质作用，它只是一个仍在闸上的过期前置**。

**为什么这是过期前置**：outer/inner 双 tmux 会话模型已于 2026-09-03 退役
（`orchestration/SPEC-tmux-retirement-2026-09-03.md`，README 亦写明「no "start outer" step」、
会话生命周期归人），而 quay-init 仍把「探测到目标项目的 tmux session」当作**硬前置**。
在任何非 tmux 的宿主（CI、容器、纯 ssh 批处理）上，跨项目初始化直接不可用。

**与硬规则的关系**：这是「一个前置的发生率从未被测量、却在挡住一个已交付的能力」的形态；
且失败非原子，把「没初始化」和「初始化了一半」做成了同形（硬规则 3b 的写入侧镜像）。

## Plan

1. **tmux session 降为可选**：无法探测时写入一个显式的 `tmux_session: null`（或省略该键）并
   继续完成闭集；仅当**确实要用到 tmux 的下游动作**被调用时才要求它。
2. 若判定它仍必须是前置（需要给出理由与发生率），则**必须前置到任何写入之前**校验
   ——「要求某前置就不能把它排在写入之后」（硬规则 7 同形）。
3. **写入原子化**：六项闭集要么全成要么不留痕（临时目录 + 最后一次性落位），
   或至少在失败信息里逐项列出「已写/未写」，让两种状态可区分。
4. 回归测试覆盖「无 tmux 宿主」这一环境（当前测试都在有 tmux 的开发机上跑，结构上碰不到该分支）。

## Acceptance Criteria

- [x] AC1 在 `tmux` 不可用（或无任何 session）的环境里跑 shipped 的 quay-init，exit 0 且六项闭集齐全
- [x] AC2 若仍保留该前置：不传 `--tmux-session` 时**一个文件都不写**（`git status --porcelain` 为空）
- [x] AC3 失败路径的输出逐项列出闭集六项的已写/未写状态（可机械解析）
- [x] AC4 新增测试在**模拟无 tmux** 的环境下跑（负控制：把该模拟去掉，测试应仍绿；把 tmux 前置改回硬失败，测试应变红）
- [x] AC5 `quay-init-closure-assertion.ts` 覆盖失败路径，而不只覆盖 happy path

## Definition of Done

AC1–AC5 全绿，并在**一台非本机主机的非本仓库项目**里真跑一次 AC1
（把主机名 + 项目路径 + 退出码写进 Evidence）。`scripts/test.sh` 全量绿。

## Evidence

外部主机 AC1 实测（DoD 要求）：主机 `orangevps`，非本仓库项目 `/tmp/xproj-gap-tmux`（`go.mod` 触发
`go test ./...` 探测）；tmux 有 `quay-0`/`test-sess` 但均不匹配项目名 ⇒ 走零匹配分支，不传
`--tmux-session` 跑修复后的 quay-init：**exit 0**、六项闭集齐全、`loop.tmux_session: null`。

AC2 说明：tmux 前置已按 Plan 1 降为可选 ⇒ 条件「若仍保留该前置」不成立（真空满足）；剩余的硬前置
（test-command / plugin-root / worktree-root）均在【写入之前】fail-closed —— 实测 pre-write 失败
（无 test command）时报告六项全 `unwritten`（硬规则 7 同形，AC3 覆盖）。

## Touches

- plugin/scripts/quay-init.sh
- plugin/scripts/quay-init-closure-assertion.ts
- docs/analysis/quay-init-closure-ratchet.baseline.json
- plugin/test/quay-init.test.mjs
- plugin/test/quay-init-tmux-detection.test.mjs
- plugin/test/quay-init-laydown-closure.test.mjs
- plugin/test/worktree-root-fs-check.test.mjs
- plugin/skills/init/SKILL.md
- tasks/gap-quay-init-hard-requires-tmux-session-and-leaves-partial-write.md