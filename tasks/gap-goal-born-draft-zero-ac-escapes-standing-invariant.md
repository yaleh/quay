---
id: gap-goal-born-draft-zero-ac-escapes-standing-invariant
title: AC-217 常设不变式在【出生路径】仍可被违反：GOAL 出生即 draft 且零 AC（写面 exit 0），而该路径正是 P6-goal
  闸自己的拒绝讯息所教——GOAL-022 零 AC 流通 ≥101 秒，烧掉一次无物可修的 gap-filing agent
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-217
---

**type:** execution

## Finding

**缺口（本回合实测，全部直接量）**：AC-217 的不变式是「`status ∈ {draft, active}` 的 GOAL 中，没有任何一条的 AC 条数 == 0」。写面在 **draft 这一半**上是敞开的——**一条新 GOAL 可以以 `draft` 出生、名下零 AC，CLI 放行（exit 0）**。

**判别对照（同一命令，只改一个 flag；2026-09-17 本回合实跑，逐字）**：

```
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts \
    write GOAL-997 --status draft --title "probe draft" --origin "probe" --body "<≥40 非空白字符>" --dry-run
{ "id": "GOAL-997", "status": "draft", "kind": "goal", … }
EXIT=0          ← 禁止态可达

$ 同一命令，--status active
goal-store: write failed: cannot activate GOAL-997: 0 AC records name it — an active GOAL must carry
at least one AC … (ACs naming GOAL-997: 0). This is a NEW record and no AC can name a goal that does
not exist yet — create GOAL-997 as draft first ('--status draft'), file its AC(s), then flip it to active.
EXIT=2          ← 闸只关了 active 那一半
```

**⚠️ 第二段读数里最关键的一句是闸自己写的**：P6-goal 拒绝 active 出生时，**逐字教调用方走 `--status draft`**——即在关上的那半边，用拒绝讯息把调用方**指进另一半边仍然开着的门**。两条读数合起来才是完整的判别子：同一谓词、同一对象、只改 `status`，结论相反。

**判据本身没坏（双向实测，用 AC-217 自己的判据原文，⛔ 不另写等价谓词）**：

- 对本仓当前 store（`list`，cwd=主检出）⇒ **EXIT=0**（GOAL-021 active / GOAL-022 draft 均有 AC）。
- 对注入了一条零 AC **draft** GOAL 的临时 root（`list --root $T`，`goals/GOAL-999-injected.md`，`status: draft`）⇒ **EXIT=1**，stderr 逐字 `active GOAL(s) with zero ACs: GOAL-999`。

⇒ 判据两个方向都取到值，且失败路径写出了成因（AC-241 查的「空因」为 0）。**要改的是写面，不是判据。**

**这次是怎么被触发的（时间线，逐条可核）**：

| 时刻（2026-09-17Z） | 事件 | 核法 |
|---|---|---|
| 00:41:26 | `GOAL-022` **以 draft 出生**、名下 **0 条 AC**；frontmatter **无 statusLog** ⇒ 从未转换过（出生即此态） | `git show 23a9e14bd --stat` / `goals/GOAL-022-*.md` |
| 00:41:26 → 00:43:07 | 这 **≥101 秒**里 GOAL-022 ∈ draft ∧ 零 AC ⇒ AC-217 判据为假 | AC-279/280/281 三个创建提交的时刻 |
| 00:42:59 | 本次 gap-filing agent 被 anchor pid 2345029 spawn（彼时 GOAL-022 的 AC 尚未落盘） | 本 agent 的父进程链 + 启动时刻 |
| 00:43:07 / :14 / :21 | AC-279 / AC-280 / AC-281 落盘 ⇒ 不变式重新为真 | `git log -1 --date=iso-strict -- goals/AC-28*.md` |

`.quay/goal-round.jsonl` 末条是 round 189 @ `00:30:43Z`，此后不再追加 ⇒ 该轮**阻塞在 spawnGapWorker**，即本轮确实卡在派发这一步。

<!-- dedup-ref --> 追溯（不是依赖声明）：上述这条链（常设 AC 判据 exit 1 ⇒ `achievedButFailing` ⇒ `computeGoalGaps` 出 `standing-violated` ⇒ spawn）在同族任务 `gap-goal-create-as-active-skips-zero-ac-gate` 的 Finding 第 3 条里已被逐字描述过。本任务是同一个缺陷形态换到 draft 半边重演，不是它的重复。

