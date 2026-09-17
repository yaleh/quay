---
id: gap-ac284-worktree-forkpoint-check
title: dispatch-worktree-setup.sh 只校验分支名 task/*、不校验分叉点 ⇒ GitHub 默认分支改成 master 后
  worker worktree 会静默从 master 分叉（AC-284）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-284
---
**type:** execution

## Proposal

**缺口（AC-284 判据，立案当轮直接量，2026-09-17，cwd = 主检出 `/home/yale/work/quay`）**：

`goals/AC-284-worker-任务-worktree-的分叉点被-merge-base-结构性校验-不再只查分支名.md` 的 criterion 要求
`plugin/scripts/dispatch-worktree-setup.sh` 含一条对 develop 的 merge-base/--is-ancestor 校验。逐字重跑
`node packages/quay/bin/quay.js goal gate AC-284` ⇒ **verdict: fail**，逐字：

```
CAUSE=forkpoint-check-absent — plugin/scripts/dispatch-worktree-setup.sh has no merge-base/is-ancestor check against develop; it only validates the branch NAME pattern (task/*), not where the branch actually forked from — a worktree could still be silently based on a stale/wrong commit while passing this guard
```

实测现场：该脚本的步骤 0（`:99`–`:114`）只做分支名前缀判定——能读出分支且不是 `task/*` ⇒ exit 2；否则放行。
**分叉点完全不在判定链里**。根部另一半在 `plugin/scripts/worker-driver.ts:1670` 的派发 prompt：逐字只有
`create an isolated git worktree for ${task}`，**不指名任何 base ref**；GOAL-023 记录今天的正确性是巧合
（GitHub 默认分支恰好 = develop，`EnterWorktree` fresh 模式恰好读到它）——默认分支一旦改成 master，
worker 会静默从 master 分叉，而现有闸只检查分支名是 `task/*`，放行。这正是 AC-284 要堵的面。

### ⚠️ 本缺口不是「加一行 grep 就完」——两条实测约束决定实现形态（立案当轮直查，可复算）

**约束 1：`master` 是 `develop` 的祖先 ⇒ 「分叉点落在 develop 的历史上」这条弱谓词【鉴别不出 master 分叉】。**

| 量 | 读数 | 取法 |
|---|---|---|
| `master` tip | `ae28758aa36a1d04fa4e4455505f608eb9437fd6` | `git rev-parse master` |
| `develop` tip | `e83933c60e91ff673e7e1d3989d54bf03548828b` | `git rev-parse develop` |
| `merge-base(master, develop)` | **= master tip**（`ae28758a…`） | `git merge-base master develop` |
| `master` 是否为 `develop` 祖先 | **YES**（exit 0） | `git merge-base --is-ancestor master develop` |

⇒ 一个从 master 分叉的 worktree，其 HEAD == master tip，**而这个 commit 本身就在 develop 的历史上**
⇒ 任何形如「HEAD / merge-base 落在 develop 历史上」的检查（`merge-base HEAD develop` 非空、
`--is-ancestor HEAD develop`、`rev-list --count develop..HEAD == 0`）**全部放行 master 分叉**。
能鉴别的是**反方向**的强谓词：**develop tip 必须被 HEAD 包含**（`--is-ancestor develop HEAD`）——
fresh 且正确时 HEAD == develop tip ⇒ 真；fresh 且从 master 分叉 ⇒ develop 不在 master tip 里 ⇒ 假 ⇒ 拒。

**约束 2：强谓词对「复用 / re-provision」路径会【假阳性】——实测 5/5 存活 worktree 全部不满足它。**

| worktree | 分支 | `git rev-list --left-right --count develop...HEAD` | `--is-ancestor develop HEAD` |
|---|---|---|---|
| `ac207fix-build` | (detached) | `3179  0` | 假 |
| `gap-ac214-sixth-crossing-…` | `task/…` | `2  0` | 假 |
| `gap-readme-drivers-cold-start-…` | `task/…` | `1  11` | 假 |
| `gap-release-cut-via-workflow-dispatch` | `task/…` | `562  7` | 假 |
| `gap-suite-split-15-over-30s-test-files` | `task/…` | `64  7` | 假 |

⚠️ 第 2 行值得单独看：它**自带 0 个提交**（右侧 0）却因 develop 前进而落后 2 个 ⇒ **连「新建后还没动过」的
worktree 都不满足强谓词**。而 `plugin/scripts/worker-driver.ts:2522` 的续做 prompt **会让 worker 对已有 worktree
再跑一次同一个脚本**（re-provision，idempotent）⇒ **天真实现会把每一次复用都判死**，把 worker 逼回共享检出
（正是本脚本存在的理由）。

⇒ 实现必须同时满足三件事，缺一不可：
1. **master 分叉必须被拒**（AC-284 的靶子）；
2. **合法 develop 分叉但 develop 已前进 / worktree 已自带提交的，不得被拒**（约束 2 的五条实测形态）；
3. **「无法评估」必须是一个独立取值**，⛔ 不得与「查过且合格」同形（硬规则 3b；plain-dir 夹具与第三方
   quay-init workspace 里根本没有 develop ref，现有 lenient 行为被既有测试依赖）。

**候选设计（实现者择一，并在脚本注释与任务体写下理由；⛔ 本任务不预设）**：
(a) 由创建点显式指名 base（`git worktree add -b task/<id> <path> develop` + 脚本收 `--base`），把检查锚在
「创建那一刻」而非「任意时刻」；
(b) 脚本内用 master/默认分支做**反例鉴别**（HEAD 等值/落后于 master ⇒ 用了错 base ⇒ 拒）。
⚠️ (b) 会重新引入对默认分支值的依赖，而 GOAL-023 第 2 部分的原话正是「使这个不变量**不再依赖** GitHub
默认分支的值」——选 (b) 必须在任务体正面交代这一点，不得沉默略过。

<!-- dedup-ref -->
**去重核对（机制，不是症状关键词）**：本 store 内**无任何任务**以顶层 `goal_ac: AC-284` 认领该 AC（逐文件扫
`^goal_ac:`；GOAL-023 五条 AC 中目前只有 AC-283 有主）。按机制词复扫（`merge-base` / `is-ancestor` / `分叉点` /
`fork point` / `dispatch-worktree-setup`）逐条排除：`tasks/gap-ac283-author-pushed-to-origin-and-ancestor-of-local.md`
认领 **AC-283**（push author）——与本任务共用 GOAL-023 但落地面完全不同（远程 ref vs 脚本闸），不是同一机制；
`tasks/gap-dispatch-worktree-setup-zero-production-callers.md`（done）修的是**该脚本有没有被派发 prompt 调用**
（wiring），与本条「闸内缺少分叉点校验」是不同缺陷；
`gap-task-branch-prefix-assumption-scattered-read-sites-orphan-enumeration-blind`（已落地为脚本步骤 0）做的是
**分支名唯一化**，正是本条要补的「不只查分支名」的前一步，不重叠。

## Plan

1. **取一次现场读数**（⛔ 不假定还是立案时这些值）：`node packages/quay/bin/quay.js goal gate AC-284`、
   `git merge-base --is-ancestor master develop`、5 条存活 worktree 的 `rev-list --left-right --count develop...HEAD`。
2. **定设计**：按 Proposal 约束 1/2/3 选定 (a)/(b) 之一，把「为什么强谓词不能裸用」写进脚本注释
   （写在脚本里，不是只写在任务体）。
3. **改闸**：在步骤 0 的分支名检查之后加**分叉点检查**，判定行必须是一条**真实命令**
   （⛔ 不是注释里提一句 `merge-base`：criterion 是文本 grep，而 AC2 的行为控制才是它的实质）。
   三类结果三分：`PASS`（合法分叉）/ `REFUSE exit 2 + 具名 CAUSE`（用了错 base）/
   `NOT-EVALUATED`（读不出，独立取值 + 不阻塞）。
4. **补测试**（`plugin/test/dispatch-worktree-setup.test.mjs`，复用既有 `makeRepoWithBranchWorktree()` 夹具——
   它已经会建真 git repo + worktree，只需再加一个 `develop` ref）：负控制（master 分叉 ⇒ exit 2）、
   正控制（develop 分叉 ⇒ exit 0）、假阳性对照（约束 2 形态 ⇒ 不拒）、NOT-EVALUATED（无 develop ref ⇒ 独立取值且不阻塞）。
5. **跑门**：`bash scripts/test.sh plugin/test/dispatch-worktree-setup.test.mjs` 全绿（含既有 4 组用例）。
6. **核 goal 判据**：`node packages/quay/bin/quay.js goal gate AC-284` ⇒ `verdict: pass`，贴完整输出。
7. **5b 清扫**：grep 同一原则的其余适用点（`worker-driver.ts:1670` 的 create prompt 不指名 base；
   `EnterWorktree` fresh 模式读默认分支；其余 `git worktree add` 调用点），把命中数与前 3 条贴进任务体；
   ⛔ 不擅自扩大改动范围——修，或**显式记为范围外并给理由**，二选一，不得沉默略过。
8. **留痕**：判据输出、四条控制的 exit code、约束 1/2 的复算读数，内联任务体或 `.quay/ac284-*` 未跟踪 scratch。
9. **收口**：AC 全勾 ∧ `gate AC-284` pass ∧ 测试绿，然后提交。

## AC

- [x] **AC1（goal 判据逐字绿）**：`node packages/quay/bin/quay.js goal gate AC-284` ⇒ `verdict: pass`，贴出**完整**输出。
      ⛔ 不得改宽 `goals/AC-284-*.md`——`criterion` / `expect` / `origin` / `activatedAt` 四处一字未动
      （举证：`git diff develop -- goals/AC-284-*.md` 零命中）。
- [x] **AC2（负控制：master 分叉被拒——这条才是「不只是注释里有 merge-base」的证据）**：在一个 `master` 是
      `develop` 祖先的真实 git 夹具里（复现本仓库约束 1 的实测形态），对**从 master 建出的** worktree 跑脚本 ⇒
      **exit 2**，且 stderr 具名指出分叉点/base 问题。⛔ 不满足于「字符串出现在脚本里」；本条读的是**退出码**。
- [x] **AC3（正控制：合法 develop 分叉仍 exit 0）**：同一夹具，`task/<id>` 分支从 **develop** 建出的 worktree ⇒
      exit 0 ∧ `node_modules` 就位（既有 4 组用例一并复跑，⛔ 不得回归）。
- [x] **AC4（假阳性对照：约束 2 的实测形态不得被拒）**：构造「从 develop 分叉后 develop 又前进」与
      「worktree 已自带提交」两种夹具（即 `develop...HEAD` 非零的真形态）⇒ 脚本**不得 exit 2**；
      并把**存活 worktree 的实测读数表**（Proposal 约束 2 那张，立案当轮 5/5 全部不满足强谓词）重取一次贴出，
      证明新闸对它们是「放行 / NOT-EVALUATED」而非「拒绝」。
- [x] **AC5（无法评估 ≠ 合格，硬规则 3b）**：`develop` ref 不存在的仓（`git init` 夹具，模拟第三方 quay-init
      workspace）⇒ 脚本输出一个**可 grep 的独立取值**（如 `NOT-EVALUATED`），⛔ 与 `PASS` 不同形；并明确它
      **不阻塞** provisioning（既有 plain-dir 用例仍 exit 0）。举证：贴出该夹具下 stdout/stderr 与 exit code。
- [x] **AC6（5b 清扫有产物）**：按 Plan 第 7 步 grep 同一原则的其余适用点，贴出**命中数与前 3 条命中**，
      并逐条注明「本任务修 / 范围外 + 理由」。⛔ 不要求全部修，但**不得没有这个数**。
- [x] **AC7（测试与覆盖）**：新控制落在 `plugin/test/dispatch-worktree-setup.test.mjs`（保留首行
      `// @test-group engine`），`bash scripts/test.sh plugin/test/dispatch-worktree-setup.test.mjs` 全绿并贴出末屏。
      ⛔ 若因此改了 `worker-driver.ts`（候选设计 (a) 的连带面：`dispatchSetupSignature` 要带 `--base`），
      必须同时更新 `plugin/test/worker-driver.test.mjs` / `plugin/test/worker-driver-resident.test.mjs` 里那条
      「`bash <script> <worktree>` 逐字形态」的断言，并把它们跑绿。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「脚本里出现了 `merge-base` 这个词」，而是
**这条闸真的会拦下一次错误分叉、同时不拦合法工作**：

1. **落地对象**：`gate AC-284` 在真实 `goals/AC-284-*.md` 上 `verdict: pass`，贴完整输出。
2. **可被打红**：AC2 的 master-分叉夹具**实际跑过**，贴上 exit code 与 stderr——证明这条闸不是恒绿（硬规则 4）。
3. **不误杀**：AC4 的两种真形态夹具 + 存活 worktree 实测表，证明强谓词不是裸用（这条是本任务最容易做错的地方，
   判据必须留下「为什么没有误杀」的读数，而不是一句「应该不会」）。
4. **说实话**：AC5 的 NOT-EVALUATED 是独立取值，不是与 PASS 同形的静默通过（硬规则 3b）。
5. **证据留痕**：判据输出、四条控制的 exit code、约束 1/2 的复算读数，内联任务体或 `.quay/ac284-*` 未跟踪
   scratch，可被下一轮独立复算（⛔ 不是只写一句「已加校验」）。

## Touches

- plugin/scripts/dispatch-worktree-setup.sh
- plugin/test/dispatch-worktree-setup.test.mjs
- tasks/gap-ac284-worktree-forkpoint-check.md

（说明：若选候选设计 (a)，还需加 `plugin/scripts/worker-driver.ts` + `plugin/test/worker-driver.test.mjs` +
`plugin/test/worker-driver-resident.test.mjs`——这三条在实现者选定 (a) 后必须补进本节，再改代码。
⛔ `packages/quay/plugin/scripts/dispatch-worktree-setup.sh` **不声明**：`.gitignore:26` 整目录忽略
（`git check-ignore` 实测命中），它是 npm-pack 在源树内 stage 的镜像、由构建重生成，不进 `actualFiles`；
证据一律内联任务体或写进 `.quay/ac284-*` 未跟踪 scratch 文件。若确要把某个 `.quay/ac284-*` 文件**提交**，
必须把它的**精确路径**加进本节。）

## Implementation & Evidence（2026-09-17，worker `gap-ac284-worktree-forkpoint-check`）

**提交**：`abb3e8ab8`（实现）+ `ef41dcc2a` / `75b1e1102`（merge develop）。
**落点**：`plugin/scripts/dispatch-worktree-setup.sh` 步骤 **0b**（分支名检查之后），三分取值
`fork-point PASS` / `fork-point REFUSED`（exit 2）/ `fork-point NOT-EVALUATED`（独立取值、不阻塞）。

### 选定的设计：不是 (a)，也不是 (b) 的裸用

**判据来源 = 分支的创建记录**——reflog 首条 `branch: Created from <起点>`。这是「分叉点」在事后**唯一可靠**
的记录（实测：`git worktree add -b X path develop|master|<sha>` 分别记录起点为 `develop` / `master` / 该 sha），
也就是把检查锚在**创建那一刻**（(a) 的实质），但不需要改 `worker-driver.ts` 的 prompt。
拒绝面另加一条**结构性兜底**：起点无法具名时，若分叉点**恰是**某条落后线的 tip ⇒ 同样拒。

**对默认分支值的依赖（Proposal 要求正面交代，不得沉默略过）**：本实现**不硬编码**默认分支的值。
承载拒绝的是**仓库自己的 ref**（创建记录具名的那条分支 + `master`/`main`/`origin-HEAD` 指向者），
且只有当该 ref **严格落后于 base** 时才拒；`PASS` 面完全不经过默认分支 ⇒ 默认分支换成 master 或换回
develop，PASS 面一字不变 ⇒ GOAL-023 第 2 部分「不再依赖 GitHub 默认分支的值」成立。默认分支只在
**拒绝面**作为反例鉴别器出现。

**为什么强谓词只作 PASS 的充分条件、不作拒绝条件**：见下方 AC4 实测表。

### 约束 1 / 2 复算 + 一条立案时未发现的反例（这是本任务最容易做错的地方）

**约束 1 复算（2026-09-17 05:0xZ，cwd=主检出）**：`rev-parse master` = `ae28758aa36a1d04fa4e4455505f608eb9437fd6`；
`rev-parse develop` = `e27f111ed4b8a5feca7b8579d831c2d95f8aa476`；`merge-base master develop` = `ae28758aa…`
（**= master tip**）；`--is-ancestor master develop` **exit 0**；`rev-list --count develop..master` = **0**（286 反向）。
⇒ 弱谓词全部放行 master 分叉，复算成立。

**约束 2 重取 + 新闸逐条判定（`--dry-run`，只读判定、不动任何 worktree）**：

| worktree | 分支 | `develop...HEAD` | `--is-ancestor develop HEAD` | `merge-base(HEAD,develop)` 是 master 祖先？ | 创建记录 | 新闸 |
|---|---|---|---|---|---|---|
| `ac207fix-build` | (detached) | `3182  0` | 假 | 是 | （无分支，无 reflog） | rc=0 **skip**（无分支可判） |
| `gap-ac214-sixth-crossing-…` | `task/…` | `5  0` | 假 | 否 | `Created from develop` | rc=0 **PASS** |
| `gap-ac284-worktree-forkpoint-check` | `task/…` | `0  0` | 真 | 否 | `Created from develop` | rc=0 **PASS** |
| `gap-readme-drivers-cold-start-…` | `task/…` | `4  11` | 假 | 否 | `Created from develop` | rc=0 **PASS** |
| `gap-release-cut-via-workflow-dispatch` | `task/…` | `565  7` | 假 | **是** | `Created from develop` | rc=0 **PASS** |
| `gap-suite-split-15-over-30s-test-files` | `task/…` | `67  7` | 假 | 否 | `Created from develop` | rc=0 **PASS** |

⚠️ **新发现（立案时没有，是本任务实现形态的决定性一条）**：`gap-release-cut-via-workflow-dispatch` 的
`merge-base(HEAD, develop)` = `ae15f8643` **是 master 的祖先**，而它是一条**合法的 develop 分叉**
（创建记录 `Created from develop`）。⇒ 「分叉点落在 master 历史上 ⇒ 用了错 base」这个看似自然的判据
**会误杀一条真实存活的任务 worktree**。所以拒绝面用的是**「分叉点恰是那条线的 tip」**（精确等值），
⛔ 不是「落在它的历史上」。这条读数就是 DoD 第 3 条要的「为什么没有误杀」。

### 四条控制的 exit code 与逐字输出（AC2 / AC2b / AC3 / AC4a / AC4b / AC5）

夹具形态（每个独立 tmp 仓）：`git init` → 显式 `symbolic-ref HEAD refs/heads/master`（钉死默认分支，
不让宿主 `init.defaultBranch` 决定夹具形状）→ 基线提交 = master → 切 `develop` 再加一条提交 ⇒ **master 严格落后于 develop**
（与约束 1 同形）→ `git worktree add -q -b <task 分支> wt <起点>`。

```
AC2  从 master 建出（显式指名 master）
     exit=2
     stderr: dispatch-worktree-setup: fork-point REFUSED — the branch was created from 'master'
             (a51e58eeb5362ae03782563b5f70a8c13c297b7a), which is strictly behind develop
             (ea28cfb08e23d73f72ed59cad82a562a8aec1b6f); refusing to provision (a task worktree
             must fork from develop, not from the release/default line)
     ∧ node_modules 未被创建（拒绝时零 provisioning）

AC2b 隐式建出（`git worktree add -b X wt`，**不指名 base**，调用方 HEAD = master）
     → 创建记录 = `branch: Created from HEAD`（不具名任何 base）
     exit=2
     stderr: dispatch-worktree-setup: fork-point REFUSED — its fork point
             51a927de1bde47d0756565251dc6b7378db6e029 is exactly the tip of 'master', which is
             strictly behind develop (936ef934…); refusing to provision …
     ⇒ 这条拒绝**只可能**来自结构性半边（起点不具名），不是名字匹配 —— 也是 GOAL-023 担心的那个真实形态

AC3  同一夹具、从 develop 建出
     exit=0
     stdout: dispatch-worktree-setup: fork-point PASS — HEAD contains develop (ea28cfb08e23d73f72ed59cad82a562a8aec1b6f)
     ∧ node_modules 就位（symlink → 夹具 main/node_modules）

AC4a 从 develop 建出、之后 develop 再前进（夹具实测 `develop...HEAD` = `1  0`）
     exit=0
     stdout: dispatch-worktree-setup: fork-point PASS — task/adv was created from 'develop'
             (= the base develop); develop having advanced since the fork is not a wrong base
     ∧ stderr 无 REFUSED

AC4b 从 develop 建出、worktree 自带提交（夹具实测 `develop...HEAD` = `0  1`）
     exit=0
     stdout: dispatch-worktree-setup: fork-point PASS — HEAD contains develop (936ef93426216c1abdd393598b48b1c46f83b83e)
     ∧ stderr 无 REFUSED

AC5  `git init` 仓（无 develop ref；模拟第三方 quay-init workspace）
     exit=0
     stdout: dispatch-worktree-setup: fork-point NOT-EVALUATED — base ref 'develop' does not
             resolve in <wt>, so no structural fork-point judgement is possible (not blocking;
             this worktree cannot be checked for a wrong base)
     ∧ stdout 不含 `fork-point PASS`（两个取值不同形）∧ stderr 不含 REFUSED
     ∧ node_modules 仍就位（NOT-EVALUATED 不阻塞 provisioning）
```

`AC5` 与 `AC2b` 是本任务两条「形状」证据：**「读不懂」有独立取值、不伪装成合格**（3b），
而「读懂了且是错的」**实际打红**（硬规则 4：这条闸不是恒绿）。

### AC1 — gole 判据（在最终 merge 后的 worktree 上重跑）

```
$ node packages/quay/bin/quay.js goal gate AC-284
{
  "id": "AC-284",
  "verdict": "pass",
  "reason": "acceptance passed (exit 0)",
  "timestamp": "2026-09-17T05:08:00.444Z",
  "dryRun": false,
  …
}
EXIT=0
```

`git diff develop -- goals/AC-284-*.md` ⇒ **零命中**（criterion / expect / origin / activatedAt 一字未动）。
判据文本 grep 的 `merge-base --is-ancestor` 是脚本里的**真实命令**（步骤 0b 两处：`--is-ancestor <base> HEAD`
与 `--is-ancestor <候选线> <base>`），⛔ 不是注释里提一句。

### AC6 — 5b 清扫（同一原则的其余适用点）

**扫法（可复算）**：
```
grep -rnE '^[[:space:]]*(if[[:space:]]+!?[[:space:]]*)?git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+worktree[[:space:]]+add' \
  --include=*.sh --include=*.ts --include=*.mjs plugin/ scripts/ packages/ | grep -v node_modules | grep -v /test/
```
⇒ **命中数 = 10 行 = 5 个唯一生产调用点**（10 = 5 × 2：`packages/quay/plugin/…` 是 npm-pack 在源树内 stage 的
镜像，非独立调用点）。**前 3 条命中（按行序）**：

| # | 命中 | 本任务修 / 范围外 + 理由 |
|---|---|---|
| 1 | `plugin/scripts/publish-dist-branch.sh:99` — `git -C "$REPO_ROOT" worktree add --quiet --detach "$WORK" HEAD` | **范围外**：显式 `--detach ... HEAD`，非任务 worktree，不在本闸（`dispatch-worktree-setup.sh`）的适用面内 |
| 2 | `plugin/scripts/integration-batch-merge.sh:968` — `worktree add -q --detach "${tmp_wt}" "${develop_tip}"` | **范围外**：起点显式 = `${develop_tip}`，已指名正确 base |
| 3 | `plugin/scripts/develop-deliver-tgz.sh:1678` — `worktree add --detach "${wt}" "${develop_tip}"` | **范围外**：同上，起点显式 = `${develop_tip}` |

其余两条：`plugin/scripts/verify-deliver-coldstart.sh:848`（`--detach "$wt" "$sha"`，显式 sha ⇒ 范围外）、
`plugin/scripts/checker-mutation-cases/worktree-node-modules-check.sh:28`（`-q -b task/fixture "$wt" HEAD`：
**另一个检查器的突变夹具**，不经过本脚本；且该夹具仓无 develop ref ⇒ 即使经过也只会得到 NOT-EVALUATED ⇒ 范围外）。

**非命令行的根部另一半（同类原则、不同载体）**：
`plugin/scripts/worker-driver.ts:1670` 的派发 prompt 逐字仍是 `create an isolated git worktree for ${task}`，
**不指名 base** —— 这是**生产端**的一半。**显式记为范围外，理由三条**：
① 它是**预防面**，本任务是**检测面**，且检测面已 fail-closed（AC2b 实测：隐式分叉从 master 出 ⇒ **exit 2**），
错 base 的 worktree 现在**进不了 provisioning**；
② 改它要连带 `plugin/test/worker-driver.test.mjs` + `plugin/test/worker-driver-resident.test.mjs` 里
「`bash <script> <worktree>` 逐字形态」的断言，并把 `## Touches` 扩三条（AC7 已把这条列为条件分支）；
③ 本任务的 `## Touches` 声明为三文件，⛔ 不擅自扩大改动范围——按 Plan 第 7 步「修，或显式记为范围外并给理由」取后者。
**建议的后续动作**（不在本任务内）：把 prompt 第 1 步改为显式 `git worktree add -b task/<id> <path> develop`，
使创建记录具名 `develop` ⇒ 新闸的判定从 NOT-EVALUATED 升为 PASS（预防面与检测面同时到位）。

**另两条同类记录（文档侧，非代码）**：`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md:73`
（实测 `EnterWorktree` 建出的 worktree 落在 `9316b797d` = master tip、`HEAD..develop` = **19555**）与
`orchestration/RUNBOOK-non-worker-driver-code-change-fan-in-2026-09-01.md:27`（同形，手工 `checkout -b … develop` 绕开）
—— 同一条原则在**文档侧**的独立实证，本任务不改它们（GOAL-023 第 5 部分另有一条 AC 负责 SPEC 修订）。

### AC7 — 测试与门

- 新增 6 条用例落在 `plugin/test/dispatch-worktree-setup.test.mjs`（首行 `// @test-group engine` **保留**），
  夹具 `makeForkpointRepo()` 每次现建真 git 仓（含「master 是 develop 祖先」的**前提断言**，夹具形态被钉住）。
- `bash scripts/test.sh --for-task gap-ac284-worktree-forkpoint-check --allow-thin` ⇒ **exit 0 全绿**，
  **tests 29 / pass 29 / fail 0**（既有 23 条一并复跑，零回归）。
- ⛔ **未**改 `worker-driver.ts` ⇒ AC7 后半条（更新两个 worker-driver 测试文件的逐字断言）**不适用**。
- scoped-gate 缓存已按**门实跑的 develop tip** `638167f6b8e1cf8140178dd3d56a13ce6ca54ca8` 记录
  （⛔ 不是写缓存那一刻 develop 可能已经前进的新值）。

### 落地形态（供下一轮独立复算）

```bash
# 负控制（应 exit 2）
git init -q; git symbolic-ref HEAD refs/heads/master; git commit -m baseline
git checkout -q -b develop && git commit -m d1            # master 严格落后于 develop
git worktree add -q -b task/x wt master
bash plugin/scripts/dispatch-worktree-setup.sh wt --root . ; echo $?   # ⇒ 2
# 正控制（应 exit 0）
git worktree add -q -b task/y wt2 develop
bash plugin/scripts/dispatch-worktree-setup.sh wt2 --root . ; echo $?  # ⇒ 0
```
