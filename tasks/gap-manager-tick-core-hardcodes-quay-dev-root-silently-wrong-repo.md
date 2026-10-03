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

## Acceptance Criteria

- [ ] AC1 复现固化：在**非** `/home/yale/work/quay` 的工作区形态下调用该 workflow，断言它要么显式拒绝、要么使用传入的 workspaceRoot；⛔ 不得产出关于 `/home/yale/work/quay` 的读数。当前基线：产出后者的读数（或 ReferenceError，取决于是否已修 sister task）。
- [ ] AC2 fail-closed 修法：`ROOT` 改为由 `args.workspaceRoot` 现传。**缺失时返回独立取值**（形如 `{ evaluated: false, reason: '...' }`），⛔ **绝不落回 `/home/yale/work/quay` 硬编码默认值**——"拒绝"与"一切正常"必须可区分（硬规则 3b）。
- [ ] AC3 能取假（负控制，两臂都要）：① args 缺失 ⇒ 拒绝分支被走到（贴输出）；② args 提供 ⇒ 用的是传入值而非硬编码（贴输出，例如把 root 指到一个临时目录并观察到读数来自它）。
- [ ] AC4 意图判定落到载体：读 `plugin/skills/manager/SKILL.md:16` 的「not a quay-local artifact」声称，作出二选一并在任务证据里记下结论——(a) manager 本意可安装 ⇒ 缺口是移植（criteria/closing/sending/anchor-check 必须 ship 或改为工作区本地可解析路径）；(b) 本意即 quay-dev-only ⇒ 交付面必须显式标注，且 AC2 的守卫成为唯一正确形态。⛔ 不得两边都不选而留着矛盾。
- [ ] AC5 同类扫描（硬规则 5b 的产物）：对全部 6 个 `plugin/workflows/*.js` 扫两类命中——引用 `orchestration/` 路径、硬编码宿主绝对路径（`/home/yale` 等）。把**命中数与前 3 条实际命中**贴进证据；⛔ 只修被报出来的 `manager-tick-core` ⇒ 本 AC 不满足。
- [ ] AC6 测试缺口补上：现 `plugin/test/manager-tick-core.test.mjs` 只读 `orchestration/manager-tick-core.md`（`:26`），**对 workflow `.js` 零覆盖**——这正是硬编码 ROOT 长期未被发现的原因。补一条读 `.js` 的用例覆盖 AC2/AC3。
- [ ] AC7 不回归：既有测试绿；`--for-task` scoped 门绿。

## DoD

- [ ] 真实落地：在**一个真实的消费工作区形态**（非本仓库路径）下实调该 workflow，证据显示它不再产出 `/home/yale/work/quay` 的读数——要么拒绝、要么读传入 root。⛔ fixture-only 不算（硬规则 4 推论三）。
- [ ] AC2 的拒绝取值与「正常跑完」在返回值上可区分，并贴出两种返回的实际 JSON。
- [ ] AC5 的扫描读数（命中数 + 前 3 条）已贴；未被修的命中已各自开条目或在本任务 Touches 内修掉。
- [ ] AC1–AC7 全部勾上；Touches 内文件已提交。

## Touches

- plugin/workflows/manager-tick-core.js（`:57` ROOT + 拒绝分支 + 需同步的 prompt 文本）
- plugin/loop/manager-tick-core.md（若 AC4 判定为「显式标注 quay-dev-only」）
- plugin/test/manager-tick-core.test.mjs（AC6：新增读 `.js` 的用例）
- tasks/gap-manager-tick-core-hardcodes-quay-dev-root-silently-wrong-repo.md（自身：勾 AC + 贴证据）