**为什么上一次修复没兜住（硬规则 5b：修好一个 ≠ 没有别的）**：

- `gap-goal-create-as-active-skips-zero-ac-gate`（done）把闸的判别子从 `activating` 换成 `goalActivating`，而 `goalActivating := nextStatus === "active" && prevStatus !== "active"`（`packages/quay/src/goal-store.ts:2038`，闸体在 `:2232`）。它的 Finding 标题写的是「出生路径无人覆盖」，**但落地的谓词只到 `active` 为止**——AC-217 的作用域是 `{draft, active}`，**draft 那一半原样留着**。
- 更要命的是 `:2238-2241` 的出生路径提示把这条通道**明文推荐**了出去（上引 EXIT=2 讯息），而 `packages/quay/src/serve-dashboard.ts:983-989` 又把这条出生序列记录成**常态**：「the store's own birth path is `create GOAL as draft → file its ACs as draft → flip the GOAL to active`, and the zero-AC activation gate's error message literally prescribes `--status draft`」。⇒ 两条机制此刻**互相矛盾**：写面说「先 draft、再补 AC」，不变式说「draft 里不许零 AC」。GOAL-022 走的正是写面这条明文路径。
- 代价是**每次走这条路径出生都会烧掉一个 gap-filing subagent（`GAP_WORKER_TIMEOUT_MS_DEFAULT = 900_000`），而它到场时无物可修**——同族任务已经记过一次这个形态（「GOAL-018 零 AC 流通 60s」），这次是同一个形态换到 draft 半边重演。
- **覆盖面比「一条测试的写法」宽**：多处夹具与**一条生产 e2e 步骤**依赖「draft GOAL 零 AC」这一态（枚举见 Requested action）。⇒ 这是**写面契约本身**的缺口，不是某个测试的偶然写法。

**判据收窄不是本任务的选项**：AC-217 的 expect 逐字写着「任何无 AC 的 GOAL 一旦进入 draft/active 即报红」，且它是人 2026-09-09 裁定②所立、已落成 `long-term: true` 的常设不变式。⇒ **关掉窗口**，⛔ 不是把窗口合法化（弱化判据、加宽限期、给 spawn 加豁免，三者都属于后者）。

**去重读数（立案前逐条核，直接量）**：`grep -rn 'goal_ac: *AC-217' tasks/*.md` ⇒ 仅 `gap-goal-create-as-active-skips-zero-ac-gate`（**done**——按立案口径它不是重复，而是「上一次修复没兜住」的证据本身）；全部 todo/ready/needs-human 任务按 `出生|draft|零 AC|AC 条数|激活` 扫 ⇒ **0 命中**。

## Requested action

**让「draft/active 且零 AC 的 GOAL」在写面上不可达**——把已有那一道 P6-goal 闸（`goal-store.ts:2232`）的谓词从「进入 `active`」扩到「进入 `{draft, active}` 的**出生路径**」，fail-closed，拒绝时**枚举**名下 AC 条数（硬规则 3）。⛔ 不新建并行机制。

**同时必须解决「自然的撰写顺序」**（否则等于把负担全转嫁给调用方，也会与 SPEC §3.2 的 `draft = 写好但未启动` 设计打架）。两种可接受落法，实现者择一并给出理由：

1. **AC 先、GOAL 后**（结构性最强）：先写 AC 记录（`goal:` 指向尚不存在的 GOAL **是允许的**——store 的完整性契约只要求该字段是非空字符串，`goal-store.ts:2041`），再写 GOAL。这样不变式在任何时刻都不会被观测到为假。
2. **一次写两条、盘上 AC 先落**（保住单动作）：同一写事务里先落 AC 文件、再落 GOAL 文件，最后一次提交。⚠️ 若两条同时落盘但**顺序不定**，会留一个毫秒级窗口——**那不叫关掉窗口**；必须定序，否则退回 (1)。

**必须一并处置的既有调用点（硬规则 5b：枚举，不是抽查）**——凡「创建 GOAL 记录且彼时名下零 AC」之处，都要给出新语义下的处置与实测读数：

