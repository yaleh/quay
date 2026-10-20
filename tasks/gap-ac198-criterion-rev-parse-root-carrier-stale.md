---
id: gap-ac198-criterion-rev-parse-root-carrier-stale
title: AC-198 rev-parse root 判据锚在重构前的 src-root 载体上（实现已下沉 core/store-commit.ts）——
  重锚到按符号定位的实现模块 + 逐字夹具
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-198
---
## Proposal

**缺口（立案当轮直接量，2026-10-20，cwd = 主检出 `/data/home/yale/work/quay`）**

判据 `goals/AC-198-root-git-rev-parse-show-toplevel-path-dirname-kind-dir-git.md` 逐字执行 ⇒ exit 1，stderr 逐字：

```
AC-198 fail: packages/quay/src/store-commit.ts does not use rev-parse to resolve the root
```

逐条读数（按位置判定）：

| 谓词 | 读数 |
|---|---|
| `grep -rn 'const root = path.dirname(goalDir)' packages/quay/src \| wc -l` | **0** — 通过 |
| `grep -rn 'const root = path.dirname(metaDir)' packages/quay/src \| wc -l` | **0** — 通过 |
| `grep -q 'rev-parse' packages/quay/src/store-commit.ts` | **失败** — 该文件只有 705 字节，是纯转发再导出，`rev-parse` 命中 0 |
| `grep -c 'rev-parse' packages/quay/src/core/store-commit.ts` | **7** |

**保证本身没有丢，丢的是判据的载体。** `packages/quay/src/core/store-commit.ts` 逐行：

```
140: export function resolveGitRoot(dir: string): string | null {
142:   const out = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
153: export function commitStoreWrite(opts: CommitStoreWriteOptions): CommitStoreWriteResult {
155:   const root = opts.root === undefined ? resolveGitRoot(process.cwd()) : opts.root;
```

⇒ 原语默认 root 走 `resolveGitRoot`，后者调 `git rev-parse --show-toplevel`；两个被禁的 `path.dirname(<kind>Dir)` 字面量在 `packages/quay/src` 下计数为 0。AC-198 断言的三件事（root 取自 rev-parse、不拿 `path.dirname(<kind>Dir)` 当 git 根、原语用 rev-parse）**在实现上都成立**。

**成因是一次方向相反的已落地重构，不是能力回归。** `35dc5da93`（`refactor(core): sink the gate substrate into src/core to break the ""<->gate directory SCC`，2026-10-18 20:29:59 +0800，已是 `develop` 祖先）把 gate 底座下沉到 `packages/quay/src/core/`，src-root 路径保留为纯转发再导出；shim 顶部注释明写「⛔ Do not re-add implementation here」，回填实现会把 src root 重新拉进它刚拆掉的 gate 目录环。判据把 `rev-parse` grep 在**旧路径**上，文件一改形态就结构性失效 —— 硬规则 4c 的**撰写侧**失败：判据点名的量在「产生处 → 读取处」之间的那层重构里被搬走了。

**「上一次修复没守住」在这里不准确，须如实写。** `gap-store-commit-unification-ac198-rev-parse-root`（`goal_ac: AC-198`，status `done`）于 2026-09-08 建好原语并消掉两处 `path.dirname` 根；那份修复没有被回退，今天还更强（实现唯一 + 一个转发面）。变的只是模块位置。因此本任务**不是**重新实现 rev-parse root，而是把判据重锚到按符号定位的实现模块，并加一个逐字运行该判据的夹具，防止同一形态再次静默腐烂。

<!-- dedup-ref -->
**去重与粒度**：`goal_ac: AC-198` 的唯一任务 `gap-store-commit-unification-ac198-rev-parse-root` 已 `done`（`goal_ac` 是单标量，`done` 不算在飞去重命中，但它是「上一轮修复」的审计证据）。同 goal 的姊妹：AC-196 由在飞任务 `gap-ac196-criterion-four-state-vocabulary-carrier-stale`（`ready`）以完全相同的手法修复，其任务体已显式声明 AC-198 不在其范围内、交 driver 独立立案；AC-197 已重锚到 `packages/quay/src/core/store-commit.ts`（`gap-ac197-criterion-commitstorewrite-identifier-pin-stale`）。合并候选检查（`task-granularity-advice.ts`，三条 draft Touches）返回 `peers: []`、`mentions: []` ⇒ **separate / none found**。

**同族扫描（硬规则 5b 产物）**：`grep -l 'packages/quay/src/store-commit\.ts' goals/*.md` 命中 **2** 条：`AC-196` 与 `AC-198`。逐字运行 GOAL-008 全部六条判据的直接读数：AC-195 `exit=0`、AC-196 `exit=1`（在飞任务已覆盖）、AC-197 `exit=0`、AC-198 `exit=1`、AC-199 `exit=0`、AC-200 `exit=0`。⇒ AC-198 是这一成因下**最后一个**未修判据；本任务只覆盖 AC-198，不回填、不合并 AC-196。

