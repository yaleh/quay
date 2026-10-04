---
id: gap-manager-tick-core-hardcodes-quay-dev-root-silently-wrong-repo
title: manager-tick-core 硬编码 ROOT=/home/yale/work/quay 且读未 ship 的
  orchestration/——在任何消费工作区静默指错仓库
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Finding

**结论**：`plugin/workflows/manager-tick-core.js` 是**纯 quay-dev-only** 的，但被注册成所有装了 quay 插件的工作区都可见的 workflow。在消费工作区调用它，拿到的不是崩溃，而是**关于 `/home/yale/work/quay` 的读数**——静默指错仓库，比崩溃更坏（硬规则 3b：读不懂/不适用必须与合格可区分）。

**两个独立机制**：

**① 硬编码宿主路径（源码层）**。`manager-tick-core.js:57` `const ROOT = '/home/yale/work/quay'`。实测存在于**全部**已发布版本（cache 0.9.0 / 0.10.0 / 0.11.0 / 0.12.0-dev 与 `origin/dist-plugin` 全部命中同一行）——不是某版的漂移，是一开始就没搬。该值同时喂给 readings agent 的命令块与 audit agent 的 `git log --since='40 minutes ago' -- ${ROOT}`。

**② 要读的四份正本，交付面一份都没有**。workflow 读 `orchestration/manager-tick-core.md`（`:254`）、`manager-tick-criteria.md` / `-closing.md` / `-sending.md`（`:142-144`）、`orchestration/manager-anchor-check.py`（`:250`）。实测发布 cache `quay/quay/0.12.0-dev/`：

- `manager-tick-criteria.md` / `-closing.md` / `-sending.md` / `manager-anchor-check.py` ⇒ **搜索 0 命中，全部未 ship**
- 唯一 ship 的是 `loop/manager-tick-core.md`，而它全文只有一行：`> 正本: orchestration/manager-tick-core.md — 本文件只应存在这一行指针` ⇒ **一张指向消费工作区不存在路径的指针**

**意图与产物直接矛盾**：`plugin/skills/manager/SKILL.md:16` 逐字写「any quay install can bring up a manager; **it is not a quay-local artifact in `orchestration/`**」。⇒ 声称可安装，产物是 quay-dev-only。当前状态下「可安装」只是一句声称，移植从未做过。

**同文件第四次同形（硬规则 5b：兄弟实例常在同一文件）**：该文件 `:61-77` 用三条注释记录了同一教训的三次事故并已修——写死 session id（`b8dc91a6-…`，transcript 里根本不存在）→ 改为查 host；写死注册名匹配 `quay-manager`（会话被杀+resume 后漂移成 `quay-a8`）→ 改为由主循环经 `args.managerSessionId` 现传。而 `const ROOT` 就在 **`:57`，即上一条教训下方二十行**，第四次没修。这正是硬规则 4 推论二（钉死字面量的合理性依赖当前环境，换环境静默失效）。

**零 I/O 约束（决定修法形态）**：`:38-42` 记录本 workflow 无 `require`/`process`/`fetch`，零 I/O ⇒ **它无法用 fs 自检工作区**。所以守卫不能是「自己查一下 orchestration/ 在不在」，必须是**由 args 现传入参、缺失即拒绝**——与该文件 `managerSessionId` 已采用的修法同形。

**兄弟（不同机制，勿合并）**：`gap-manager-layer-no-verified-install-vector`（done）管的是安装向量（裸机能否冷启动）；本条管的是运行期路径解析与 fail-closed 守卫。

**首报来源**：另一个消费工作区（`claudecodeui`，`.quay/config.yml` 钉 quay 0.10.0）的 manager 会话。它当场遇到 `ReferenceError`（见 sister task `gap-dist-rewrite-injects-live-interpolation-into-workflow-js`），修复插值后才发现第 ② 层——即**修好崩溃反而让它变成静默指错仓库**。

