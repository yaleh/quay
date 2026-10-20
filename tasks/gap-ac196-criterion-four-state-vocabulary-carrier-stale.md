---
id: gap-ac196-criterion-four-state-vocabulary-carrier-stale
title: AC-196 四态返回判据锚在重构前的 src-root 载体上（实现已下沉 core/store-commit.ts）—— 重锚到
  canonical 实现模块 + 保留 import 面转发断言
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-196
---
## Proposal

**缺口（立案当轮直接量，2026-10-20，cwd = 主检出 `/data/home/yale/work/quay`）**

判据 `goals/AC-196-not-in-git-unchanged-boolean-0.md` 逐字执行 ⇒ exit 1、stderr 逐字：

```
AC-196 fail - packages/quay/src/store-commit.ts 词表缺 not-in-git
```

逐条读数：

| 谓词 | 读数 |
|---|---|
| `test -f packages/quay/src/store-commit.ts` | **通过** — 文件在，**705 字节**，内容只有一段注释 + `export * from "./core/store-commit.ts";` |
| 该文件含 `not-in-git` | **0** |
| 该文件含 `unchanged` | **0** |
| 旧 boolean 函数 `commitGoalFileAfterWrite`/`commitMetaFileAfterWrite` 在 `packages/quay/src` 下 | **0**（递归 grep 也覆盖 `core/`） |

**保证本身没有丢，丢的是判据的载体。** `packages/quay/src/core/store-commit.ts`（12572 字节）逐行：

```
32: export type CommitOutcome = "committed" | "unchanged" | "not-in-git" | "failed";
153: export function commitStoreWrite(opts: CommitStoreWriteOptions): CommitStoreWriteResult {
156:   if (!root) return { outcome: "not-in-git", propagated: false };
158:   if (gitOut(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
159:     return { outcome: "not-in-git", propagated: false };
174:   return { outcome: "unchanged", propagated: false };
```

⇒ 四态齐备（硬规则 3b 要求的「未评估」独立取值仍在），旧 boolean 函数 = 0。

**成因是一次方向相反的已落地重构，不是回归。** `35dc5da93`（`refactor(core): sink the gate substrate into src/core to break the "<empty>"<->gate directory SCC`，2026-10-18 20:29:59 +0800，已是 `develop` 祖先）把实现**下沉**到 `packages/quay/src/core/`，src-root 路径保留为纯转发再导出（shim 顶部注释明写「⛔ Do not re-add implementation here」——回填实现会把 src root 重新拉进它刚拆掉的 gate 环路）。判据把两个状态名 grep 在**旧位置**上，文件一改形态就结构性失效。

**台账证据（同一 criterionHash，树变了）**：

| 时刻 (UTC) | verdict | criterionHash | treeSha | 对应提交 |
|---|---|---|---|---|
| 2026-10-20T01:38:44Z | **pass** | `0d68374d922ba1ef` | `bbcbd7bf…` | `293bba31e`（2026-10-20 09:26:53 +0800） |
| 2026-10-20T05:19:29Z | fail | `0d68374d922ba1ef` | `79faf890…` | `2304d9c8a`（2026-10-20 12:12:37 +0800，机械 fan-in） |

判据文本从未变过（同一 hash）⇒ 翻转纯属树变了。**「上一次修复没守住」在这里不准确，须如实写**：`gap-store-commit-unification-ac196-four-state-return`（`goal_ac: AC-196`，status done）当时确实把四态原语建好、旧 boolean 函数删到 0，并在 2026-09-08 起长期为绿；那份修复没有被回退，今天还更强（原语下沉后仍只有一处实现 + 一个转发面）。这是硬规则 4c 的**撰写侧**失败：判据点名的量在「产生处 → 读取处」之间的那层重构里被搬走了。

<!-- dedup-ref -->
**去重与粒度**：本 AC 唯一在飞/已落任务 `gap-store-commit-unification-ac196-four-state-return` 已 `done`（其完成正是上表 09:26 那次 pass 的来源）；同 goal 的姊妹判据 AC-197 已由 `gap-ac197-criterion-commitstorewrite-identifier-pin-stale` 走完同一修法（2026-10-20T03:45:34Z 的 `goal-amend` 事件，criterionHash `f09d654ea2f3e6cf`，其 `prim=` 已是 `packages/quay/src/core/store-commit.ts`）。沿用该先例：**本次不是新机制、不是回填实现，只重锚判据**。合并候选检查（`task-granularity-advice.ts`，三条 draft Touches）返回 `peers: []`、`mentions: []` ⇒ **separate / none found**。

