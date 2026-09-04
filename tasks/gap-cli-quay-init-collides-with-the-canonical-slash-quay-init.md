---
id: gap-cli-quay-init-collides-with-the-canonical-slash-quay-init
title: "CLI subcommand `quay init` (DIR-098, 07-23, workspace scaffolding — a
  legitimately different operation: create a brand-new empty quay task store)
  collides in name with the skill `/quay:init --all --loop` that is the
  CANONICAL path for onboarding an existing project onto quay-driven development
  (human ruling 2026-08-07); `quay init --loop` silently swallows the
  unrecognized --loop flag and exits 0 reporting success, laying down nothing
  but .quay/config.yml + tasks/ — reproduced live on B
  (orangevps.wan.hwang.men/~/work/meta-cc): plugin/scripts=0, orchestration/=0
  after a reported-successful run; `quay --help` advertises `quay init` as a
  first-class top-level command (line 347), so a real third-party user trying to
  start quay-driven development is more likely to find and run the wrong one
  first"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**用户想「开始用 quay 驱动这个项目的开发」时，命令行上第一个撞见的是错的那个入口,
而它不报错、只静默做另一件事,报成功。**

## 人的裁定（2026-08-07，本任务的唯一判据来源）

> 「用户初始化一个使用 quay 开发的项目应该是在 Claude Code 会话中输入 `/quay:init`。」

⇒ **skill 是这个用例唯一的规范路径。** CLI 的 `quay init` 不是它的替代品——即使它背后
确实服务另一个合法目的（见下），**它的存在与可发现性本身就是风险**。

## 实测（B 机 orangevps.wan.hwang.men，2026-08-07，真实第三方项目 meta-cc）

| 步骤 | 结果 |
|---|---|
| `cd ~/work/meta-cc && quay init --loop` | **exit 0**，输出「Workspace ready at: /home/yale」 |
| 事后核对 `plugin/scripts` | **0 个文件** |
| 事后核对 `orchestration/*.md` | **0 个文件** |
| `quay init --loop --dry-run` 单独复测 | 确认 `--loop` **被静默忽略**，无警告无报错 |

## 根因（读码，非猜测）

**两个真实不同的操作，共用了 `init` 这个词：**

1. **CLI `quay init`**（`packages/quay/bin/quay.ts:508`，`DIR-098`，2026-07-23）——
   **从零创建一个全新的、空的 quay 任务仓库**（`.quay/config.yml` + `tasks/`）。
   选项只有 `--force`/`--dry-run`/`--root`，**没有 `--loop`**，多余 flag 被 argv 解析静默吞掉。
2. **skill `/quay:init --all --loop`**（`plugin/skills/init/SKILL.md`，内部名 `quay-init`）——
   **把完整 loop 开发机制铺进一个已有项目**。接线正确：其注释自陈
   「the skill now delegates here」，转调 `plugin/scripts/quay-init.sh`。

**`quay-native` 与 MCP 均无叠加的 init 入口**（各 0 命中）——不是「到处混乱」，
是**一处精确的撞名**，且被 `quay --help` 顶层展示放大了发现概率
（347 行：`quay init [--force] [--dry-run] [--root <path>]`，与其余命令并列，无任何区分提示）。

## 修复方向（接法留执行时，不预设）

1. CLI `quay init` 检测到 `--loop` ⇒ **报错并指向 `/quay:init`**，不静默忽略；或
2. CLI `quay init` 从 `--help` 顶层移除/降级展示，只留 `--root`/`--force` 场景的文档入口；或
3. 两者合并：CLI 检测到目标目录已是「非空第三方项目」（有 `.git` 但无 `.quay/`）时，
   主动提示「你可能想要的是 Claude Code 会话里的 `/quay:init --all --loop`」。

**不预设选哪条**——人已裁定 skill 是唯一规范路径，执行时按这条判据选修法。

## Contract

```
measure loop_flag_rejected = `cd <tmp-empty-dir> && quay init --loop --dry-run 2>&1; echo EXIT=$?` 输出的 EXIT 字段
band loop_flag_rejected != 0（当前基线 0——静默接受，不合格）
invariant `quay --help` 顶层列出的 `init` 用法必须与其实际行为一致，不得暗示它能做 skill 才能做的事
invoke `cd <tmp> && quay init --loop --dry-run; echo $?`
control 传一个真正合法的 flag（如 `--force`）⇒ 行为不变，证明修复没有破坏原有合法用途
resume 若中断，先跑 measure 复核 --loop 当前是否仍被静默接受
```