**本轮续做新增（suite 阻断项，硬规则 5b）**：本任务的 fan-in 全量 suite 红在同一处——`plugin/test/adr016-screen-use-check.test.mjs` 的 walk→read race 用例（`the vanished file must be RETURNED, not swallowed`）。根因不在本任务的 delta：扫全仓的 `plugin/scripts/adr016-screen-use-check.ts` **没有排除 gitignored 的 npm-pack 暂存镜像 `packages/quay/plugin/`**（`package.sh` / `delivery-standalone-smoke.sh:51` 在 `npm pack` 期间物化它、随后 rm -rf）。镜像在场时它是 repo-root `plugin/` 的第二份拷贝：walk 同时列出 `packages/quay/plugin/scripts/*.sh` 与 `plugin/scripts/*.sh`，前者被 staging 的 rm -rf 摘掉后又被记为第二个「消失文件」⇒ 断言（期望恰好 1 条）红。同一缺陷在正常 band 判定下还会**双计** plugin/ 里的每个命中（band 只有 0..1），是真实红风险，不只是测试脆弱。修法：把镜像前缀从 walk 结果里滤掉（basename 型的 SKIP_DIRS 收不了它——会连真的 `plugin/` 一起丢）。属 AC7「既有测试绿」范围。

## Acceptance Criteria

- [x] AC1 复现固化：在**非** `/home/yale/work/quay` 的工作区形态下调用该 workflow，断言它要么显式拒绝、要么使用传入的 workspaceRoot；⛔ 不得产出关于 `/home/yale/work/quay` 的读数。当前基线：产出后者的读数（或 ReferenceError，取决于是否已修 sister task）。→ 证据：臂① 拒绝、臂② 消费工作区形态用传入 root，两臂均无 `/home/yale/work/quay` 读数（见 Evidence）。
- [x] AC2 fail-closed 修法：`ROOT` 改为由 `args.workspaceRoot` 现传。**缺失时返回独立取值**（形如 `{ evaluated: false, reason: '...' }`），⛔ **绝不落回 `/home/yale/work/quay` 硬编码默认值**——"拒绝"与"一切正常"必须可区分（硬规则 3b）。→ 见 Evidence「臂① / 返回值可区分」。
- [x] AC3 能取假（负控制，两臂都要）：① args 缺失 ⇒ 拒绝分支被走到（贴输出）；② args 提供 ⇒ 用的是传入值而非硬编码（贴输出，例如把 root 指到一个临时目录并观察到读数来自它）。→ 见 Evidence（含 PRE-FIX predicate 能红 的对照）。
- [x] AC4 意图判定落到载体：读 `plugin/skills/manager/SKILL.md:16` 的「not a quay-local artifact」声称，作出二选一并在任务证据里记下结论——(a) manager 本意可安装 ⇒ 缺口是移植（criteria/closing/sending/anchor-check 必须 ship 或改为工作区本地可解析路径）；(b) 本意即 quay-dev-only ⇒ 交付面必须显式标注，且 AC2 的守卫成为唯一正确形态。⛔ 不得两边都不选而留着矛盾。→ 判定 **(b)**，落载 `plugin/loop/manager-tick-core.md` + workflow meta（见 Evidence）。
- [x] AC5 同类扫描（硬规则 5b 的产物）：对全部 6 个 `plugin/workflows/*.js` 扫两类命中——引用 `orchestration/` 路径、硬编码宿主绝对路径（`/home/yale` 等）。把**命中数与前 3 条实际命中**贴进证据；⛔ 只修被报出来的 `manager-tick-core` ⇒ 本 AC 不满足。→ 全 6 文件已扫，读数+前 3 条见 Evidence（B 类除 manager-tick-core 外 0 实例）。
- [x] AC6 测试缺口补上：现 `plugin/test/manager-tick-core.test.mjs` 只读 `orchestration/manager-tick-core.md`（`:26`），**对 workflow `.js` 零覆盖**——这正是硬编码 ROOT 长期未被发现的原因。补一条读 `.js` 的用例覆盖 AC2/AC3。→ 新增 5 条 vm-执行真实 `.js` 的用例（见 Evidence）。
- [x] AC7 不回归：既有测试绿；`--for-task` scoped 门绿。→ `scripts/test.sh --for-task … --allow-thin` EXIT=0（见 Evidence）；全量 suite 唯一红项（adr016 staging-mirror 竞态，foreign file）已定位根因并修复（见 Evidence「AC7 — 全量 suite 红项」）。