- **生产 e2e**：`plugin/scripts/verify-deliver-coldstart.sh:5387`（`goal write GOAL-234 --status draft`，读数是 `goals_rendered>0`）与同文件 `:5460`；**镜像副本** `packages/quay/plugin/scripts/verify-deliver-coldstart.sh:5223/:5296`。⚠️ 动手前先查它在不在闭包棘轮的 source set 里（在的话改它会让 ratchet 变 stale）。该处注释逐字写着「补 AC 又要先有 goal，正是该闸禁止的循环」——**这个前提正是本任务要澄清的**：AC 先写并不构成循环（见落法 1），修完必须把该注释一并改对。
- **写面自己的讯息与文档**：`packages/quay/src/goal-store.ts:2238-2241`（出生路径提示，**必改**——它现在教的正是这条路）、`packages/quay/src/serve-dashboard.ts:983-989`（把零 AC draft 记成常态的那段注释）、`orchestration/SPEC-goal-mechanism-2026-09-06.md` §3.2（若择落法 1，把撰写顺序写进 SPEC）。
- **测试夹具**（创建 `status: "draft"` 且彼时零 AC 的 GOAL 的点）：`packages/quay/test/goal-store.test.mjs:265/:272/:1197`（**注意**：`:265` 断言「不传 status 默认落 draft」——种子 AC 后该断言仍成立；`:1197` 断言 `scopeSize === 0`，种子 AC 必须是 **draft**，因为 `draft` 不在 `inScopeAcsOf` 的 `{active, achieved, needs-human}` 域内，否则会改掉该用例语义）、`packages/quay/test/gap-goal-record-completeness-undefined.test.mjs:42/:44/:76`、`packages/quay/test/gap-frontmatter-slugify-drops-non-ascii.test.mjs:80`。
  ⚠️ **这些点里已经有一处同形迁移的先例**：`status: "active"` 那半边当初就是这么改的（`goal-store.test.mjs:178` 的 `seedAc(store, id)` 先落 AC 再建 GOAL）⇒ 照那个模式做，不是新发明。
- ⚠️ 另一类写法上只差「两条写序对调」的点（draft GOAL → AC → 激活，已经是两步形）：`packages/quay/test/store-commit.test.mjs:156`、`goal-store.test.mjs:149/:159/:1094/:1098`、`gap-goal-status-stale-achieved-after-new-active-criterion-filed.test.mjs:64/:147/:250`。⛔ 实现时逐条复核，不要照抄本清单的「需改/不需改」分类。

## AC

- [x] **AC1（真 CLI：禁止态已不可达）**：`node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts write GOAL-997 --status draft --title … --origin … --body "<≥40 非空白字符>" --dry-run` ⇒ **exit ≠ 0**，且 stderr 枚举「ACs naming GOAL-997: 0」。**今天的读数是 exit 0**（见 Finding 第一段），故本条今天红。
- [x] **AC2（自然顺序仍可用，三段读数）**：①`goal-store write AC-997 --goal GOAL-997 --status draft --criterion 'true' --expect … --origin …` ⇒ exit 0；②随后 `write GOAL-997 --status draft …` ⇒ exit 0；③再 `write GOAL-997 --status active` ⇒ exit 0，且 `list` 能看到该 GOAL 与它的 AC。
- [x] **AC3（窗口在盘上真的不存在，⛔ 不是「测试够快」）**：在 AC2 的**每一步之后**各跑一次 AC-217 的判据原文（`goal-store.ts list | <python>`，`--root` 指向该 store）⇒ **三次全 exit 0**；并给出**改前**同一序列的对照读数（改前第 ② 步后那一次 exit 1）。⛔ 不接受「时间窗太短所以测不到」——本条要的是**状态不可达**，不是时序侥幸。
- [x] **AC4（⛔ 判据未被弱化，双向控制）**：逐字重跑 `goals/AC-217-*.md` 的 criterion 原文（从文件读出，⛔ 不另抄谓词）：①对本仓 store ⇒ exit 0；②对注入了零 AC **active** GOAL 的临时 `--root` ⇒ exit 1；③对注入了零 AC **draft** GOAL 的临时 `--root` ⇒ exit 1。③是关键：改后判据的作用域一个字都没动。
- [x] **AC5（调用点枚举，硬规则 5b）**：把 Requested action 里列的**每一个**调用点逐条核过，贴出「命中数 + 前 3 条实际内容」；改后 `bash scripts/test.sh --for-task <本任务 id>` ⇒ exit 0，并贴出受影响测试文件单独跑绿的读数。⛔ 只修被报出来的那一个不算完成。
- [x] **AC6（负控制·实现可证伪）**：把实现改回「出生放行」（谓词退回只覆盖 `nextStatus === "active"`）⇒ AC1 必须红；贴出改前/改后两次读数对照。