**同族扫描（硬规则 5b 产物）**：`grep -l 'packages/quay/src/store-commit\.ts' goals/*.md` 命中 **2** 条：`AC-196` 与 `AC-198`（AC-197 已重锚到 core 路径）。AC-198 的判据同样要求该旧路径含 `rev-parse`（实测旧路径 0、core 路径 7），其最后一条台账 pass 是 2026-10-20T01:44:51Z（早于重构入主检出）⇒ **下一次 sweep 会以同一成因翻红**。本任务只覆盖 AC-196（`goal_ac` 是单标量，一任务一 AC）；AC-198 由 driver 独立立案，此处只留读数，不回填、不合并。

## Plan

1. **重取红基线**（⛔ 不假定仍等于立案值）：逐字跑判据贴 exit 1 与 stderr；同时贴 `wc -c` 两个文件、`grep -n 'export type CommitOutcome'` 的联合声明行、旧 boolean 函数计数 0。
2. **写新谓词（结构，按位置判定）**：承载体用 marker 块 `# >>> four-state-vocabulary` … `# <<< four-state-vocabulary`，块首注明「逐字由 `packages/quay/test/ac196-criterion-four-state-vocabulary.test.mjs` 运行」。四条合取：
   ① import 面 `packages/quay/src/store-commit.ts` 仍存在且转发到 `core/store-commit.ts`；
   ② canonical 实现 `packages/quay/src/core/store-commit.ts` 存在；
   ③ 从 `export type CommitOutcome =` **声明块**（awk 截到 `;` 为止）逐字取出，四态 `committed` / `unchanged` / `not-in-git` / `failed` 逐一在场（去掉引号后判名，⛔ 不靠整文件 grep、⛔ 注释里提到不算）；
   ④ `packages/quay/src` 递归下 `function commitGoalFileAfterWrite` / `function commitMetaFileAfterWrite` 计数 = 0。
   每条失败给具名 `CAUSE=`；`echo … >&2` 与 `exit 1` **必须同行**（`plugin/scripts/criterion-failure-attribution-check.ts` 逐行判定）。
3. **经 ABI 落库**：`node packages/quay/bin/quay.js goal write AC-196 --criterion "$(cat <新 criterion 文件>)" --expect "<新读数>" --origin "<原 origin + 为什么要改>"`。⛔ 不得 `Edit` goal 文件。读回逐字节比对（`goal show AC-196 --json` 的 criterion 与源文件全等，`EQUAL: true`）——YAML 折行标量损坏过历史先例。
4. **配套夹具** `packages/quay/test/ac196-criterion-four-state-vocabulary.test.mjs`（`// @test-group product`，`node:test`）：按 marker 从 `goals/AC-196-*.md` **逐字抽取**谓词块（单一正本关系，⛔ 不是逻辑副本），在 `git init` 过的临时 root 里跑正/负两向。
5. **三个负控制（成因两两不同形）**，全部只在临时 root/副本上做，⛔ 不动生产文件：
   ① 从临时副本的联合声明里删掉 `not-in-git` ⇒ exit 1 且 `CAUSE=state-missing:not-in-git`；
   ② 临时副本里把 `export function commitStoreWrite` 改成不导出 / 或让 shim 不转发 ⇒ `CAUSE=import-surface-not-forwarding`；
   ③ 临时副本里恢复一个旧 boolean 函数 `function commitMetaFileAfterWrite` ⇒ `CAUSE=legacy-boolean-commit-functions`（与 ①② 不同形：缺态 / 断面 / 旧路径复活）。
