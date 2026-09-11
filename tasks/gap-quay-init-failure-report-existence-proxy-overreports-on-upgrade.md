---
id: gap-quay-init-failure-report-existence-proxy-overreports-on-upgrade
title: quay-init 失败路径报告用【存在】冒充【本次写到】⇒ 对非空目标升级时把本次根本没碰过的文件报成 written（实测
  config.yml 逐字节未变仍报 written:）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Finding

来源：`gap-aged-third-party-project-quay-upgrade-verification`（GOAL-009-AC-238，升级路径验证）的实测副产物。
2026-09-11 本机 + orangevps 双处可复现。

**机制**：`plugin/scripts/quay-init.sh:1930` 的 `report_closed_set_state()` 逐项判闭集七项，用的是
`[ -e "$WORKSPACE_ROOT/$p" ]`（:1932）——**存在性**。它输出的词表是 `written:` / `unwritten:`，
即把「这个路径现在存在」当成「**本次这次运行写了它**」。

**为什么这个代理量在原场景成立、在升级场景失效**：写路径本身是 fresh-install 假设——
`quay-init` 原本只被当作「初始化一个空目录」的入口，那里 `存在 ⟺ 本次写的`，代理量无害。
一旦目标是**非空**的（升级一个已经跑过 quay-native 的既有项目，本任务正是这个场景），
两个量分离，报告就开始**超额归功**。

**实测对照（同一失败点：无可探测的 test command ⇒ exit 2；同一条代码路径，两种输入）**：

```
【目标 = 全新空目录】（前任任务 gap-quay-init-hard-requires-tmux-session-and-leaves-partial-write
                      的 AC3 Evidence 用fixture 正是这一形态）
quay-init FAILED (exit 2) — closed-set write state:
  unwritten: .quay/config.yml
  unwritten: .quay/profiles.yml
  unwritten: tasks
  unwritten: goals
  unwritten: .gitignore
  unwritten: .claude/launch.settings.json
  unwritten: .claude/settings.json
  ⇒ 七项全 unwritten，与前任任务的记录精确吻合

【目标 = 非空既有项目】（.quay/config.yml 与 tasks/ 已存在）
quay-init FAILED (exit 2) — closed-set write state:
  written:   .quay/config.yml      ← ⛔ 本次【没有写它】
  unwritten: .quay/profiles.yml
  written:   tasks                 ← ⛔ 本次【没有写它】
  unwritten: goals
  unwritten: .gitignore
  unwritten: .claude/launch.settings.json
  unwritten: .claude/settings.json

同一次运行里对 .quay/config.yml 做 before/after 逐字节比对：diff 为空（UNTOUCHED）。
⇒ 报告说的「written」与「本次真的写了」在非空目标上**相反**。
```

**危害方向是危险的那一侧**：该函数的注释自陈目的是让「初始化了一半」与「没初始化」可区分
（硬规则 3b 写入侧镜像）。在升级路径上它做的恰好相反——它把一个**什么都没改的失败运行**
描述成已经改写了 config，读者据此会以为目标已被部分接管。

**与前任任务的关系（不是重复）**：`gap-quay-init-hard-requires-tmux-session-and-leaves-partial-write`
（done）处理的是**非原子写入**（真的可能写了一半）。本条处理的是**报告这个仪器本身**：
即使本次一个字节都没写，它也会报出 written。前任 AC3 的 Evidence 原文
「实测 pre-write 失败（无 test command）时报告六项全 unwritten」——**在它的空目录 fixture 上为真，
在非空目标上为假**。⇒ 该 AC 是被一个「代理量与目标量恰好重合」的 fixture 满足的
（硬规则 4 推论三：一个只能被 fixture 满足的判据不是测量）。

**同族**：硬规则 4b（代理量会与实际偏离）。这里的代理量是「存在」，实际量是「本次写到」。

## AC