## DoD

- [x] 真实落地：在**一个真实的消费工作区形态**（非本仓库路径）下实调该 workflow，证据显示它不再产出 `/home/yale/work/quay` 的读数——要么拒绝、要么读传入 root。⛔ fixture-only 不算（硬规则 4 推论三）。→ 生产载体是 `.js` 本身；vm-执行**真实** `.js`（非 fixture）在一个真实 `/tmp` 消费工作区形态（含 `.quay/config.yml`）下 ⇒ readings prompt `cd <consumer-ws>`，无 `/home/yale/work/quay` 读数（见 Evidence）。
- [x] AC2 的拒绝取值与「正常跑完」在返回值上可区分，并贴出两种返回的实际 JSON。→ `{evaluated:false,reason,requested}` vs `{evaluated:true,audit,读数,指令}`（见 Evidence）。
- [x] AC5 的扫描读数（命中数 + 前 3 条）已贴；未被修的命中已各自开条目或在本任务 Touches 内修掉。→ 见 Evidence（B 类全修；A 类为 quay-dev-only 合法引用，随 AC4(b) 判定收口，无同缺陷类未修命中）。
- [x] AC1–AC7 全部勾上；Touches 内文件已提交。→ 提交 `fix(manager-tick-core): fail-closed on missing args.workspaceRoot …`。

## Evidence

### AC2/AC1/AC3 — 负控制（两臂都走）

载体：`plugin/test/manager-tick-core.test.mjs` 新增 5 条用例，**vm-执行真实 `plugin/workflows/manager-tick-core.js`**（workflow-runtime globals mocked）；另用一次性脚本复现 pre-fix 行为。

**臂①（args 缺失 ⇒ 拒绝分支被走到）** — NEW workflow, `args='{}'`：
```json
{"evaluated":false,"reason":"args.workspaceRoot 缺失或不是绝对路径 —— 本 workflow 是 quay-dev-only（依赖交付面未 ship 的 orchestration/ 正本），拒绝在未知工作区产出读数。调用方须经 args.workspaceRoot 传入目标工作区【绝对路径】。⛔ 绝不落回任何硬编码宿主路径。","requested":null}
```
spawned agents: **0**（拒绝时绝不 spawn readings/audit——否则会对着未知 cwd 跑出伪读数）。

**臂②（args 提供 ⇒ 用传入值，非硬编码）** — NEW workflow, `args={"workspaceRoot":"/tmp/mgr-tick-ws-XXXX"}`：
`evaluated:true`，return keys = `evaluated,audit,读数,指令`；两份 prompt 均含该 tmp；含 `/home/yale/work/quay`？ **false**。
真实消费工作区形态（`/tmp/consumer-ws-XXXX`，含 `.quay/config.yml` + `tasks/`）：readings prompt 的 cd 行 = `cd /tmp/consumer-ws-XXXX`；全 prompt+返回含 `/home/yale/work/quay`？ **false**。

**谓语能取假（硬规则 2 零计数半边）** — 对 CODE 行（剥掉整行 `//` 注释）扫 `/home/yale/work/quay`：
- PRE-FIX bytes（`git show HEAD:plugin/workflows/manager-tick-core.js`）：**hit = true**（`:57 const ROOT = '/home/yale/work/quay'`、`:85 READ_CMD \`cd /home/yale/work/quay\``）⇒ 谓词【能】红。
- POST-FIX bytes：**hit = false**。
- PRE-FIX workflow 以 `args='{}'` vm-实跑：emitted `/home/yale/work/quay`? **true**，首条命中 = `**你的唯一任务**：在 /home/yale/work/quay 跑下面这批固定命令…` ⇒ 复现「静默指错仓库」。

**返回值可区分**（AC2/DoD）：
- 拒绝：`{"evaluated":false,"reason":"…","requested":null}`
- 正常：`{"evaluated":true,"audit":{…},"读数":{…},"指令":{…}}`

### AC4 — 意图判定（结论：(b)，本 workflow 本意即 quay-dev-only）