## Acceptance Criteria

- [x] AC1: `quay init --loop` 不再静默成功——报错并指出正确路径，或产出与「已铺设」相符的实际结果 — [exec 2026-08-07] measure `cd <tmp-empty-dir> && quay init --loop --dry-run 2>&1; echo EXIT=$?` → **EXIT=1**（基线 0——已翻转）；stderr 报「unrecognized option --loop」并指向 `/quay:init --all --loop`；等价真实第三方项目复测（`.git` 在、`.quay/` 无）exit 1 且 plugin/scripts、orchestration、.quay 均不产生；tests `AC1-collision` ×2 pass
- [x] AC2: `quay --help` 顶层的 `init` 说明不再可能被误读为「能铺 loop 机制」 — [exec 2026-08-07] 顶层 Usage 行已改为 `quay init [--force] [--dry-run] [--root <path>]   (scaffold an EMPTY task store; the loop install is the /quay:init skill, NOT this command)`；`quay init --help` 同样加注；tests `AC2-collision` ×2 pass
- [x] AC3: **负控制**——`quay init --force`（合法既有用法）行为不受本次修复影响 — [exec 2026-08-07] `quay init`/`quay init --force`/`quay init --dry-run` 均 exit 0 且照常创建 config+tasks；test `AC3-collision negative control` pass；DIR-098 原有 AC3/AC3b（拒绝覆盖 + --force 覆盖）原测试仍绿
- [x] AC4: 与 DIR-098 交叉标注——CLI `init`「创建全新空仓库」这个合法用途本身不被取消，只堵住误用入口 — [exec 2026-08-07] quay.ts guard 注释标注 DIR-098 + 本 gap 任务；README「Creating a workspace」新增 `quay init` vs `/quay:init` 区分块；DIR-098 全部原 AC 测试（AC1-AC8/AC10-AC10e）仍绿；只拦 `--loop`，`--force/--dry-run/--root` 照常

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体（含在 B 机或等价真实第三方项目上的复测） — 见下「实跑证据」
- [ ] 完整套件绿 — **无法诚实勾选**。全量 `bash scripts/test.sh` 在 worktree 里 **exit 137（OOM kill，252 文件 + 默认并发超环境内存）**，且日志含 **49 个与 init 无关的既有失败**：门接线测试（dir022-remaining-gates / dir032-audit-independence 等）报 `gate(...) is not a function`——本 worktree 的 `listGates()` 只有 `[dod, acceptance, doc-quay-directive-skill]`，测试引用的 `vmeta-lag/dogfood-evidence/delivery-standalone-smoke/audit-independence/adr-001` 未在当前 config 接线。**基线本已红**：develop git log 明确「suite final red (95 fail)」（2cb14bb9）。本次改动**直接测试面全绿**（init.test.mjs 23/23、cli.test.mjs PASS、scoped 静态检查 task-contract-check no violations、全量静态检查 checker-mutation/test-framework-policy/test-isolation 全 PASS），**未引入任何新失败**；完整套件绿需由外层先清基线红（门接线）再验证。

## Touches
- packages/quay/bin/quay.ts
- README.md（若需补文档区分）
- tasks/gap-cli-quay-init-collides-with-the-canonical-slash-quay-init.md

## Dispatch review

reviewer: none
at: 2026-08-07T06:0xZ
changed: 人 2026-08-07 裁定「/quay:init 是唯一规范路径」后，管理者在 B 机真实执行中复现该缺陷并立案


## 并入：`quay-init.sh` 的暴露面（2026-08-07 06:1xZ，管理者按「合并而非拆分」并入本条）

人问「`plugin/scripts/quay-init.sh` 应当被进一步集成吗？」——**管理者判断：不该并进那 6 个入口，
但该从暴露面撤下来。** 理由是它的性质与那 40 个仪器不同：**6 个入口收编的是开发循环自己用的工具，
而 `quay-init.sh` 是用户第一次接触 quay 时运行的安装器，消费者是人不是循环**；
把安装器归到 `quay-session` 之类下面，语义上是错的。

**真正的问题不是「要不要集成」，是 init 有三个入口而只有一个是官方的**：

| 路径 | 状态 |
|---|---|
| `/quay:init --all --loop`（skill） | ✅ **人裁定的唯一规范路径**，接线正确 |
| `plugin/scripts/quay-init.sh` | ⚠️ 技术上可直接按路径调，但 **README 一字未提** |
| `quay init`（CLI） | ❌ 撞名、静默吞 `--loop`、报假成功（=本任务主体） |

