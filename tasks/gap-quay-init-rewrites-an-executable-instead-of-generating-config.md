---
id: gap-quay-init-rewrites-an-executable-instead-of-generating-config
title: quay-init --loop rewrites session-liveness.sh's body, so the installed copy can
  never be diffed against the source — generate config, copy executables verbatim
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者 2026-08-03 把 `plugin/scripts/session-liveness.sh` **移交给本项目的正常流程**
（任务体 / `## Contract` / 派发评审 / fan-in / 契约棘轮），理由是它的性质变了：
起初是管理者的私有仪器，现在它在 `plugin/scripts/` 里、由 `quay-init` 铺给每个采用者，
**已经是产品组件**；留在旁路会话里改，等于绕过本仓自己的闸——
而那正是本仓反复抓到的「存在但不生效」的温床。

移交同时带来一个**已确认的缺陷**。外层逐条复核了管理者给的证据，**全部属实**：

### 实测一：4 个调用点，2 个动的是可执行文件

```
plugin/scripts/quay-init.sh
  328, 340  render_substitutions  → 两份 tick 文档（散文，本地化合理，且有 .bak 兜底）
  361, 373  render_substitutions  → plugin/scripts/session-liveness.sh   ← 可执行文件
```

### 实测二：对脚本的改写只动一行功能代码

```
plugin/scripts/session-liveness.sh:79   _sl_session=__QUAY_TMUX_SESSION__
plugin/scripts/session-liveness.sh:25   （一行注释说明该占位符会被安装时替换）
```

**⇒ 安装出来的脚本与源不同，而差异只有这一行。**
后果不是「跑不起来」，是**升级时无法区分「生成的差异」与「用户改过的差异」**——
`quay-init` 的升级路径承诺「只补差量、不覆盖本地改动、冲突列出来」，
而一个天生就与源不同的文件，**让那条承诺在这个文件上失去意义**。

### 实测三：这个脚本本来就不需要那条改写路径

它已经全都自己推导了：

| 已有机制 | 位置 |
|---|---|
| `REPO_ROOT` 从脚本所在位置推导（`$_sl_script_dir/../..`），`SESSION_ROOT` 可覆盖 | 59-62 |
| 存在 `orchestration/session-liveness.env` 就 source（解析失败有 WARN 回落） | 65-71 |
| `DEFAULT_TARGET` 从会话名推导（`${_sl_session_base}:outer`） | 85 |
| 四个阈值全部 `${VAR:-default}` 参数化 | 全文 |

**唯独 `_sl_session` 这一个值走了改写路径。** 它与其余设计不一致，不是必需品。

### 一条更一般的原则（人的判断，管理者同意，外层实测支持）

> **可执行文件一律原样复制，只生成配置；散文可以本地化，代码不行。**

外层实测了它的适用面：`quay-init.sh` 里真正的复制动作是 `cp`（121 / 138-139 行，含 `.bak` 备份），
**目前只有 `session-liveness.sh` 这一个可执行文件走了改写路径**——
所以这条原则现在的成本是「修一处」，而它的价值是**防止下一处**。

## Contract

```
measure identical = `cmp -s plugin/scripts/session-liveness.sh <installed>/plugin/scripts/session-liveness.sh; echo $?` 的退出码字段
measure rendered_execs = `grep -c render_substitutions plugin/scripts/quay-init.sh` 输出中作用于可执行文件的调用点计数字段
band identical = 0
invariant 可执行文件逐字节复制；配置可以生成；散文（tick 文档）不受本条约束
invoke `bash test/cold-start-e2e.sh`
control 人为在源脚本里改一个字节 ⇒ `cmp` 必须报不同；铺设后不改 ⇒ 必须相同
resume 先去掉改写路径并让 `cmp` 通过，再补机械检查防回归
```

## Chosen mechanism

1. **把 `_sl_session` 改成读配置或 env 默认值**，与该脚本其余部分的做法一致：
   优先级建议 `SESSION_TMUX_SESSION`（env）→ `orchestration/session-liveness.env` → 从当前 tmux/主机名推导的默认值。
   **`quay-init --loop` 改为生成/更新那份配置**（配置属于「可以生成」的一类），
   **脚本本身走 `cp`**，与其它资产同一条路径。
2. **删掉 361/373 两个 `render_substitutions` 调用点**；328/340（tick 文档）**保留不动**。
3. **加一条机械检查防回归**：`quay-init` 安装完成后（或 e2e 里）断言
   **每个安装的可执行文件与其源逐字节相同**（`cmp -s`），
   配置文件显式列为例外并写明为什么。**这条必须有执行者**——
   本仓今天刚为「写下来但没人跑的检查」付过一次代价（`task-contract-check` 的名单反向长了 12 倍）。

