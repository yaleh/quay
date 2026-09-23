---
id: gap-ac255-anchor-kind-set-silent-loss
title: GOAL-017/AC-255：anchor 的 kind 集合静默削到 4 —— quality/meta 心跳停摆 264min，判据逐字
  exit 1（收敛已落地，丢的是能力半边）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-255
---
## Proposal

**本轮实测（2026-09-23T14:0xZ，取假形态，⛔ 非沿用台账尾巴）**：AC-255 的 criterion 逐字 **exit 1**：

```
AC-255: converged but these kinds have no fresh round heartbeat within 60min: quality:264min,meta:264min => convergence lost capability (SPEC 6.10)
exit=1
```

**两半读数（关键：这次红的【不是】进程半边 —— 收敛这次是真的落地了）**

- **pid 半边已满足**：匹配 criterion 两个 glob 的 pid 文件 = **4**（`goal/outer/promotion/worker-driver.pid`），逐个读内容 **全部 = 985744** ⇒ 去重存活 pid = **1** ≤ 2。`.quay/anchor.json` = `{"pid":985744,...,"host":"anchor","kinds":["promotion","worker","outer","goal"]}`，`ps` 确认 985744 = `driver-anchor.ts __anchor --root /data/home/yale/work/quay`。⇒ 12 → 1 的收敛**由已落地代码产出**（`plugin/scripts/driver-anchor.ts` 在 develop 上）。**上一轮立项时的「12 个 legacy 进程」形态已不复存在。**
- **心跳半边红**：`quality-round.jsonl` 与 `meta-driver-round.jsonl` 的末条 ts 都是 `2026-09-23T09:36:10.270Z`（年龄 **264 min**）；promotion 0min / worker 1min / outer 0min / goal 4min 新鲜。两个载体都存在且可读 ⇒ 退出码是 **1 而非 3**（⛔ 不是仪器问题）。
- 六个 kind 的载体名与 criterion 一致（meta 读 `meta-driver-round.jsonl`，2026-09-13 那次审计已把原版的 `meta-round.jsonl` 钉正）⇒ **没有** `meta:no-carrier`。

**机制（plan 阶段要钉死的那一条）：anchor 跑哪些 kind，唯一由 `.quay/anchor-desired.json` 决定，而没有任何一条路径会加回一个 kind。**

- `driver-anchor.ts:407` 的启动集合 = `opts.kinds ?? readDesired(root)?.kinds ?? [...KNOWN_KINDS]`；而 `spawnAnchor`（`driver-runtime.ts:1138`）**不传 `--kinds`** ⇒ 每次自刷新重启都退化成「读期望态」。实测旁证：`anchor.log` 记 `2026-09-23T13:43:44Z anchor: host pid=985744 … kinds=[promotion]` —— 起来时**只有 1 个 kind**，之后由期望态补到 4。
- 该文件只有两个写侧：`updateDesired`（`driver-runtime.ts:917`；`start --kind X` 并集加 / `stop --kind X` 过滤删）与冷启动（仅在文件为 null 时写一次）。**⇒ 没有任何一条判定要求期望态覆盖六个 kind，也没有任何一条路径重新加回一个 kind。**
- 后果正是 SPEC §6.10 记的「合并【引入的】新风险」：一次 `stop --kind X`（或一次部分写）就把 X 永久移出集合，之后 anchor 照常以**「一个健康进程」**的样子跑剩余 kind，`ps` 完全看不出少了一个 —— 外部只看得见「进程活着」，看不见「六个循环里有两个没在转」（§6.7 禁止的那种折叠）。

**旁证（`anchor.log` 逐行，⛔ 非印象）：期望态里的 kind 集合一直在变**

```
2026-09-23T07:28:57Z anchor: host pid=1776653 … kinds=[goal,worker,outer,quality,meta,promotion]   ← 6
2026-09-23T08:40:23Z anchor: host pid=3427769 … kinds=[goal,quality,meta,promotion]                ← 少了 worker、outer
2026-09-23T13:43:44Z anchor: host pid=985744  … kinds=[promotion]                                  ← 只剩 1，后由期望态补到 4
```

`quality`/`meta` 的末条 round 记录（`pid:3427769`，`halted:false`，两者 ts 同为 `2026-09-23T09:36:10.270Z`）与该 anchor 进程**同刻**停止 ⇒ 那次是**正常收尾**（非崩溃）。`.quay/quality-control.json` / `.quay/meta-control.json` **不存在** ⇒ **不是 halt**，纯粹是脱离了期望态。⇒ 同一天内**至少 2 次**观测到「kind 集合少于六个且无人加回」，这就是本任务要加不变式的依据（硬规则 12：发生率已给出）。