读 `plugin/skills/manager/SKILL.md:16`：「This skill is the **installable** crystallization … it is **not** a quay-local artifact in `orchestration/`」。该声称指向 **skill 本身**且为真（SKILL.md 确 ship 在 `plugin/skills/manager/`）；矛盾出在它**调用的 tick workflow** 依赖的 `orchestration/manager-tick-{core,criteria,closing,sending}.md` 与 `manager-anchor-check.py` 交付面未 ship（Finding ②）。
**判定 (b)**：该 workflow 本意即 quay-dev-only。理由：选 (a)「可安装」须把那四份正本 ship 进 `plugin/`——不在本任务 Touches 内，属独立的大移植，非本 gap 的修法形态。
**落载**：(i) 交付面 `plugin/loop/manager-tick-core.md`（shipped）显式标注 quay-dev-only；(ii) workflow `meta.description`/`whenToUse` 标注；(iii) AC2 守卫成为唯一正确形态（缺失 ⇒ 拒绝，绝不落回硬编码）。
**残留（观察项，非阻塞，硬规则 12）**：若要让 SKILL.md 的「可安装」对 tick workflow 也成立，需把那四份 orchestration 正本移植进 `plugin/`——独立任务。

### AC5 — 同类扫描（全部 6 个 `plugin/workflows/*.js`）

文件：drain-directives / execute-suite-fix / fan-in-execute / manager-tick-core / pool-quality-judge / run-routines。

**B 类：硬编码宿主绝对路径**（`/home/<user>/`、`/Users/`、`/data/home`；按位置判定，剥整行注释，硬规则 2）：
- PRE-FIX 命中数 **2**，全在 `manager-tick-core.js`；其余 5 文件 **0**。POST-FIX 命中数 **0**（全 6 文件）。
- 前 3 条（PRE-FIX，实际只有 2 条）：
  1. `manager-tick-core.js:14: const ROOT = '/home/yale/work/quay'`
  2. `manager-tick-core.js:22: const READ_CMD = String.raw\`cd /home/yale/work/quay`
  3. （无第三条）
- 假阳性 1 条：`fan-in-execute.js:13` 的 `/root/runId` 子串（词「root」，非宿主路径），不计。
- ⇒ **除被报出的 manager-tick-core 外无第二个同类实例**（这正是本 AC 要的读数）。

**A 类：引用 `orchestration/` 路径**（code-position）命中数：`manager-tick-core.js` 15、`fan-in-execute.js` 1，其余 4 文件 0（共 16）。
- 前 3 条：`fan-in-execute.js:410`（fan-in prompt 中的 bash 注释，说明 `orchestration/*-tick-core.md` 被 tick-core-static-check 读）、`manager-tick-core.js:4`（whenToUse 标注「依赖 …orchestration/ 正本」）、`manager-tick-core.js:19`（reason 文案）。
- 判定：均为 quay-dev-only workflow 对其 quay-dev-only 正本的合法引用；AC4(b) 已把 manager-tick-core 标注 quay-dev-only ⇒ 不构成「消费工作区静默指错仓库」缺陷类。**无同【缺陷】类的未修命中**，无需另开条目。

### AC6 — 测试缺口

`plugin/test/manager-tick-core.test.mjs` 新增 5 条 vm-执行真实 `.js` 的用例（AC2 guard / 臂① / fail-closed 变体 / 臂② / readings prompt 指向传入 root）；此前该文件只读 `orchestration/manager-tick-core.md`，对 `.js` 零覆盖。

### AC7 — scoped 门

`bash scripts/test.sh --for-task gap-manager-tick-core-hardcodes-quay-dev-root-silently-wrong-repo --allow-thin` ⇒ **EXIT=0**（绿）：含 delivery-inventory drift gate PASS、checked-in-tree writes PASS、quay-init closure-ratchet fresh PASS、本任务 10/10 测试通过；drift check 4 pairs / 4 consistent。

### AC7 — 全量 suite 红项（foreign file）的复现、根因与修法

