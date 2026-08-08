---
id: gap-quay-init-rewrites-an-executable-instead-of-generating-config
title: quay-init --loop rewrites session-liveness.sh's body, so the installed copy can
  never be diffed against the source — generate config, copy executables verbatim
status: done
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

- [x] AC1: `session-liveness.sh` 不再含 `__QUAY_TMUX_SESSION__`；`_sl_session` 改为 env/配置 + 默认值，
      优先级顺序写进文件头（头注释 + 第 75-92 行实现）
- [x] AC2: `quay-init --loop` 对该脚本改走 `cp`（`grep render_substitutions plugin/scripts/quay-init.sh`
      只剩 2 个调用点，都是 tick 文档；`render_substitutions "$sl_src"` 已不存在，脚本走 `copy_one "$sl_src" "$sl_dst"`）
- [x] AC3: **主判据**——铺设后 `cmp -s <源> <装出来的副本>` **退出码 0**（实跑输出见下）
- [x] AC4: **双向负控制**——人为改源脚本一个字节 ⇒ `cmp` 报不同并被检查报出；改回 ⇒ 恢复相同。两个方向都贴（见下）
- [x] AC5: 会话名仍然装得对——铺设到一个指定 `--tmux-session` 的项目后，
      **不改脚本**也能解析出正确的默认目标（实跑输出见下）
- [x] AC6: **机械检查防回归**：新增 `plugin/scripts/verify-installed-executables.sh`，断言每个安装的
      可执行文件与源逐字节相同；配置类文件显式列为例外并写明理由
- [x] AC7: AC6 那条检查**有执行者**——挂在 (a) `quay-init --loop` 末尾（每次安装都跑，fail-closed）
      与 (b) `test/cold-start-e2e.sh`（CI `cold-start-e2e` job，`--from-build` 路径）；被真实触发过
      一次（`--sabotage-byte` 翻转源脚本一个字节，检查报 FAIL 点名文件），输出见下
- [x] AC8: tick 文档的占位符替换**未被改动**（`render_substitutions` 对 tick 文档的 2 个调用点保留；
      负控制输出见下）
- [x] AC9: 测试用 `node:test` 且带 `// @test-group governance`（两个测试文件本就有；新增用例都在其内）

## Definition of Done

- [x] AC3 与 AC4 的实跑输出贴进任务体（见下「Execution evidence」）——`cmp` 的「不同」方向被真实触发过，
      不是只报「相同」
- [~] 完整套件连跑 2 次全绿——**如实标注：仅 1 次全量绿**（协调方 qinit fan-in 重跑，**2098 tests /
      2078 pass / 0 fail / 0 cancelled**，`/tmp/qinit-fanin-fullsuite2.log`，2026-08-03；含本任务合并代码）。
      非连跑 2 次。早前 suite #1 红在 3× M52 acceptance 60s 超时 + heavy-op-token AC2（均负载 flake、
      隔离通过）+ loop-shipping AC1b（qinit 引入的 verify-installed-executables.sh 旧 tick 文档路径，
      已修）。scoped 证据：`node --test` 两个测试文件 25 用例全绿、
      `bash scripts/test.sh plugin/test/{quay-init-loop,session-liveness}.test.mjs` 全绿（含静态检查）、
      `bash test/cold-start-e2e.sh` 全绿、`bash test/cold-start-e2e.sh --from-build` 全绿、
      `bash test/cold-start-e2e.sh --sabotage-byte scripts/session-liveness.sh` 全绿（AC4 双向在一条 e2e 里演示）。
      2 次全绿请协调方 fan-in 在 master 上补跑。
- [x] 任务体记录：`session-liveness.sh` 自 2026-08-03 起走本项目正常流程维护，不再由旁路会话直接改
      （见下「Provenance」）；「可执行文件原样复制、只生成配置」原则的出处也见下

## Execution evidence (2026-08-03)

全部在隔离 worktree `/tmp/quay-wt-qinit` 实跑。

**AC3 — 铺设后 `cmp -s` 退出码 0：**

```
$ CLAUDE_PLUGIN_ROOT=<worktree>/plugin bash <worktree>/plugin/scripts/quay-init.sh \
    --all --loop --root <tmp>/myproj --project myproj --test-command 'node --test' \
    --tmux-session 'myproj-0:0.0' --repo-root <tmp>/myproj
  ...
  copied: <tmp>/myproj/plugin/scripts/session-liveness.sh
  wrote: orchestration/session-liveness.env (SESSION_TMUX_SESSION=myproj-0:0.0)
verify-installed-executables: OK — every installed executable is byte-identical to its source (checked 19)
quay-init complete.

$ cmp -s plugin/scripts/session-liveness.sh <tmp>/myproj/plugin/scripts/session-liveness.sh; echo $?
0
```

**AC4 — 双向负控制（改一个字节 ⇒ 报不同并被抓；改回 ⇒ 相同）：**

```
=== flip a byte in the SOURCE (session-liveness.sh) after install ===
$ cmp plugin/scripts/session-liveness.sh <tmp>/myproj/plugin/scripts/session-liveness.sh
... differ: byte 1, line 1
DIFFER (GOOD)
$ bash plugin/scripts/verify-installed-executables.sh plugin <tmp>/myproj
FAIL: installed executable <tmp>/myproj/plugin/scripts/session-liveness.sh differs from its source plugin/scripts/session-liveness.sh — 可执行文件必须逐字节与源相同
verify-installed-executables: FAIL — an installed executable drifted from its plugin source (checked 19)
verify exit: 1

=== restore the byte ===
$ cmp -s plugin/scripts/session-liveness.sh <tmp>/myproj/plugin/scripts/session-liveness.sh; echo $?
0
IDENTICAL (GOOD)
$ bash plugin/scripts/verify-installed-executables.sh plugin <tmp>/myproj
verify-installed-executables: OK — every installed executable is byte-identical to its source (checked 19)
verify exit: 0
```