## DoD

- [x] AC1–AC6 全部实跑通过，每条带命令 + 完整输出 + exit code，⛔ 不是自述结论。
- [x] 修的是**已有的那一道** P6-goal 闸（`goal-store.ts:2232`）并覆盖到 draft 出生路径，⛔ 不新建并行机制。
- [x] **在 goal driver 的真实读取面上成立**：AC-217 是常设不变式，goal-driver 每轮在**主检出**跑它的判据 ⇒ 落地后在主检出跑一次判据原文并贴读数（⛔ 不是只在任务 worktree 里绿）。
- [x] **替代收口路径（唯一合法的一种）**：若实现者得出「**draft 作用域本身**才是缺陷」的结论，⛔ **不得静默收窄 AC-217**（它是人 2026-09-09 裁定②的常设不变式、expect 逐字覆盖 draft）——把证据写进任务体、升级到人裁定，并说明为何不是写面问题。⛔ 不得以「加宽限期 / 给 spawn 加豁免」代替关窗。

## Evidence

全部为本回合实跑读数（cwd = 任务 worktree，⛔ 非自述）。AC-217 的判据一律**从 `goals/AC-217-*.md` 用 store 自己的 frontmatter parser 读出后逐字执行**（⛔ 不另抄谓词；临时 root 里放一份 `packages/quay/src` 副本并以 cwd 选根，criterion 文本一字未改）。

**AC1 — 禁止态已不可达**：
```
$ node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts \
    write GOAL-997 --status draft --title "probe draft" --origin "probe" --body "…" --dry-run
goal-store: write failed: cannot write GOAL-997 as draft: 0 AC records name it — a GOAL in {draft, active}
must carry at least one AC (… ACs naming GOAL-997: 0). Write the AC first — an AC may name a GOAL that
does not exist yet …
EXIT=2
```
同一条经 Provider ABI（`quay goal write GOAL-002 …`，装好的 CLI 面）⇒ **exit 1**，同一条讯息（枚举句逐字相同）。`--force` 不放行（exit 2）。

**AC2 — 自然顺序三段全 0**：① `write AC-997 --goal GOAL-997 --status draft --criterion 'true' --expect … --origin probe` ⇒ **exit 0**；② `write GOAL-997 --status draft --title … --body …` ⇒ **exit 0**；③ `write GOAL-997 --status active` ⇒ **exit 0**；`list` ⇒ `[('AC-997','draft'),('GOAL-997','active')]`。

**AC3 — 2×2 矩阵（写序 × 实现），每步之后跑一次判据原文**：
```
PRE-FIX  × GOAL-first ：GOAL draft exit 0 → 判据 exit 1（stderr「active GOAL(s) with zero ACs: GOAL-997」）→ AC exit 0 → 判据 exit 0   ← 改前对照：窗口存在
PRE-FIX  × AC-first   ：判据 exit 0 / 0 / 0
POST-FIX × GOAL-first ：GOAL draft exit 2（被拒）→ 判据 exit 0（禁态从未落盘）→ AC exit 0 → 判据 exit 0
POST-FIX × AC-first   ：B2/B4/B6 三次判据全 exit 0
```
⇒ 改后 GOAL-first 这条路径**连第一步都执行不了**（exit 2）：要的是**状态不可达**，不是「窗口更短」。两条 store 跑的是**同一串 shell 命令**，唯一差别是那个 `goal-store.ts`。