**AI 关联发现（同一次读数发现，⛔ 本任务不修，须另立）**：`meta-driver-round.jsonl` 末几条含 `{"name":"meta-review","value":null,"state":"failed","reason":"routine threw: snapshotTrackedChanges is not defined"}` —— meta 的 routine 抛 `ReferenceError`。登记为关联项，不影响本任务判据（criterion 只读末条 ts，不读 facts）。

**⛔ 本轮未钉死的那一格（诚实边界，硬规则 4 推论四：能解释不等于已检验）**：我**没有**取到「是谁在 09:36 把 quality/meta 移出期望态」的直接记录 —— `quay driver start|stop` 无审计日志，那次收尾是 grace 停而非错。⇒ Plan 第 0 步必须先把它钉死，**因为两种成因的正确修法相反**：若这是**人有意的停机**，正确解是走 `superseded` / `long-term` 处置判据（需人授权），⛔ **不是**加一个「自动拉起」的闸；若这是**无意的静默丢失**，才该加不变式。⛔ 不得跳过第 0 步直接实现。

**为什么早先的修复没有 hold（必须说清，因为三条 done 任务都声明了本 AC）**

三件 `done` 的任务声明了 `goal_ac: AC-255`：`gap-ac255-driver-internalization-pid-le2-six-kinds-fresh`（收敛本体）、`gap-driver-status-misreports-anchor-hosted-kind-as-down`、`gap-driver-restart-unreliable-legacy-to-anchor-migration`。

- 第一件的 **AC1/AC2/AC8 是在 `fan-in-ac-completion-gate.ts` 的 `pass-external` 分支上放行**的（当时剩余项被判定为「需人授权的生产迁移」），而生产迁移最终落地时**只带回了 4 个 kind**；它的 **AC4「六心跳连续新鲜」是在 2026-09-13 那次【手工起动 anchor】的窗口上勾的**，而那个窗口的取证地位**已被它自己推翻**（`anchor.log` 第 1 行显示内核路径取自 task worktree，`git show develop:plugin/scripts/driver-anchor.ts` 当时不存在 ⇒ 关掉「手工起动」这个 seam 则 criterion exit 1）。
- ⇒ **结论：收敛半边被反复验证且最终真的落地了；「能力不丢」半边只在一次后来被推翻的手工窗口上验过一次，落地形态本身就只有 4 个 kind。** 这次红的正是从没被生产验过的那一半。本任务因此**不能**再走 `pass-external`：AC 的判据必须在**主检出常驻形态**上取到（硬规则 4 推论三）。

<!-- dedup-ref -->
**关联（仅追溯，不构成本任务的阻塞声明）**：`gap-ac255-driver-internalization-pid-le2-six-kinds-fresh`（done，收敛本体与 `driver-anchor.ts` 的实现落点）、`gap-driver-status-misreports-anchor-hosted-kind-as-down`（done，`server status` 的承载关系判据）、`gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation`（done，anchor 自刷新整进程重启的路径 —— 本任务的重启形态读数应与它对齐）。全仓 `grep -rn '^goal_ac: AC-255' tasks/*.md` = **3 条且三条全部 done**（本轮实测）⇒ 无在飞重复；按「done 不是重复、是上一次没 hold 的证据」立案。

## Plan

1. **第 0 步 · 先定性（⛔ 顺序不可颠倒，这一步的产出决定后面做不做）**：钉死 `quality`/`meta` 离开期望态的那次动作是**有意停机**还是**静默丢失**。取证面（硬规则 12b：先查历史，⛔ 不是等下一轮）：① `git log` 与任务/指令存量里有无「停 quality/meta kind」的裁定；② `.quay/anchor.log` 在 2026-09-23T08:40–13:44 之间的**全部**行；③ 会话历史用 **`meta-cc` MCP**（⛔ 不手搓 `grep`/`python` 解析 `*.jsonl`）。**判据（可机械给出）**：给出该动作的具体载体（一条裁定 / 一条日志 / 一条记录）**或**明确写出「上述三面取证穷尽且无此类记录」。若定性为**有意停机** ⇒ **停在第 0 步**，把结论与载体写进结果段，并把「修订 AC-255 判据」作为需人授权的后续项登记（⛔ 不实现下面的闸）。