## Plan

1. **重取红基线**（⛔ 不假定立案值仍成立）：逐字跑判据贴 exit 1 与 stderr；同时贴 `wc -c packages/quay/src/store-commit.ts packages/quay/src/core/store-commit.ts`、`grep -n 'export function commitStoreWrite' packages/quay/src/core/store-commit.ts`、`grep -n 'rev-parse' packages/quay/src/core/store-commit.ts`。再从台账读**修前** `criterionHash`（供 AC5 的 `≠` 谓词使用，⛔ 不要照抄本任务体里的任何数字）。
2. **写新谓词（结构，按符号定位，⛔ 不钉路径）**：承载体用 marker 块 `# >>> rev-parse-root` … `# <<< rev-parse-root`，块首注明「逐字由 `packages/quay/test/ac198-criterion-rev-parse-root.test.mjs` 运行」。谓词为四条合取：
   ① 两个被禁字面量（`const root = path.dirname(goalDir)` / `const root = path.dirname(metaDir)`）在 `packages/quay/src` 下计数 = 0；
   ② `packages/quay/src` 下 `export function commitStoreWrite` 的**定义模块数恰好 = 1**（`grep -rl … --include='*.ts'`），并用该模块作为后续承载体 —— 按符号解析，未来模块再搬家仍能取到量（硬规则 4c）；
   ③ 用 `awk` 从该模块截取 `resolveGitRoot` 的**函数体**，要求同时出现 `rev-parse` 与 `--show-toplevel`（⛔ 整文件 grep：注释里提到不算，硬规则 2）；
   ④ 用 `awk` 截取 `commitStoreWrite` 的函数体，要求出现 `resolveGitRoot(` —— 把「默认 root 来自 rev-parse」钉在原语体上，而不是钉在某个文件的任意一行上。
   每条失败给具名 `CAUSE=`；`echo … >&2` 与 `exit 1` **必须同行**（`plugin/scripts/criterion-failure-attribution-check.ts` 逐行判定）。
   ⛔ **重锚注释里不得逐字引用被退役的旧谓词字面量**（`reanchored-criterion-rationale-must-not-quote-the-retired-pin`）：用「重构前的 src-root 载体路径」描述它；旧文本的逐字归档位置是记录自己的 `origin` 字段，不是 criterion。
3. **经 ABI 落库**：`node packages/quay/bin/quay.js goal write AC-198 --criterion "$(cat <新 criterion 文件>)" --expect "<新读数>" --origin "<原 origin + 为什么要改>" --root <worktree>`。⛔ 不得 `Edit` goal 文件。读回逐字节比对（`quay goal show AC-198 --json` 的 `criterion` 与源文件全等，`EQUAL: true`）—— YAML 折行标量损坏过历史先例。只允许 `criterion` / `expect` / `origin` 三个键变化。
4. **配套夹具** `packages/quay/test/ac198-criterion-rev-parse-root.test.mjs`（`// @test-group product`，`node:test`）：按 marker 从 `goals/AC-198-*.md` **逐字抽取**谓词块（单一正本关系，⛔ 不是逻辑副本），在 `mktemp -d` 建好的临时 root 里复制真实 `packages/quay/src` 后运行。
5. **负控制（成因两两不同形，全部只在临时 root 副本上做，⛔ 不动生产文件）**：
   ① 从 `resolveGitRoot` 体里删掉 `rev-parse` ⇒ `CAUSE=resolvegitroot-not-rev-parse`；
   ② 把 `--show-toplevel` 改成 `--show-prefix` ⇒ `CAUSE=resolvegitroot-no-show-toplevel`；
   ③ 让 `commitStoreWrite` 不再调 `resolveGitRoot` ⇒ `CAUSE=primitive-root-not-from-resolvegitroot`；
   ④ 注入 `const root = path.dirname(goalDir)` ⇒ `CAUSE=dirname-goaldir-root`；
   ⑤ 新增第二个 `export function commitStoreWrite` 定义 ⇒ `CAUSE=primitive-definition-count-not-1`。
   每条断言 exit 1 且 stderr 含自己的 `CAUSE=`、**不含**其余四条的 token。
6. **正控制**：未突变 root ⇒ `node packages/quay/bin/quay.js goal gate AC-198` **exit 0**，逐字贴出。
7. **落账**：`.quay/gate-events.jsonl` 中 `item_id=AC-198` 的末条为 `verdict:"pass"` 且 `payload.criterionHash` ≠ 步骤 1 取到的修前 hash（贴修前 / 修后两行）。
8. **不回归**：`bash scripts/test.sh --for-task gap-ac198-criterion-rev-parse-root-carrier-stale` 退出码 0。

## Acceptance Criteria