**AC4 — 判据未弱化（criterion 原文逐字）**：① 主检出 `/home/yale/work/quay` ⇒ **exit 0**；② 注入零 AC **active** GOAL 的临时 root ⇒ **exit 1**（stderr `active GOAL(s) with zero ACs: GOAL-999`）；③ 注入零 AC **draft** GOAL ⇒ **exit 1**（同一条 stderr）。③ 是「作用域一个字没动」那一格。

**AC5 — 调用点枚举 + 套件**：改前全仓「创建 GOAL 且此前无 AC 指名」的严格序扫描命中 **12** 条，前 3 条实际内容：
```
packages/quay/test/gap-frontmatter-slugify-drops-non-ascii.test.mjs:80  goal.write("GOAL-900", {
packages/quay/test/gap-goal-status-stale-…:64  store.write("GOAL-001", { title: "g", status: "draft", origin: "o", body: GOAL_BODY });
packages/quay/test/goal-store.test.mjs:149    s.write("GOAL-010", { title: "p10", status: "draft", origin: "o1", body: GOAL_BODY });
```
⚠️ **本任务清单没列、但同属该形态的一处生产调用点**：`plugin/scripts/meta-driver.ts` 的决策路由（`decisionGoalWriteArgv`，写的是 GOAL 而旧谓词只管 active）——闸扩到 draft 后每次决策路由都会 exit 2，故一并修（先落「退出条件 AC」再落 draft GOAL，3 条新测试钉住）。改后同一扫描剩 **5** 条，全部逐条核为良性：同行 `seedAc` 先行 1、`invalid goal id` 负控制 1、`--expect-existing` 负控制 1、`--status achieved` 2（`achieved` 不在作用域）。
受影响测试文件逐个跑绿（rc 全 0）：goal-store 72/72、store-commit 13/13、gap-goal-status-stale… 8/8、gap-goal-record-completeness… 5/5、gap-frontmatter-slugify… 4/4、goal-gate 6/6、goal-born-draft-zero-ac-gate 6/6（新）、goal-invariants-standing 19/19、meta-driver 131/131。
`bash scripts/test.sh --for-task gap-goal-born-draft-zero-ac-escapes-standing-invariant --allow-thin` ⇒ **exit 0**（ℹ tests 384 / pass 384 / fail 0），在 develop tip `3f149c29b` 上跑。
`anti-drift-touches-check --task … --worktree … --merge-target develop` ⇒ `ANTI-DRIFT OK — 13 actual file(s), all within declared Touches (15 glob(s))`。