2. **给「静默脱离期望态」一个可与「正常」区分的独立取值（硬规则 3b）**：`driver-runtime.ts` 的期望态语义 + `driver-anchor.ts` 的 reconcile 每趟，必须能报出「本 kind 既不在 `desired.kinds` 里、又**没有**显式停机记录」这一态，取值形如 `not-declared` / `absent-without-stop-record`，⛔ **不得**与「正在跑」「显式停过」共用输出。落在 `.quay/anchor.json` 与 `quay server status --json`（§6.10 每服务读数，`packages/quay/src/cli/server.ts`）两处回读面。**⛔ 这不是「一律自动拉满六个 kind」** —— 见 AC5。

3. **显式停机必须仍可表达（否则第 2 步会退化成「永远拉满」）**：`quay driver stop --kind X` 的意图要落成**可区分的记录**（而不是仅仅消失于集合），使「操作员有意停机」与「静默丢失」在读数上分得开。

4. **生产恢复（additive，⛔ 不 stop / ⛔ 不 restart 任何在跑的 kind）**：把 `quality` 与 `meta` 加回生产 anchor 的期望态（`quay driver start --kind quality` / `--kind meta`：该路径对 anchor 已活着的情形是**幂等加集**，`driver-runtime.ts:2372` `updateDesired` 并集加；它**不杀任何在飞子进程**，§6.9 不变式 2/3）。⛔ **本任务禁止** `quay driver stop|restart`（上一轮已确立：那会打断生产 12→1 收敛后的在飞工作）。执行前后各取一次 `.quay/anchor.json` 的 `kinds` 对照并贴进结果段。
   - ⚠️ **边界说明（⛔ 不要把这一步伪装成不需要授权）**：driver 生命周期（start/stop/restart）是 **manager/人**的常设授权面。「加回两个缺失的 kind」是 **additive**（不中断生产），与上一轮被明确挡下的「stop 在跑的 kind」不是同一个动作，故本任务允许执行；若执行者判断连 additive 也需授权，**必须显式记录该判断并升级**，⛔ 不得静默跳过而把任务标成完成。

5. **负控制 + 测试**（判据的两半都要能取假）：隔离 root / 临时 workspace 上，① 删掉期望态里一个 kind 且不留停机记录 ⇒ 第 2 步的独立取值出现；② 补回 ⇒ 消失；③ `stop --kind X` ⇒ X 保持停止且读数显示「显式停过」，⛔ 不被 reconcile 自动拉起；④ `start --kind X` ⇒ 恢复。四条读数都贴进结果段。新增/扩展的测试文件覆盖这四个读数。

6. **零回退**：⛔ 不改 driver 的判定语义（派发/判停/归因逻辑不动）；`quay driver <verb> --kind X` 六动词 × 六 kind 仍在；`stop --kind X` 仍不杀该 kind 在飞的 worker 子进程（§6.9 不变式 3）；既有 driver 测试全绿。

## Touches

- `plugin/scripts/driver-runtime.ts`（期望态语义：`readDesired`/`updateDesired` 的停机记录与「未声明」独立取值）
- `plugin/scripts/driver-anchor.ts`（reconcile 每趟报出「未声明且无停机记录」的 kind）
- `packages/quay/src/cli/server.ts`（§6.10 `server status --json` 的 `drivers[]` 每服务读数）
- `plugin/test/driver-anchor-declaration.test.mjs`（AC4/AC5 四个读数的覆盖）
- `plugin/test/driver-anchor.test.mjs`（收敛/判据半边：本任务对 driver-runtime 的改动不得破坏它）
- `tasks/gap-ac255-anchor-kind-set-silent-loss.md`（自身文件：勾 AC + 贴实跑证据）

## AC