- [x] **AC1（红基线 + 保证仍为真的双读数）**：贴出 ① 旧判据逐字 exit 1 与 stderr；② `wc -c packages/quay/src/store-commit.ts packages/quay/src/core/store-commit.ts`（前者约 705、后者约 12572）；③ `grep -n 'export function commitStoreWrite\|export function resolveGitRoot' packages/quay/src/core/store-commit.ts`；④ `grep -c 'rev-parse' packages/quay/src/core/store-commit.ts` = 7。⛔ 不假定立案时的读数仍成立。
- [x] **AC2（判据已重锚且不减强度）**：criterion 经 `quay goal write AC-198 --criterion … --expect … --origin …` 落库（**非**手工 Edit）；`quay goal show AC-198 --json` 的 `criterion` 里出现 marker 块 `# >>> rev-parse-root`，且**不再**把 `rev-parse` 钉在重构前的 src-root 载体路径上（该路径只允许出现在 `origin` 的归档文本里）。贴 `git show <landing commit> -- goals/AC-198-*.md` 的 diff（只有 `criterion` / `expect` / `origin` 三个键变化）与逐字节读回 `EQUAL: true`。
- [x] **AC3（夹具跑正本谓词）**：`node --test packages/quay/test/ac198-criterion-rev-parse-root.test.mjs` 退出码 0；夹具按 `>>> rev-parse-root` marker **逐字抽取** `goals/AC-198-*.md` 的块并在临时 root 上得到正控制 `OK —` 与 exit 0。贴运行输出的汇总行。
- [x] **AC4（判据能取假 —— 五个负控制，成因不同形）**：按 Plan 步骤 5 的五条突变，各自贴 exit code 与逐字 stderr；五条 `CAUSE=` 互不相同，且夹具断言彼此不含对方的 token。⛔ 不得靠放宽谓词（把「函数体内」降成「文件里出现」）凑绿。
- [x] **AC5（真实落账）**：`node packages/quay/bin/quay.js goal gate AC-198` ⇒ **exit 0**；`.quay/gate-events.jsonl` 中 `item_id=AC-198` 的新事件为 `verdict:"pass"` 且 `payload.criterionHash` ≠ 修前 hash（贴修前 / 修后两行逐字对照）。
- [x] **AC6（不回归 + 不回填）**：`bash scripts/test.sh --for-task gap-ac198-criterion-rev-parse-root-carrier-stale` 退出码 0；`grep -rl 'export function commitStoreWrite' packages/quay/src --include='*.ts' | wc -l` = 1；`wc -c packages/quay/src/store-commit.ts` 仍 ≈705（转发 shim 未被回填实现或加 `rev-parse` 注释）。

## Definition of Done

**REAL LANDING（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是**一条在真实树上为真且能取假的判据经 ABI 落进 goal 记录并落账**，同时 rev-parse root 保证本身仍由实现模块直接作证：

1. **落地对象**：`goals/AC-198-root-git-rev-parse-show-toplevel-path-dirname-kind-dir-git.md` 的 `criterion` 由 `quay goal write` 写入（贴 sha + store-commit 形状的提交消息；⛔ 非手工 Edit），且 `git show develop:goals/AC-198-*.md` 能看到 `# >>> rev-parse-root` 块（fan-in 落地后可见）。
2. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-198` / `gate=goal` / `verdict=pass` 的新事件，`criterionHash` ≠ 修前 hash —— 一条 `--dry-run` 输出**不算**。
3. **直接量**：AC1 的四条读数在重锚后重取一次；AC4 的五个负控制留痕证明判据不是恒真（硬规则 4 推论三）。
4. **⛔ 三种「凑绿」明令禁止**：① 往 src-root 转发 shim 里回填实现、或加一行 `rev-parse` 注释（既回退 `35dc5da93` 拆掉的 src-root↔gate 环，又让谓词被注释满足）；② 把谓词放宽成「`rev-parse` 在 `packages/quay/src` 任意位置出现」；③ 改 `expect` 语义去匹配现状而不作结构测量。
5. **不越界**：AC-196 的同族失效由在飞任务 `gap-ac196-criterion-four-state-vocabulary-carrier-stale` 覆盖，本任务不改 `goals/AC-196-*.md`；不改 `packages/quay/src/core/store-commit.ts` 的实现（它已正确）；不新增 `plugin/scripts/*.ts`。
6. 本任务自身 `done` 并随 fan-in 落地。

## Touches

- `goals/AC-198-root-git-rev-parse-show-toplevel-path-dirname-kind-dir-git.md`
- `packages/quay/test/ac198-criterion-rev-parse-root.test.mjs` (new)
- `tasks/gap-ac198-criterion-rev-parse-root-carrier-stale.md`

（说明：第一条是落地面 —— 谓词经 `quay goal write AC-198 --criterion …` 写库；第二条是逐字抽取谓词块的夹具，与 `packages/quay/test/ac197-criterion-five-kind-wiring.test.mjs` 同族；第三条是 self-touch。⛔ `packages/quay/src/store-commit.ts` 与 `packages/quay/src/core/store-commit.ts` **不在 Touches 内** —— 前者是转发面、后者是保证的承载体，本任务只重锚判据、不回填实现；负控制只在临时副本上做。）