**AC5 补（2026-09-17 第二次进入本任务 —— 上一轮的枚举漏了 4 处，由全量 fan-in 套件报出）**：上一轮的调用点扫描是**模式匹配**（找 `\.write(` / `goalStore write` 这类字面形态），**看不见藏在辅助函数后面的写法**（如 `createArgs(id, 'draft')`）。全量 suite 报出 **4 红 / 3 个文件**，全部是「以 draft 出生且彼时名下零 AC」这一**前置**的断言面：
```
plugin/test/goal-create-as-active-requires-ac.test.mjs  ② 两步路径（draft 创建 → 补 AC → active）、④「新 GOAL 以 --status draft 创建仍放行」
plugin/test/goal-activation-requires-ac.test.mjs        ③「零 AC 的 draft GOAL 仍可创建 ⇒ exit 0」
packages/quay/test/provider-abi-conformance.test.mjs    goal ABI native leg（GOAL-001 以 draft 且零 AC 写入）
```
处置（逐条**语义反转**，⛔ 不是把测试改软）：② 改为 AC-first 三步；④ 拆成「零 AC 的 draft 出生被拒（枚举 0、盘上无记录）+ 补一条点名它的 AC 后同一命令行放行」，仍是「闸不是一律拒绝创建」的取假控制；③ 改用**作用域之外**的 `--status superseded` 钉「射程没有溢出作用域」（实测 `achieved` / `retired` 亦 exit 0）；ABI 那条先经 `goalWrite` 落 `AC-001` 再落 `GOAL-001`——合法写序，且顺带把 CRITERION 种类的 round-trip 也纳进来。三个文件已补进 `## Touches`（此前 `anti-drift-touches-check` 因此报 `HARD FAIL: 3 violation(s) → out-of-declared`，正是本次 Touches 变更的负控制读数）。
**运行时枚举（取代静态扫描，硬规则 5b）**：全仓 25 个「写 GOAL 记录」的候选文件逐个**真跑**，逐文件 `# pass/# fail` 读数（全部 fail 0）：
```
packages/quay-native/test/document-cli 6/0 · gap-dashboard-goal-card-provider-backed 10/0 · gap-dashboard-status-tag-badges 8/0
gap-frontmatter-slugify-drops-non-ascii 4/0 · gap-goal-record-completeness-undefined 5/0 · gap-goal-status-stale-… 8/0
goal-gate 6/0 · goal-store 72/0 · store-commit 13/0 · gap-dashboard-goal-card-ac-denominator-… 12/0
gap-dashboard-goal-card-ac-progress-bar 3/0 · gap-webui-goal-detail-no-entity-links 8/0 · gap-webui-goal-list-sort-and-column-set 11/0
gap-webui-goal-list-tab-split-goal-ac 11/0 · gap-webui-goal-task-rollup-via-shared-summary-cache 9/0
criterion-fidelity-default-wiring 4/0 · criterion-fidelity-gate 10/0 · goal-driver 95/0 · goal-invariants-standing 19/0
goal-sufficiency-determinism 9/0 · goal-sufficiency-gate 4/0 · goal-sufficiency-not-evaluated 2/0 · meta-driver 131/0
本次修好的 3 个：goal-create-as-active-requires-ac 6/0 · goal-activation-requires-ac 5/0 · provider-abi-conformance 1 pass + 1 skip/0
新增：goal-born-draft-zero-ac-gate 6/0
```
⇒ 合计 **27 个文件、479 条（478 pass / 1 skip）**，fail 全 0。**一般形态**：写面谓词的作用域一变，**断言面**要跟着扫；而扫断言面必须**跑**，⛔ 不能 grep——间接写法（辅助函数、参数化的 id/status）在字面扫描里不可见，这正是上一轮漏掉这 4 处的原因。

**AC6 — 负控制（实现可证伪）**：备份 `goal-store.ts` → 把谓词改回 `nextStatus === "active"` → 跑新测试文件 ⇒ **6 条中 4 条红**（AC1 CLI、AC1 library、AC3 unreachable、AC6 双向），另 2 条恰是 active 半边（本就已关上）→ 还原后 `git status` 干净。⇒ 判据随实现翻转，不是恒绿。

**DoD③（主检出读取面）**：`cd /home/yale/work/quay && bash -c "<AC-217 criterion 原文>"` ⇒ **exit 0**（stderr 空）。落地后 goal-driver 每轮读的就是这个面。

**一处如实说明**：`## Touches` 里的 `packages/quay/plugin/scripts/verify-deliver-coldstart.sh` 是 **pack-time 暂存快照**（`.gitignore:26`：由 `package.sh` 在 `npm pack` 前从仓库根 `plugin/` 生成，从不入 git）。它不在任何 fresh worktree 里 ⇒ 不在本次 delta 内；我修的是它的**源**（`plugin/scripts/verify-deliver-coldstart.sh`：AC-232 写读回探针与 AC-234 兜底播种两处），下次 pack 时镜像随源同步。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/goal-store.test.mjs
- packages/quay/test/store-commit.test.mjs
- packages/quay/test/gap-goal-status-stale-achieved-after-new-active-criterion-filed.test.mjs
- packages/quay/test/gap-goal-record-completeness-undefined.test.mjs
- packages/quay/test/gap-frontmatter-slugify-drops-non-ascii.test.mjs
- packages/quay/test/goal-born-draft-zero-ac-gate.test.mjs (new)
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/meta-driver.ts
- plugin/test/meta-driver.test.mjs
- plugin/test/goal-invariants-standing.test.mjs
- plugin/test/goal-create-as-active-requires-ac.test.mjs
- plugin/test/goal-activation-requires-ac.test.mjs
- packages/quay/test/provider-abi-conformance.test.mjs
- packages/quay/plugin/scripts/verify-deliver-coldstart.sh
- orchestration/SPEC-goal-mechanism-2026-09-06.md
- tasks/gap-goal-born-draft-zero-ac-escapes-standing-invariant.md（自身）