**红项签名**（`fan-in-suite-gap-manager-tick-core-hardcodes-quay-dev-root-silently-wrong-repo~wk-prod-anchor~1791071913041-0d056b.log:15043`）：`plugin/test/adr016-screen-use-check.test.mjs` 的 walk→read race 用例，`AssertionError: the vanished file must be RETURNED, not swallowed`；`actual` 两条 `unreadable`（`packages/quay/plugin/scripts/drivable-workspace-check.sh` + `plugin/scripts/drivable-workspace-check.sh`），`expected` 一条。

**归属读数（是读数，不是判决）**：本任务 delta = `plugin/workflows/manager-tick-core.js` + `plugin/loop/manager-tick-core.md` + `plugin/test/manager-tick-core.test.mjs`，与 `adr016-screen-use-check` 的文件及其直接 import 均不相交；132 个 fan-in suite 日志中含【两测试同轮】的 6 个里只有本任务这一次红。⇒ 按 worker 约定「复现即当真」，本轮按真实缺陷处理而非当作环境抖动。

**机制（读码 + 确定性复现）**：`.gitignore:26` 钉 `packages/quay/plugin/`；`packages/quay/test/delivery-standalone-smoke.sh:51` `STAGED_PLUGIN="$ROOT/packages/quay/plugin"`（`:52` rm -rf、`:55` npm pack、`:56` rm -rf），`packages/quay/scripts/package.sh` 同款 ⇒ `npm pack` 期间工作树里真实存在一份 plugin/ 的 .sh 拷贝。而 `collectShellScripts(root, SKIP_DIRS)` 的 SKIP_DIRS 按 **basename** 剪枝（`fs-walk.ts:268`），`dist/` 有、该镜像没有 ⇒ 被扫（这正是硬规则 5b 的兄弟漏项：上一次修 walk→read ENOENT 时没扫扫描面）。

**能取假（负控制，两臂；⛔ 未用 `git stash`——repo-global 会被同仓他处偷走）**：在 worktree 暂存镜像（`mkdir -p packages/quay/plugin/scripts && cp plugin/scripts/drivable-workspace-check.sh packages/quay/plugin/scripts/`）后跑该测试文件——
- 臂①（PRE-FIX）：`node --no-warnings --experimental-strip-types --test plugin/test/adr016-screen-use-check.test.mjs` ⇒ `pass 17 / fail 1`，唯一红项与 suite 日志**逐字同签名**（`actual` 两条、`expected` 一条）⇒ 复现成立且**确定性**（不依赖调度巧合）。
- 臂②（POST-FIX，同一镜像仍在场）：⇒ `tests 18 / pass 18 / fail 0`，EXIT=0；新增的第 18 条即本修复的 pin。
- CLI 同条件：`… adr016-screen-use-check.ts --root .` ⇒ `155 file(s) scanned` / `violations: 0` / `unreadable: 0` / EXIT=0（镜像在场时仍报与干净树相同的 155，证明镜像确实没进扫描面）；`--selftest` 8 passed / 0 failed。

**修法**：`plugin/scripts/adr016-screen-use-check.ts` 新增纯函数 `isGeneratedMirrorPath(rel)`（导出，供无 fs 的纯测试 pin）并在 `scanForScreenHashViolations` 里 `collectShellScripts(...).filter((rel) => !isGeneratedMirrorPath(rel))`；路径**段**感知（`packages/quay/plugin-snapshot/` 不误伤，真 `plugin/` 不被滤）。`plugin/test/adr016-screen-use-check.test.mjs` 加一条纯函数用例覆盖两面。

## Touches

- plugin/workflows/manager-tick-core.js（`:57` ROOT + 拒绝分支 + 需同步的 prompt 文本）
- plugin/loop/manager-tick-core.md（若 AC4 判定为「显式标注 quay-dev-only」）
- plugin/test/manager-tick-core.test.mjs（AC6：新增读 `.js` 的用例）
- plugin/scripts/adr016-screen-use-check.ts（AC7 全量 suite 红项：滤掉 gitignored 的 npm-pack 暂存镜像 packages/quay/plugin/）
- plugin/test/adr016-screen-use-check.test.mjs（AC7：pin isGeneratedMirrorPath 的两面）
- tasks/gap-manager-tick-core-hardcodes-quay-dev-root-silently-wrong-repo.md（自身：勾 AC + 贴证据）