- [x] AC1 非空目标 + 前置失败（无可探测 test command）时，报告**不得**把本次逐字节未改的文件标成
      `written:`。判据（可机械跑）：建一个 `.quay/config.yml` + `tasks/*.md` 已存在的 fixture，跑
      shipped quay-init 且不提供 test command ⇒ 报告中 `.quay/config.yml` 的项**不是** `written:`；
      对 config 做 before/after 逐字节 diff 为空而报告仍称 written ⇒ RED。
      **落实**：`plugin/test/quay-init.test.mjs` 的
      `AC1 — a pre-write failure on a NON-EMPTY target never marks an untouched file as written`。
      该测试先断言「本次没动 config 的字节」（`Buffer.compare === 0`，即 RED 条件的前置成立），
      再断言报告既不含 `written: .quay/config.yml` 也不含 `written: tasks`，且两者都在
      `pre-existing:` 里。**负控制**：把 `report_closed_set_state` 换回存在性实现，本测试 RED。
- [x] AC2 负控制：全新空目录上同一失败仍报七项全未写（前任 AC3 的行为不得回归）——
      同一判据脚本跑空目录输入，必须仍全部 `unwritten:`。
      **落实**：`AC2 — negative control: on a fresh EMPTY target the same failure still reports all
      seven unwritten`。断言 `written`/`pre-existing`/`unreadable` 三个桶全空 + 七项逐个在
      `unwritten:` 里。**负控制**：存在性实现下本测试同样 GREEN ⇒ 它测的是「没回归」，不是「修好了」。
- [x] AC3 报告的取值词表至少能区分三态——**本次写的** / **原本就在、本次没动** / **不存在**——
      而不是二值存在性。判据：对同一份输出按项解析，三态各自的样本都能被观察到（缺任一态 ⇒ RED）。
      **落实**：`AC3 — one run's output carries ≥3 distinguishable states (written / pre-existing /
      unwritten)`，单次运行（`tasks/` 预置 + `.claude` 是文件 ⇒ 中途 abort）同时产出三态，
      并断言各自的具体归属（config.yml=written / tasks=pre-existing / .claude/settings.json=unwritten）。
      实现侧词表为**四态**（AC 要求"至少三态"）：`written:` / `pre-existing:` / `unwritten:` /
      `unreadable:`——第四态让「读不到」不与「不存在」同形（硬规则 3b）。判据词表在
      `REPORT_STATES` 里由断言逐个覆盖，且 `quay-init-closure-assertion.ts` 的
      `reportedItems()` 是消费侧唯一的枚举点。**负控制**：存在性实现下本测试 RED。
- [x] AC4 已有回归测试覆盖该报告；新增覆盖用非空目标（当前测试的 fixture 形态结构上碰不到该分支）。
      **落实**：既有 `AC3 — a mid-write failure lists the seven-item written/unwritten state`
      仍覆盖失败路径报告且保持 GREEN（空目录 fixture，形态不变）；新增的 AC1/AC3 两条用**非空**
      目标（预置 `tasks/`／`.quay/config.yml`），即旧 fixture 结构上碰不到的分支。
      另按硬规则 5b 枚举了该报告格式的**全部**消费点并逐一更新：
      `plugin/scripts/quay-init-closure-assertion.ts`（解析器 + 新增 `reportedItems()`）、
      `plugin/test/quay-init-laydown-closure.test.mjs`（改用 `reportedItems()`）、
      `plugin/test/quay-init.test.mjs`。`grep -rn "unwritten" --include=*.{ts,mjs,sh}` 的其余命中
      经逐条核对与本报告无关（`proposal-convergence.ts` 的两处是注释里的英文单词）。

## DoD

在一台**非本机主机**的**非本仓库项目**上真跑一次：目标预置为**非空**（已有 `.quay/config.yml`
与 `tasks/`）、且该次运行在 test-command 前置上失败；把「报告逐项归属」与「闭集七项的独立
before/after 逐字节 diff」并列贴进 Evidence，证明两者的归属一致（本次没写的不报 written）。
`scripts/test.sh` 全量绿。

## Evidence

### DoD —— 非本机主机（orangevps）× 非本仓库项目 × 非空目标 × 前置失败