6. **正控制**：未突变 root ⇒ `quay goal gate AC-196` **exit 0**，逐字贴出。
7. **落账**：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-196` 的末条为 `verdict:"pass"` 且 `payload.criterionHash` ≠ `0d68374d922ba1ef`（贴修前 / 修后两行）。
8. **不回归**：`bash scripts/test.sh --for-task gap-ac196-criterion-four-state-vocabulary-carrier-stale` 退出码 0。

## Acceptance Criteria

- [ ] **AC1（红基线 + 保证仍为真的双读数）**：贴出 ① 旧判据逐字 exit 1 与 stderr；② `wc -c packages/quay/src/store-commit.ts packages/quay/src/core/store-commit.ts`（前者 ≈705、后者 ≈12572）；③ `grep -n 'export type CommitOutcome' packages/quay/src/core/store-commit.ts` 命中四态联合那一行；④ `grep -rl 'function commitGoalFileAfterWrite\|function commitMetaFileAfterWrite' packages/quay/src | wc -l` = **0**。⛔ 不假定立案时的读数仍成立。
- [ ] **AC2（判据已重锚且不减强度）**：criterion 经 `quay goal write AC-196 --criterion … --expect … --origin …` 落库（**非**手工 Edit）。新谓词为四条合取：import 面存在且转发到 core / canonical 实现存在 / `CommitOutcome` 声明块含四态 / 旧 boolean 函数 = 0。读数：`quay goal show AC-196 --json` 的 criterion 里出现 `packages/quay/src/core/store-commit.ts`，且**不再**把两个状态名 grep 在重构前的 src-root 载体上。贴 `git show <landing commit> -- goals/AC-196-*.md` 的 diff（只有 `criterion` / `expect` / `origin` 三个键变化）与逐字节读回比对结果。
- [ ] **AC3（配套夹具跑正本谓词）**：`node --test packages/quay/test/ac196-criterion-four-state-vocabulary.test.mjs` 退出码 0；夹具按 `# >>> four-state-vocabulary` marker **逐字抽取** `goals/AC-196-*.md` 的块并在临时 root 上得到正控制 `OK —` 与 exit 0。贴运行输出的汇总行。
- [ ] **AC4（判据能取假 —— 三个负控制，成因不同形）**：按 Plan 步骤 5 的三条突变，各自贴 exit code 与逐字 stderr；三条 `CAUSE=` 互不相同且夹具断言彼此不含对方的 token。⛔ 不得靠放宽谓词（把「声明块内」降成「文件里出现」）凑绿。
- [ ] **AC5（真实落账）**：`node packages/quay/bin/quay.js goal gate AC-196` ⇒ **exit 0**；`.quay/gate-events.jsonl` 中 `item_id=AC-196` 的新事件为 `verdict:"pass"` 且 `payload.criterionHash` ≠ `0d68374d922ba1ef`，并贴修前（fail，`0d68374d922ba1ef`）/ 修后两行逐字对照。
- [ ] **AC6（不回归）**：`bash scripts/test.sh --for-task gap-ac196-criterion-four-state-vocabulary-carrier-stale` 退出码 0；`grep -c 'export type CommitOutcome' packages/quay/src/core/store-commit.ts` = 1，且 `grep -rl 'function commitGoalFileAfterWrite\|function commitMetaFileAfterWrite' packages/quay/src | wc -l` 仍为 0。

## Definition of Done

**REAL LANDING（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是**一条在真实树上为真、且能取假的判据经 ABI 落进 goal 记录并落账**，同时四态保证本身仍由代码直接作证：

1. **落地对象**：`goals/AC-196-not-in-git-unchanged-boolean-0.md` 的 `criterion` 由 `quay goal write` 写入（store-commit 形状的提交，贴 sha + 提交消息；⛔ 非手工 Edit），且 `git show develop:goals/AC-196-not-in-git-unchanged-boolean-0.md` 能看到 `# >>> four-state-vocabulary` 块（fan-in 落地后可见）。
2. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-196` / `gate=goal` / `verdict=pass` 的新事件，`criterionHash` ≠ `0d68374d922ba1ef` —— 一条 `--dry-run` 输出**不算**。
3. **直接量**：AC1 的四条读数在重锚后重取一次；AC4 的三个负控制留痕证明判据不是恒真（硬规则 4 推论三）。
4. **⛔ 三种「凑绿」明令禁止**：① 把状态名复制回 src-root shim 或在那里重新加实现（回退 35dc5da93 拆掉的 src-root↔gate 环）；② 把谓词放宽成「文件里出现某词」（必须从 `export type CommitOutcome` 的声明块取，注释/返回值里的命中不算）；③ 改 `expect` 语义去匹配现状而不作结构测量。
5. **不越界**：AC-198 的同族失效不在本任务 Touches 内（读数已写在 Proposal，交 driver 独立立案）；不改 `goals/AC-197-*.md`；不新增 `plugin/scripts/*.ts`。
6. 本任务自身 `done` 并随 fan-in 落地。

## Touches

- `goals/AC-196-not-in-git-unchanged-boolean-0.md`
- `packages/quay/test/ac196-criterion-four-state-vocabulary.test.mjs` (new)
- `tasks/gap-ac196-criterion-four-state-vocabulary-carrier-stale.md`

（说明：第一条是落地面 —— 谓词经 `quay goal write AC-196 --criterion …` 写库；第二条是逐字抽取谓词块的夹具，与 `packages/quay/test/ac197-criterion-five-kind-wiring.test.mjs` 同族；第三条是 self-touch。⛔ `packages/quay/src/store-commit.ts` 与 `packages/quay/src/core/store-commit.ts` **不在 Touches 内** —— 它们是保证的承载体，本任务只重锚判据、不回填实现；负控制只在临时副本上做。）