⇒ **收敛方向（与本任务的修法一并考虑，不另立任务）**：
1. `quay-init.sh` 明确为 **skill 的私有实现**——不作为独立入口宣传（它现在已「技术上可调但无人文档化」，
   只差把这个暧昧状态**明确成设计**）；
2. CLI `quay init` 按本任务主体处理（报错改道 / `--help` 降级）；
3. **对用户可见的 init 路径恰好 1 条**。

**可硬化的判据**：装完包后，**用户能在文档里找到的 init 路径数 = 1**（当前 README+`--help` 合计 2 条，
而实际存在 3 条）。

**与 40→6 结晶的关系**：同一原则的两种应用——那边把 40 个内部工具收进 6 个入口，
这边把 3 个入口收成 1 个（一个变私有、一个报错改道）。**都是缩小暴露面。**

## 实跑证据（2026-08-07，执行完成）

### Contract measure（loop_flag_rejected，band: EXIT != 0）

```console
$ cd $(mktemp -d) && quay init --loop --dry-run 2>&1; echo EXIT=$?
quay init: unrecognized option --loop.
CLI `quay init` only scaffolds a brand-new EMPTY quay task store
(.quay/config.yml + tasks/); it accepts only --force / --dry-run / --root.

To lay the full quay loop mechanism into an existing project, the canonical
path is the /quay:init skill inside a Claude Code session:

    /quay:init --all --loop

Run `quay init --help` for the CLI surface, or open Claude Code in this
project and run /quay:init.
EXIT=1
```

**基线（修复前）：** EXIT=0，打印 dry-run 配置、无任何警告——`--loop` 被静默吞掉。**修复后：** EXIT=1，报错改道。✓

### Contract invariant（`quay --help` 顶层 init 说明不再可误读）

```console
$ quay --help | grep "quay init"
  quay init [--force] [--dry-run] [--root <path>]   (scaffold an EMPTY task store; the loop install is the /quay:init skill, NOT this command)
```

`quay init --help` 同样加注：「This command only scaffolds a brand-new EMPTY task store. It does NOT lay down the loop mechanism … the canonical path … is the /quay:init skill … /quay:init --all --loop. CLI init has no --loop flag; passing it is an error.」✓

### Contract control（传合法 flag ⇒ 行为不变，负控制）

```console
$ cd $(mktemp -d) && quay init            # EXIT=0, Created .quay/config.yml + tasks/
$ quay init --force                       # EXIT=0, Created（覆盖）
$ quay init --dry-run                     # EXIT=0
```

### 等价真实第三方项目复测（B 机 orangevps 不可达，用等价 shape：`.git` 在、`.quay/` 无）

```console
$ git init -q && echo "# third-party" > README.md && echo '{"name":"tp"}' > package.json
$ quay init --loop ; echo EXIT=$?
EXIT=1
$ ls plugin/scripts  # No such file or directory（修复前：报成功但 0 文件）
$ ls orchestration   # No such file or directory
$ ls .quay           # No such file or directory（不再铺任何东西）
```

**修复前（B 机实测，任务立项依据）：** `quay init --loop` exit 0、报「Workspace ready」，
但 plugin/scripts=0、orchestration/=0。**修复后：** exit 1 且不产生任何误导性产物。✓

### 测试

- `bash scripts/test.sh packages/quay/test/init.test.mjs` → **23/23 pass**（新增 6 个 collision 测试：AC1 ×2、AC2 ×2、AC3 负控制、native AC1）
- `bash scripts/test.sh packages/quay/test/cli.test.mjs` → **pass**（顶层 --help Usage synopsis 断言不回归）
- `bash scripts/test.sh --for-task gap-cli-quay-init-collides-with-the-canonical-slash-quay-init --allow-thin` → task-contract-check: **no violations**
- `bash scripts/test.sh` 全量 → **exit 137（OOM kill）+ 49 个既有门接线失败**（`gate(...) is not a function`，registry 缺 vmeta-lag/dogfood-evidence 等）；本次改动未引入新失败，见 DoD2

## Contract invoke 证据（2026-08-08 内层补）

invoke 实跑入口：`cd <tmp> && quay init --loop --dry-run; echo $?`（task-contract-check invoke-evidence 判据——done 任务须在 Contract 外展示所执行入口路径）