主机 `orangevps`（`Linux 6.8.0-136-generic x86_64`，`bash 5.2.21`）；目标
`/home/yale/quay-init-dod-2026-09-11/legacy-project` —— **不是 git 仓库**
（`git rev-parse --is-inside-work-tree` ⇒ `fatal: not a git repository`），**七项全部预置**。
失败点为 test-command 前置（目标内无可探测的 test command）⇒ exit 2，**在任何写入之前**。

「独立 before/after 逐字节」用**另一份 python3 测量**（递归 walk + 每文件 sha256 逐字节，
文件走其字节哈希），与被测的 shell 实现无共享代码。**同机同 fixture 上跑两版实现作为对照**：

```
=================== OLD implementation (exit 2) ===================
--- quay-init 自己的逐项归属 ---
      written:   .quay/config.yml
      written:   .quay/profiles.yml
      written:   tasks
      written:   goals
      written:   .gitignore
      written:   .claude/launch.settings.json
      written:   .claude/settings.json
--- 独立 before/after 逐字节判定 ---
      UNCHANGED  .quay/config.yml
      UNCHANGED  .quay/profiles.yml
      UNCHANGED  tasks
      UNCHANGED  goals
      UNCHANGED  .gitignore
      UNCHANGED  .claude/launch.settings.json
      UNCHANGED  .claude/settings.json
      ⇒ 报告称七项全 written，独立测量称七项全 UNCHANGED —— 两者相反

=================== NEW implementation (exit 2) ===================
--- quay-init 自己的逐项归属 ---
      pre-existing: .quay/config.yml
      pre-existing: .quay/profiles.yml
      pre-existing: tasks
      pre-existing: goals
      pre-existing: .gitignore
      pre-existing: .claude/launch.settings.json
      pre-existing: .claude/settings.json
--- 独立 before/after 逐字节判定 ---
      UNCHANGED  .quay/config.yml
      UNCHANGED  .quay/profiles.yml
      UNCHANGED  tasks
      UNCHANGED  goals
      UNCHANGED  .gitignore
      UNCHANGED  .claude/launch.settings.json
      UNCHANGED  .claude/settings.json
      ⇒ 报告与独立测量逐项一致：本次没写的不报 written
```

（对照落地：`scp` 到 orangevps 的 tarball 内含两版 `quay-init.sh`，新版 sha256
`a1716ee3da054ea5a8c4c8bfc729908a057ace7f45c6156f6398486a55079494`，与本 worktree 内的文件一致；
同机同 fixture 依次跑两版，唯一变量是实现本身。）

### AC 级负控制（本机，`node --test --test-concurrency=1 plugin/test/quay-init.test.mjs`）

| 测试 | 修复后 | 换回存在性实现 |
|---|---|---|
| `AC1 — … NON-EMPTY target never marks an untouched file as written` | ✔ | ✖ RED |
| `AC2 — negative control: on a fresh EMPTY target … seven unwritten` | ✔ | ✔（测的是「没回归」） |
| `AC3 — one run's output carries ≥3 distinguishable states` | ✔ | ✖ RED |
| `AC3 — a mid-write failure lists the seven-item state`（既有） | ✔ | ✔ |
| 其余 7 条既有用例 | ✔ | ✔ |

### 成本（硬规则 4：先分解再谈指标）

预写快照 = 每次 quay-init 多 7 次 `sha256sum`/`ls` 子进程。实测（本机，3 次取均，微小目标）：
`447 ms/run`（有快照）vs `426 ms/run`（无快照）⇒ **+21 ms/run**，相对该量级约 5%；
在真实安装（该文件注释记 ~33 s 级）下可忽略。**该成本未被设为阈值**，仅作记录。

## Touches

- `plugin/scripts/quay-init.sh`
- `plugin/scripts/quay-init-closure-assertion.ts`
- `plugin/test/quay-init.test.mjs`
- `plugin/test/quay-init-laydown-closure.test.mjs`
- `tasks/gap-quay-init-failure-report-existence-proxy-overreports-on-upgrade.md`