- [x] AC1: **第 0 步定性有结论且附载体证据**：给出 `quality`/`meta` 离开期望态的那次动作的具体载体（裁定 / 日志行 / 记录），**或**明确写出「`git log` + 任务存量 + `anchor.log` 08:40–13:44 全段 + `meta-cc` 会话历史 四面取证穷尽且无此类记录」并附四面各自的查询命令与命中数。⛔ 只写「大概是有人停的」不满足。若定性为「有意停机」⇒ 后续 AC 不适用，改按 Plan 第 1 步登记需人授权的判据修订。**⇒ 定性为「静默丢失（无有意停机的载体）」，四面取证穷尽且命中数为 0/0/0/0（详见 Evidence §AC1）。**
- [ ] AC2: **生产形态六 kind 全新鲜**：`.quay/anchor.json` 的 `kinds` 含**六个** kind；六个 `.quay/<kind>-round.jsonl`（meta 用 `meta-driver-round.jsonl`）**各自**末条记录的 `ts` 年龄 < 60min（读数取**内容**，⛔ 不以 mtime / 「进程在」推导）；同时匹配 criterion 两个 glob 的 pid 文件去重存活数 ≤ 2。读数时刻须**晚于**本任务实现落地时刻。
- [ ] AC3: **criterion 逐字 exit 0**：从 `goals/AC-255-进程收敛且能力不丢-driver-pid-文件-2-且六个-kind-的-round-心跳都新鲜-spec-阶段-c-6.md` 抽出 `criterion:` 原样交 bash（`python3 - <<'P' … P` 片段**不剥壳**）⇒ `EXIT=0`；并附跑之前的对照读数（`EXIT=1`，stderr 逐字含 `quality:` 与 `meta:` 两个 kind 名）。两半读数取自**同一次**运行。
- [x] AC4: **「静默脱离期望态」有独立取值且可取假（硬规则 3b）**：某 kind 既不在期望态、又无显式停机记录时，`anchor.json` / `server status --json` 报出一个**与「正常」和「显式停过」都不共用**的取值（如 `not-declared`）。**负控制**（隔离 root，⛔ 不碰生产）：删该 kind 且不留停机记录 ⇒ 该取值出现；补回 ⇒ 消失。两个读数都贴出。**⇒ `not-declared` + 双向负控制 + `not-evaluated` 第三态，见 Evidence §AC4。**
- [x] AC5: **显式停机仍可表达（AC4 的反向控制，⛔ 缺此条则 AC4 退化成「永远拉满六个」）**：`quay driver stop --kind X` 后 X **保持停止**，读数明确显示「显式停过」且**不**被 reconcile 自动拉起；`start --kind X` ⇒ 恢复。三个读数都贴出。隔离 root 执行。**⇒ `stopped-explicitly` + 14 趟 reconcile 不自动拉起 + `start` 恢复，见 Evidence §AC5。**
- [ ] AC6: **测试与零回退**：覆盖 AC4/AC5 四个读数的新增/扩展测试 `node --test <file>` 全绿（贴 pass/fail 计数）；既有 driver 测试至少 `plugin/test/driver-anchor.test.mjs`、`plugin/test/driver-runtime.test.mjs` 全绿；`quay driver --help` 六动词 × 六 kind 仍在（贴输出）。⛔ 未改 driver 判定语义。

## DoD

**真 landed 的判据是主检出的常驻形态上「六 kind 都在转」且判据逐字 exit 0 —— 不是「有测试绿了」。** 具体：`.quay/anchor.json` 的 `kinds` 覆盖六个 kind；六个 round 载体末条 `ts` 各自 <60min（内容读数）；AC-255 criterion 在主检出生产形态上逐字 `EXIT=0`，读数时刻晚于实现落地时刻；且「kind 静默脱离期望态」这一态**在机制上可被区分地报出**（不是靠人去数六个文件），并有 AC4/AC5 的负控制双向读数在场。

**⛔ 不接受的替代物**：只在测试夹具里起六 kind 就宣称达成；把 criterion 改成读更少的 kind（或改判据绕过本缺陷）；用「anchor 进程活着」推导六个循环在转；把「自动拉起」与「显式停机」混为一谈（那样 AC5 必红）；再用 `pass-external` 放行 —— 上一轮正是这么放行的，而生产形态当时就只有 4 个 kind。

**替代路径（若 Plan 第 0 步定性为「有意停机」）**：⛔ 不得实现第 2–4 步；须把定性结论与载体证据写进结果段，并把 AC-255 的处置（`superseded` 附书面理由 / `long-term: true`）作为**需人授权**的后续项登记。⛔ 不得把「未定性」当成「已达标」。

## Evidence

**实现提交**：`885ce5030`（worktree `quay-worktrees/gap-ac255-anchor-kind-set-silent-loss`，分支 `task/gap-ac255-anchor-kind-set-silent-loss`）。
落点：`driver-runtime.ts`（`.quay/anchor-kind-stops.json` 停机记录 + `kindDeclaration` 四态）、`driver-anchor.ts`（`anchor.json` 每趟发布 `declaration` + 集合变化时一行日志）、`cli/server.ts`（§6.10 `drivers[].declaration`）。**reconcile 的行为一行未改**（仍只起 `desired.kinds`）——本任务加的是**读数**，不是「自动拉满」。

### §AC1 · 第 0 步定性：**静默丢失**（四面取证穷尽，无「有意停机」的载体）