**不做**：不改 tick 文档的占位符替换（**散文本地化是对的**，且 AC4 的负控制依赖它）；
**不把 `session-liveness.sh` 重写成 TypeScript**——见下方「不是缺陷的一条」；
不改 `orchestration/session-liveness.env` 的归属（它是每项目状态，不进 plugin 包）。

### 不是缺陷的一条：bash 还是 TS（人问、管理者答，记录为触发条件而非工作）

**现在不重写，但设触发条件。** 管理者的理由外层核过并同意：

- 「bash 无依赖」在这里**不成立**——循环机制已硬依赖 Node
- 但这个脚本**本质就是 shell out**（tmux / ps / /proc / git），且已有
  `plugin/test/session-liveness.test.mjs`（**35,208 字节**，`node:test`，**在 `scripts/test.sh --list-files` 的选择集中**）在驱动它
- **触发条件**：当它需要**解析结构化配置**或**维护非平凡状态**时，再改 TS

**把触发条件写下来，是为了让「什么时候该改」成为可判定的，而不是每次重新争论一遍。**

## Acceptance Criteria

- [ ] AC1: `session-liveness.sh` 不再含 `__QUAY_TMUX_SESSION__`；`_sl_session` 改为 env/配置 + 默认值，
      优先级顺序写进文件头
- [ ] AC2: `quay-init --loop` 对该脚本改走 `cp`（源码里 grep 不到作用于它的 `render_substitutions`）
- [ ] AC3: **主判据**——铺设后 `cmp -s <源> <装出来的副本>` **退出码 0**（实跑输出贴任务体）
- [ ] AC4: **双向负控制**——人为改源脚本一个字节 ⇒ `cmp` 报不同并被检查报出；改回 ⇒ 恢复相同。两个方向都贴
- [ ] AC5: 会话名仍然装得对——铺设到一个指定 `--tmux-session` 的项目后，
      **不改脚本**也能解析出正确的默认目标（实跑输出贴任务体）
- [ ] AC6: **机械检查防回归**：断言每个安装的可执行文件与源逐字节相同；
      配置类文件显式列为例外并写明理由
- [ ] AC7: AC6 那条检查**有执行者**（写明挂在哪、被真实触发过一次并贴输出）——
      只写「建议挂在 X」不算
- [ ] AC8: tick 文档的占位符替换**未被改动**（负控制：`quay-init --loop` 后铺出的 tick 文档里
      仍然 grep 不到 quay 专属字面）
- [ ] AC9: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC3 与 AC4 的实跑输出贴进任务体——**`cmp` 只报「相同」而从未报过「不同」，
      与没有这条检查不可区分**
- [ ] 完整套件连跑 2 次全绿（**若只跑到 1 次，如实标 `[~]` 并写明**——今天刚立的先例）
- [ ] 任务体记录：`session-liveness.sh` 自 2026-08-03 起走本项目正常流程维护，
      不再由旁路会话直接改；以及「可执行文件原样复制、只生成配置」这条原则的出处

## Touches

- plugin/scripts/session-liveness.sh
- plugin/scripts/quay-init.sh
- plugin/test/session-liveness.test.mjs
- plugin/test/quay-init-loop.test.mjs
- test/cold-start-e2e.sh

## Dispatch review

reviewer: outer
at: 2026-08-03T13:50:00Z
changed: 管理者移交该脚本并附一个已确认缺陷，**外层逐条复核了它给的三项证据，全部属实**：
`render_substitutions` 4 个调用点（328/340 是 tick 文档、361/373 是这个脚本）、
改写只动 `session-liveness.sh:79` 一行功能代码加第 25 行一句注释、
该脚本已自推导 `REPO_ROOT`/`DEFAULT_TARGET`、会 source `session-liveness.env`、四阈值全 env 参数化。
**外层补测了原则的适用面**：`quay-init.sh` 的真实复制动作是 `cp`（121/138-139，带 `.bak`），
**当前只有这一个可执行文件走改写路径** ⇒ 成本是「修一处」，价值是「防下一处」，
所以 AC6 要求把原则做成机械检查、AC7 要求它有执行者
（今天 `task-contract-check` 无执行者那次的代价就摆在那）。
**判据用管理者提的 `cmp -s`**，并加 AC4 的双向负控制——
一个只会报「相同」的 `cmp` 与没有它不可区分。
**范围上明确保留两样**：tick 文档的散文本地化不动（AC8 用负控制钉住），
`session-liveness.env` 的归属不动（每项目状态，不进包）。
**并把「bash 还是 TS」记为触发条件而非工作**：现在不重写，
当它需要解析结构化配置或维护非平凡状态时再改——**写下来是为了让它可判定，不必每次重新争论**。
**派发时机**：在飞 2（cold-start-e2e / r1），**与 cold-start-e2e 在 `test/cold-start-e2e.sh` 上重叠**，
必须等它收尾后再派。