同一条 e2e 里两方向（`--sabotage-byte scripts/session-liveness.sh`）：
```
== AC6: installed executables byte-identical to source (verify-installed-executables.sh) ==
  [AC4 sabotage-byte] flipped a byte in scripts/session-liveness.sh (install source) — the AC6 check must now FAIL naming it
FAIL: installed executable .../session-liveness.sh differs from its source .../session-liveness.sh — 可执行文件必须逐字节与源相同
  AC6 correctly FAILED after the one-byte drift
  [AC4 sabotage-byte] restored the byte — the AC6 check must now PASS again
verify-installed-executables: OK — every installed executable is byte-identical to its source (checked 19)
  AC6: every installed executable is byte-identical to its source
```

**AC5 — 不改脚本，`--tmux-session ac5:0.0` 铺出的副本解析出正确默认目标（`ac5:outer`，探针 alive=1）：**

```
$ cat <tmp>/proj/orchestration/session-liveness.env | grep SESSION_TMUX
SESSION_TMUX_SESSION=ac5:0.0
$ TMUX_TMPDIR=<sock> SESSION_ROOT=<tmp>/proj bash <tmp>/proj/plugin/scripts/session-liveness.sh --once
session-liveness: starting pid=1780635 file=session-liveness.sh md5=5a060ac3280b94f7
SESSION-STATUS proj alive=1 pid=1780630
```

（session 值在生成配置里，脚本逐字节与源相同、未被改写；`DEFAULT_TARGET` 由
`SESSION_TMUX_SESSION` → `ac5:outer` 推出。`plugin/test/session-liveness.test.mjs` 的
AC3/AC7 用例「laid-down script identifies THIS project's own outer as alive」同路径复证。）

**AC7 — 执行者真实触发（`--from-build` 路径 + `--sabotage-byte` 路径都实跑）：**

```
$ bash test/cold-start-e2e.sh --from-build        # CI cold-start-e2e job 的命令
  ...
verify-installed-executables: OK — every installed executable is byte-identical to its source (checked 19)
  AC6: every installed executable is byte-identical to its source
COLD-START E2E PASS: ... wall-clock: 102s (from-build=true)
```
fail 方向由 `--sabotage-byte` 触发（见上 AC4），检查在两条路径都真实报出「不同」——不是只报「相同」。

**AC8 — tick 文档散文本地化未动（负控制）：**

```
$ grep -c render_substitutions plugin/scripts/quay-init.sh
2     # 351/363 两处，都是 tick 文档（orchestrator-loop-tick.md / fast-mode-loop-tick.md）
$ grep -rn 'scripts/test.sh\|quay-0:0.0' <tmp>/empty-project/orchestration <tmp>/empty-project/docs
# （无输出——铺出的 tick 文档里 grep 不到 quay 专属字面，quay-init-loop.test.mjs AC4 用例 + e2e 负控制复证）
```

## Provenance

- `session-liveness.sh` 自 2026-08-03 起走本项目正常流程维护（任务体 / `## Contract` / 派发评审 /
  fan-in / 契约棘轮），不再由旁路会话直接改——本任务即该移交的落地：脚本不再被 `quay-init` 改写，
  由本项目流程维护。
- 「可执行文件一律原样复制，只生成配置；散文可以本地化，代码不行」——出处：本任务 Proposal「一条更
  一般的原则」（管理者提议、外层实测适用面、派发评审确认），落地为 AC6 机械检查
  `plugin/scripts/verify-installed-executables.sh`。
- 触发条件（记录，不是工作）：`session-liveness.sh` 保持 bash，当它需要解析结构化配置或维护非平凡
  状态时再改 TypeScript。

## Touches

- plugin/scripts/session-liveness.sh
- plugin/scripts/quay-init.sh
- plugin/scripts/verify-installed-executables.sh  (新增——AC6 机械检查)
- plugin/test/session-liveness.test.mjs
- plugin/test/quay-init-loop.test.mjs
- test/cold-start-e2e.sh
- tasks/gap-quay-init-rewrites-an-executable-instead-of-generating-config.md  (AC 证据)

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

## 交叉标注（AC5，gap-quay-init-config-preserving-incremental-upgrade，2026-08-08）

同 config 覆盖形态：本条钉住「**可执行文件一律原样复制，只生成配置**」（session-liveness.sh 不再被改写，
安装副本与源逐字节相同，`verify-installed-executables.sh` 机械断言）。后继任务撞到**同形态的 config 侧**：
`ensure_loop_config` 曾 `data["loop"] = {...}` **整体替换** loop 节——已有消费者的自定义 loop 值
（board/gates/stop/policy/concurrency_bands/fork_baseline/merge_target）被静默丢掉（archguard 实跑
2026-08-06）。该任务补 config-preserving 合并（只更新四个 fast-mode 键、保留其余 loop 键）+ 升级前备份 +
失败回滚。同根：quay-init 升级不得覆盖消费者自有状态——可执行文件与 config 各守一侧，形态相同、对象互补。