| 取证面 | 查询 | 命中 |
|---|---|---|
| ① `git log` | `git log --all --oneline --grep=quality --grep=meta -i --since=2026-09-15 \| grep -ci 'stop\|halt\|retire\|kind'` | **0** |
| ② 任务/指令存量 | `grep -rl 'stop --kind quality\|stop --kind meta\|停掉 quality\|停掉 meta\|stop the quality' tasks/ docs/ orchestration/` | **1**，且该 1 条是 `gap-ac255-driver-internalization-pid-le2-six-kinds-fresh.md:136` 里**隔离 temp workspace 的负控制记录**，⛔ 不是生产停机裁定 |
| ③ `anchor.log` 08:40–13:44 全段 | `awk 'NR>=11033 && NR<=11177' .quay/anchor.log \| grep -c '^2026-09-23T'` | **0**（该窗口内**没有任何 anchor 自己的行**；且 `grep -c '2026-09-23.*kind=\(quality\|meta\) loop stopped'` = **0** —— 两个 kind 的循环**没有**经过 anchor 的停机路径收尾） |
| ④ `meta-cc` / 会话历史 | `meta-cc query_session_content`（0 命中）+ 三层目录 `grep -rl 'driver stop --kind quality' ~/.claude/projects/-data-home-yale-work-quay/` | **2**，两个文件都是**分析本缺陷的会话**（`94ae5e4b` 是本轮 worker 自己，`768690db` 是立项那次分析），⛔ 无一条是操作员执行的停机动作 |

**⇒ 定性：静默丢失。** 附带结论：`.quay/quality-control.json` / `.quay/meta-control.json` **不存在** ⇒ 不是 halt；`updatedBy` 会被下一次 `start` 覆盖 ⇒ **即使**那次是有意停机，机制上也**留不下**可区分的记录 —— 这正是本任务要修的那条（Plan 第 3 步）。因此**未**走 DoD 的「替代路径」，实现第 2–4 步。

### §AC4 · 「静默脱离期望态」有独立取值 + 双向负控制（隔离 root）

四态定义（`kindDeclaration`）：`declared` / `stopped-explicitly` / `not-declared` / `not-evaluated`。
`plugin/test/driver-anchor-declaration.test.mjs` AC4 用例（**真起 anchor 进程**，⛔ 不是纯函数调用）：

```
✔ AC4 — 某个 kind 既不在期望态、又无停机记录 ⇒ not-declared（⛔ 不与 declared/stopped-explicitly 同形）；补回 ⇒ 消失
```
- 基线：六 kind 全 `declared`（`.quay/anchor.json` 的 `declaration` map）
- ① 直接改写期望态删掉 quality+meta、**不留**停机记录 ⇒ 两者 `not-declared`；**其余四个仍 `declared`**（该取值能定位到「谁丢了」）；`readKindStops(root)` = `{}`（确认走的是「无记录」那一支）
- ② 补回 ⇒ `not-declared` 消失
- 第三态负控制：停机记录载体写成坏 JSON ⇒ `not-evaluated`（⛔ **不**退化成 `not-declared`，硬规则 3b：读不懂 ≠ 查过没有）

### §AC5 · 显式停机仍可表达（AC4 的反向控制）

```
✔ AC5 — stop --kind X ⇒ X 保持停止、读数显示 stopped-explicitly、不被 reconcile 自动拉起；start --kind X ⇒ 恢复
```
- `stop --kind quality` exit 0 ⇒ `readKindStops().quality.by == "quay-driver-stop"`，读数 `stopped-explicitly`
- **不自动拉起**：连测 **12 次 / 1.44s ≈ 14 趟 reconcile**（每趟 100ms），每趟都断言 `anchor.json.kinds` **不含** quality；且它的 round 载体记录数**不再推进**（直接量）
- `start --kind quality` ⇒ 停机记录清空、读数回 `declared`、循环回到 `kinds` 且载体重新推进

### §AC6 · 测试与零回退

```
✔ AC4/AC5 三用例              3 pass / 0 fail   (node --test plugin/test/driver-anchor-declaration.test.mjs)
✔ plugin/test/driver-anchor.test.mjs + driver-anchor-stop/takeover   13 pass / 0 fail
✔ driver-status-carrier-path / driver-cli / driver-config / driver-shared / driver-runtime-control-plane   35 pass / 0 fail
✔ driver-runtime-s01..s12 + bundle + bundle-fresh + third-party-fixture   59 pass / 0 fail
```
`quay driver --help`（六动词 × 六 kind 仍在，逐字）：
`quay driver <start|stop|drain|resume|status|restart|log> --kind <promotion|worker|outer|quality|meta|goal> [--root <path>] [flags]`
⛔ 未改 driver 判定语义：`plugin/scripts/driver-runtime.ts` 的派发/判停/归因路径零改动；`stopKindViaAnchor` 的「不杀在飞子进程」分支未触碰。
