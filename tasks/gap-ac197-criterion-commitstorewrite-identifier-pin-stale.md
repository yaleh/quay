---
id: gap-ac197-criterion-commitstorewrite-identifier-pin-stale
title: AC-197 判据把谓词键在字面量 `commitStoreWrite` 上，而已落地的去重提交 943ef47f6 把四份 per-kind
  拷贝折叠成单一共享包装 `commitKindFile` ⇒ 判据在真实树上结构性失效（n=1≠5）；五 kind 保证仍在（四个 Core store 经
  commitKindFile→commitStoreWrite、native store 直调）—— 把判据重锚到「共享原语模块依赖 +
  调用面」这一结构，并给五 kind 真实写盘往返读数
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra:
  schema: execution
goal_ac: AC-197
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，2026-10-13，cwd = 主检出 `/data/home/yale/work/quay`）**

判据 `goals/AC-197-*.md` 逐字：`n="$(grep -l commitStoreWrite <五个 store 文件> | wc -l)"; test "$n" -eq 5`。本轮实测 **n=1**，逐文件：

```
packages/quay/src/goal-store.ts            : 0
packages/quay/src/meta-store.ts            : 0
packages/quay/src/adr-store.ts             : 0
packages/quay/src/document-store.ts        : 0
packages/quay-native/src/store.ts          : 4   ← 唯一命中
```

台账（`.quay/gate-events.jsonl`，`item_id=AC-197`）：末次 pass `2026-10-12T14:20:58.115Z`；其后 `17:51:11.915Z` / `17:52:54.781Z` 为 fail，reason 逐字 `CAUSE=commitStoreWrite-not-in-all-5 — 经 commitStoreWrite 提交的 store 文件数 n=1 ≠ 5`。这三条事件的 `payload.criterionHash` 同为 `5a7dc1fc29c3b9a3` ⇒ **判据文本从未变过，翻转纯属树变了**。

**成因不是「机制坏了」——是判据把谓词键在一个标识符上，而该标识符被一次方向相反的已落地重构删掉了：**

- 立案时（`gap-store-commit-unification-ac197-five-kind-wiring`，status done）四份 Core store 各带一份**本地拷贝**调用 `commitStoreWrite`。读数：`git show 943ef47f6^:<file> | grep -c commitStoreWrite` ⇒ goal / meta / adr / document 各 **3** ⇒ 连同 native 命中 **5** ⇒ pass。
- `943ef47f6`（`store-commit: one commitKindFile wrapper replaces four per-kind copies`，2026-10-12T16:34:36Z；`git merge-base --is-ancestor 943ef47f6 develop` 为真）把这四份字节相同的拷贝折叠成 `packages/quay/src/store-commit.ts:210` 的**单一共享包装** `commitKindFile`；四份拷贝里的字面量 `commitStoreWrite` 随之消失 ⇒ 下一次 sweep（`17:51:11Z`）即红。

**⇒ 「上一次修复没守住」在这里不准确，须如实写：那份修复没有被回退，五 kind 的保证从未丢失，今天还更强（一个原语 + 一个共享包装）。** 活读（逐字 grep）：

| kind | 提交面（活读） |
|---|---|
| tasks | `packages/quay-native/src/store.ts:26` `import { commitStoreWrite } from "../../quay/src/store-commit.ts"`；`:1464` 调用 |
| goals | `goal-store.ts:95` `import { commitKindFile, commitStoreBatch, resolveGitRoot } from "./store-commit.ts"`；`:2537` / `:3200` 调 `commitKindFile`、`:3272` 调 `commitStoreBatch` |
| meta | `meta-store.ts:39` import `commitKindFile`；`:206` 调用 |
| adr | `adr-store.ts:34` import；`:262` 调用 |
| docs-managed | `document-store.ts:31` import；`:194` 调用 |
| （原语） | `store-commit.ts:153` `commitStoreWrite`（四态返回）；`:210` `commitKindFile` 在 `:219` 委托 `commitStoreWrite` |

⇒ 该判据是**标识符键化**的（同族教训：`extraction-ratchet-must-key-on-structure-not-identifiers`）；它测的从来不是「五 kind 是否经统一原语提交」，而是「这五个文件里是否出现某个函数名」。**修法 = 把谓词重锚到结构**（对共享原语模块的依赖 + 调用面）。⛔ **不是**把 `commitStoreWrite` 字面量塞回四个文件——那会回退一份已落地的去重，`store-commit.ts:203` 的注释明写「⛔ do not restore a per-kind prefix here」。

<!-- dedup-ref -->
去重（按机制，⛔ 不按症状关键词）：`grep -rn '^goal_ac: AC-197' tasks/*.md` ⇒ **1 命中** = `gap-store-commit-unification-ac197-five-kind-wiring`，`status: done` ⇒ 不是重复（重复只算 in-flight）；本 AC 无在飞主。合并候选（`task-granularity-advice.ts --touches goals/AC-197-*.md --json`）⇒ `peers: []`，`none found`。同机制、不同 AC 的同族正本：`gap-ac288-criterion-cmdline-port-literal-stale`（done）、`gap-ac297-criterion-cmdline-port-literal-stale`（done）等 `gap-acNNN-criterion-*-stale` 系列——各自重锚自己那一份 goal 文件，互不覆盖；本任务照搬其形态（marker 块 + 逐字抽取夹具 + 双向负控制 + 新指纹落账），⛔ 不另造第二套。`gap-routine-semantic-dedup-scan-commit-kind-file-quadruplicated`（done）是造成本次翻转的那次重构，其被修对象（四份拷贝）与本条不同——其成果须保留，⛔ 不得回退。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-197 --dry-run --json` ⇒ `verdict: fail` 且 reason 携带 `n=1 ≠ 5`；同一时刻逐文件贴 `grep -c commitStoreWrite` 的五个读数。
2. **定新谓词（结构，非标识符）**：criterion 改为 ① `packages/quay/src/store-commit.ts` 导出四态原语 `commitStoreWrite`、**且**导出每 kind 包装 `commitKindFile`、**且**后者委托前者；② 五个 store 文件**各自**依赖 `store-commit.ts`（import 面）**且**出现一次对共享原语的**调用**。承载体用同族 marker 块形态（`# >>> five-kind-wiring` … `# <<< five-kind-wiring`），块首注明「逐字由 `packages/quay/test/ac197-criterion-five-kind-wiring.test.mjs` 运行」。⛔ 不得把强度降到「文件里提到某个词」；⛔ 不得把 `commitStoreWrite` 字面量塞回四个 store 文件；⛔ 不另造第二套并行判据。**建议形态（可微调，除结构属性外不得减弱；`echo … >&2` 与 `exit 1` 必须同行——`criterion-failure-attribution-check.ts` 逐行判定）**：

```
# >>> five-kind-wiring
# run verbatim by packages/quay/test/ac197-criterion-five-kind-wiring.test.mjs
prim="packages/quay/src/store-commit.ts"
grep -q 'export function commitStoreWrite' "$prim" || { echo "CAUSE=primitive-missing — $prim 未导出四态原语 commitStoreWrite" >&2; exit 1; }
grep -q 'export function commitKindFile' "$prim" || { echo "CAUSE=wrapper-missing — $prim 未导出每 kind 包装 commitKindFile" >&2; exit 1; }
awk '/export function commitKindFile/{f=1} f{print} f&&/^}/{exit}' "$prim" | grep -q 'commitStoreWrite(' || { echo "CAUSE=second-primitive — commitKindFile 未委托 commitStoreWrite（出现第二套并行原语）" >&2; exit 1; }
n=0
for f in packages/quay/src/goal-store.ts packages/quay/src/meta-store.ts packages/quay/src/adr-store.ts packages/quay/src/document-store.ts packages/quay-native/src/store.ts; do
  grep -q 'store-commit\.ts' "$f" && grep -qE 'commit(StoreWrite|KindFile|StoreBatch)\(' "$f" && n=$((n+1))
done
test "$n" -eq 5 || { echo "CAUSE=store-commit-call-site-missing-in-all-5 — 依赖并调用共享原语的 store 文件数 n=$n ≠ 5（五种 kind：tasks/goals/meta/adr/docs-managed）" >&2; exit 1; }
# <<< five-kind-wiring
exit 0
```

   ⚠️ **过报方向如实写进注释**（本仓既有做法）：`grep -q 'store-commit\.ts'` 会同时命中**注释里**提到该模块的行——这是本谓词的已知过度包含面，⛔ 不得靠放宽成立，但也不得假称它是精确的 import 面。
3. **重锚落库**：`node packages/quay/bin/quay.js goal write AC-197 --criterion "$(cat <新 criterion 文件>)"` 落库（⛔ 不得直接 `Edit` goal 文件）；`expect` 与 `origin` 同步补「为什么改」；贴逐字 diff（只有谓词块与「为什么改」变化）。
4. **配套夹具** `packages/quay/test/ac197-criterion-five-kind-wiring.test.mjs`（首行 `// @test-group product`，`node:test`）：按 marker 从 `goals/AC-197-*.md` **逐字抽取**谓词块（单一正本关系，⛔ 不是逻辑副本），在 `git init` 过的临时 root 里跑正/负两向。
5. **两个负控制**（硬规则 4 推论三，判据必须能取假）：① 五个 store 文件之一「只 import 不调用」⇒ 谓词非 0 且具名 `CAUSE=`；② 在**临时副本**上把 `commitKindFile` 改为不委托 `commitStoreWrite`（即出现第二套并行原语）⇒ 谓词非 0，且成因与 ① **不同形**。⛔ 负控制只在临时 root/副本上做，⛔ 不得改动生产文件。
6. **五 kind 真实写盘往返**（保证为真的直接量，⛔ 不是 grep 回声）：见 AC4。
7. **落账**：`node packages/quay/bin/quay.js goal gate AC-197` ⇒ exit 0，台账新增 `verdict:"pass"` 且 `payload.criterionHash` ≠ `5a7dc1fc29c3b9a3`。

## AC

- [x] **AC1（承载体已重锚且不减强度）**：`goals/AC-197-*.md` 的 criterion 不再要求五个 store 文件出现字面量 `commitStoreWrite`，改为结构谓词（① 原语模块 `store-commit.ts` 同时导出 `commitStoreWrite` 与委托它的 `commitKindFile`；② 五个 store 文件各自依赖 `store-commit.ts` 且出现一次对共享原语的调用）。读数：重锚前 criterion 正文里 `grep -l commitStoreWrite` 命中 1 处，重锚后 0 处；贴 `git diff`，只有谓词块与「为什么改」变化。⛔ 除非经 `quay goal write` 落库否则不算。
- [x] **AC2（判据能取假 —— 两个负控制，成因不同形）**：① 五个 store 文件之一去掉调用、只留 import ⇒ `quay goal gate AC-197` 非 0 且以具名 `CAUSE=` 可区分；② 临时副本上 `commitKindFile` 改为不委托 `commitStoreWrite` ⇒ 非 0 且成因与 ① **不同形**。两条均贴退出码与逐字 stderr。⛔ 不得靠放宽谓词（把「调用」降成「提到」）凑绿。
- [x] **AC3（正控制）**：`node packages/quay/bin/quay.js goal gate AC-197` ⇒ **exit 0**，逐字贴出。
- [x] **AC4（保证为真的直接量 —— 五 kind 真实写盘往返）**：tasks 与 goals 用本仓真实写入各取一条提交 —— 本任务的 `task_write` 与新 criterion 的 `goal write` 各自产生一条 `tasks/*.md` / `goals/*.md` 的 store-commit 形状提交（贴 `git log -1 --format='%h %s'`）；meta / adr / docs-managed 在 `git init` 过的临时 root 里各驱动一次真实写入，贴各自提交 sha + 消息，并核对 `git status --porcelain <dir>` 为空。⛔ 「谓词绿」与「保证为真」是两件事，本条只认后者；⛔ 不得向本仓塞入假的 adr / docs-managed 载体。
- [x] **AC5（不回归 + 结构零回退）**：① `bash scripts/test.sh --for-task gap-ac197-criterion-commitstorewrite-identifier-pin-stale` 退出码 0；② `grep -c 'function commitKindFile' packages/quay/src/goal-store.ts packages/quay/src/meta-store.ts packages/quay/src/adr-store.ts packages/quay/src/document-store.ts` 全为 0，且 `grep -c 'export function commitKindFile' packages/quay/src/store-commit.ts` = 1（四份拷贝未被恢复、包装仍只有一处）。
- [x] **AC6（新指纹落账）**：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-197` 的末条为 `verdict:"pass"`，且其 `payload.criterionHash` ≠ `5a7dc1fc29c3b9a3`（贴修前 / 修后两行）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了、dry-run 绿了」，而是**一条在真实树上为真、且能取假的判据落了账，并有五 kind 真实提交往返作证**：

1. **落地对象**：`goals/AC-197-*.md` 的 criterion 经 `quay goal write` 落库（⛔ 非手工 Edit），`quay goal gate AC-197` 在真实树上 `exit 0`；重锚版落在 develop（`git show develop:goals/AC-197-*.md` 可见新谓词块）。
2. **台账**：`.quay/gate-events.jsonl` 出现 `item_id=AC-197` / `gate=goal` / `verdict=pass` 的新事件，`criterionHash` ≠ `5a7dc1fc29c3b9a3` —— 一条 dry-run 输出**不算**。
3. **直接量**：AC4 的五 kind 提交往返读数（sha + 消息 + 干净工作树）贴出。
4. **负控制留痕**：AC2 两条负控制的退出码与 `CAUSE=` 逐字留存，证明判据不是恒真（硬规则 4 推论三）。
5. **⛔ 三种「凑绿」明令禁止**：把 `commitStoreWrite` 字面量塞回四个 store 文件（回退已落地去重）；把谓词放宽成「文件里提到某词」；改 `expect` 语义、或改判据以匹配现状而不作结构测量。
6. **不越界**：其它 AC 的同族重锚不在本任务 Touches 内。
7. 本任务自身 `done` 并随 fan-in 落地。

## Touches

- `goals/AC-197-kind-tasks-goals-meta-adr-docs-managed-commitstorewrite-5.md`
- `packages/quay/test/ac197-criterion-five-kind-wiring.test.mjs` (new)
- `tasks/gap-ac197-criterion-commitstorewrite-identifier-pin-stale.md`

（说明：第一条是落地面——criterion 的谓词，经 `quay goal write AC-197 --criterion …` 落库，`expect` 与正文语义按「为什么改」同步；第二条是配套夹具（按 marker 从 goal 文件逐字抽取谓词块，与 `packages/quay/test/ac288-criterion-address-derivation.test.mjs` 同族）；第三条是 self-touch。⛔ 不新增 `plugin/scripts/*.ts`。⛔ `packages/quay/src/store-commit.ts` 与四个 store、`packages/quay/test/store-commit.test.mjs` **不在本 Touches 内**——它们是保证的承载体，本任务只重锚判据、不回退已落地去重；AC2② 的负控制只在临时副本上做。）

## Evidence

（除注明「生产」者，本轮读数 cwd = 本任务 worktree `/data/home/yale/work/quay-worktrees/gap-ac197-criterion-commitstorewrite-identifier-pin-stale`）

### AC1 —— criterion 已重锚，强度未降（⛔ 经 `quay goal write` 落库，非手工 Edit）

**红基线**（Plan 步骤 1，重锚前同一时刻）：

```
$ node packages/quay/bin/quay.js goal gate AC-197 --dry-run --json
"verdict": "fail",
"payload": { "reason": "acceptance failed (exit 1) — CAUSE=commitStoreWrite-not-in-all-5 — 经 commitStoreWrite 提交的 store 文件数 n=1 ≠ 5（五种 kind：tasks/goals/meta/adr/docs-managed）" }

$ for f in packages/quay/src/goal-store.ts packages/quay/src/meta-store.ts \
           packages/quay/src/adr-store.ts packages/quay/src/document-store.ts \
           packages/quay-native/src/store.ts; do printf '%s %s\n' "$f" "$(grep -c commitStoreWrite "$f")"; done
packages/quay/src/goal-store.ts                0
packages/quay/src/meta-store.ts                0
packages/quay/src/adr-store.ts                 0
packages/quay/src/document-store.ts            0
packages/quay-native/src/store.ts              4      ← 唯一命中 ⇒ n=1
```

**identifier 键已消失（读数按 AC1 自己的口径 —— criterion 正文）**：`quay goal show AC-197 --json` 的 `criterion` 字段里 `grep -l commitStoreWrite` 命中 **1 → 0**（重锚前该串在旧谓词本体里；2026-10-13 重取，见文末「第 4 轮」）。

⚠️ **更正（2026-10-13）**：此处原写的是**文件级** `grep -c 'grep -l commitStoreWrite' goals/AC-197-*.md` ⇒ 0 —— **该读数为假**，实测为 **2**：一处在 criterion 的「为什么改」注释里**逐字引用**旧谓词，一处在同一记录的 `origin` 字段里。⇒ 已把 criterion 里那句注释改为**描述**旧谓词而非逐字引用（旧谓词逐字仍留在 `origin`，审计面未丢），AC1 的读数这才真正成立；文件级 grep 此后为 **1**（只剩 `origin` 那一处，那是它该在的地方）。

**落库**（⛔ 非手工 Edit）：`node packages/quay/bin/quay.js goal write AC-197 --criterion "$(cat <新 criterion>)" --expect … --origin …`
⇒ store-commit `33e76b8a7 goals: AC-197 field:criterion,expect,origin by cli:3180872`
（`1 file changed, 121 insertions(+), 7 deletions(-)`，单文件 `goals/AC-197-*.md`）。
读回**逐字节相同**（frontmatter 解析后与源文件全等，`EQUAL: true`）⇒ YAML 折行标量没有损坏脚本 —— 这也是 `goal gate` 能跑通的实质原因。

**变更面**（`git show 33e76b8a7 | grep -E '^[+-][a-zA-Z]+:'`）：仅 `criterion`（`|` 块 → `>-` 折行块）、`expect`、`origin` 三个顶层键。`status: achieved` / `title` / `goal: GOAL-008` 逐字未动。

**新谓词（结构，非标识符）**：① 原语模块 `packages/quay/src/store-commit.ts` 导出四态原语 `commitStoreWrite` 且导出每 kind 包装 `commitKindFile`，且后者在自身函数体内**委托**前者（awk 抽取函数体后 `grep -q 'commitStoreWrite('`）；② 五个 store 文件**各自**「依赖 `store-commit.ts` ∧ 出现一次 `commit(StoreWrite|KindFile|StoreBatch)(` 调用点」。承载体 = `# >>> five-kind-wiring` … `# <<< five-kind-wiring` marker 块，块首注明逐字由 `packages/quay/test/ac197-criterion-five-kind-wiring.test.mjs` 运行。

**过报方向如实写进注释**（⛔ 未靠放宽成立，也未假称精确）：`grep -q 'store-commit\.ts'` 会同时命中注释里提到该模块的行 —— 该已知过度包含面已逐字写入 criterion 的 `⚠️ KNOWN OVER-INCLUSION` 段。

### AC2 —— 判据能取假：四个负控制，成因两两不同形

（全部在 `git init` 过的**临时 root** 上做，root 内是生产文件的真实拷贝；⛔ 未改动任何生产文件）

| # | 突变 | exit | 逐字 stderr |
|---|---|---|---|
| ① | `packages/quay/src/meta-store.ts` 去掉调用点、**保留** `import … from "./store-commit.ts"` | **1** | `CAUSE=store-commit-call-site-missing-in-all-5 — 依赖并调用共享原语的 store 文件数 n=4 ≠ 5（五种 kind：tasks/goals/meta/adr/docs-managed）` |
| ② | 临时副本的 `commitKindFile` 函数体改为 `return "unchanged";`（**第二套并行原语**） | **1** | `CAUSE=second-primitive — commitKindFile 未委托 commitStoreWrite（出现第二套并行原语）` |
| ③ | 原语模块 `export function commitStoreWrite` → `function commitStoreWrite` | **1** | `CAUSE=primitive-missing — packages/quay/src/store-commit.ts 未导出四态原语 commitStoreWrite` |
| ④ | 原语模块 `export function commitKindFile` → `function commitKindFile` | **1** | `CAUSE=wrapper-missing — packages/quay/src/store-commit.ts 未导出每 kind 包装 commitKindFile` |

① 的突变只动调用面（`import` 行逐字保留，实测 `39:import { commitKindFile } from "./store-commit.ts";` 与 `199:` 的注释都还在）⇒ 「只 import 不调用」被**调用面那一半合取**抓住，⛔ 不是靠「文件里提到某词」。
② 的成因与 ① **不同形**：① 说的是**调用点缺**（n=4），② 说的是**原语被分叉**（包装不再委托）—— 夹具断言 ② 的 stderr 不含 ① 的 token（`assert.doesNotMatch`）。
正控制：未突变 root ⇒ `OK — one shared store-commit primitive (commitStoreWrite + delegating commitKindFile) and 5/5 store kinds wired to it (module dependency + call site each)`，`EXIT=0`。

### AC3 —— 正控制：`quay goal gate AC-197` 在真实树上 exit 0

```
$ node packages/quay/bin/quay.js goal gate AC-197
{
  "id": "AC-197",
  "verdict": "pass",
  "cause": null,
  "reason": "acceptance passed (exit 0)",
  "timeoutMs": 60000,
  "timestamp": "2026-10-12T18:09:26.728Z",
  "dryRun": false,
  "event": { "actor": "goal-cli", "verdict": "pass",
             "payload": { "reason": "acceptance passed (exit 0)",
                          "evaluationRoot": "…/quay-worktrees/gap-ac197-criterion-commitstorewrite-identifier-pin-stale",
                          "treeSha": "04b97218cfa0e02375c1ce370ba2d2a6c95fd18e" } }
}
EXIT=0
```

### AC4 —— 保证为真的直接量：五 kind 真实写盘往返

**tasks**（本任务自身的 ABI 写入 ⇒ `tasks/*.md` 的 store-commit 形状提交，于主检出 `author`）：

```
$ git log -1 --format='%h %s' -- tasks/gap-ac197-criterion-commitstorewrite-identifier-pin-stale.md
32a13d897 tasks: gap-ac197-criterion-commitstorewrite-identifier-pin-stale task_write by cli:3474421
$ git show author:tasks/gap-ac197-…md | grep -c '^- \[x\]'
6
```

**goals**（新 criterion 的落库 ⇒ `goals/*.md` 的 store-commit 形状提交）：

```
$ git log -1 --format='%h %s' -- goals/AC-197-*.md
33e76b8a7 goals: AC-197 field:criterion,expect,origin by cli:3180872
```

**meta / adr / docs-managed** —— 各在**独立 `git init` 过的临时 root** 里驱动一次真实 `write()`（`createMetaStore` / `createAdrStore` / `createDocumentStore`），贴提交与干净工作树读数：

```
--- meta         root /tmp/ac197-ac4-meta-*     commit 5c82a6f meta: META-001 create by cli:3315476
                 stat meta/META-001-ac197-five-kind-wiring-probe.md | 8 ++++++++
                 status --porcelain meta : ""          (空 = 干净)
--- adr          root /tmp/ac197-ac4-adr-*      commit 8676900 adr: ADR-001 create by cli:3315476
                 stat adr/ADR-001-ac197-five-kind-wiring-probe.md | 7 +++++++
                 status --porcelain adr : ""           (空 = 干净)
--- docs-managed root /tmp/ac197-ac4-doc-*      commit 475e8d6 docs-managed: DOC-001 create by cli:3315476
                 stat docs-managed/DOC-001-ac197-five-kind-wiring-probe.md | 9 +++++++++
                 status --porcelain docs-managed : ""  (空 = 干净)
```

⛔ 未向本仓塞入任何假的 adr / docs-managed 载体 —— 三个 kind 的载体都在私有 mkdtemp root 内创建、跑完即删。「谓词绿」与「保证为真」是两件事：上面三条各是**一次真实 add+commit** 的产物，不是 grep 回声。

### AC5 —— 不回归 + 结构零回退

```
$ bash scripts/test.sh --for-task gap-ac197-criterion-commitstorewrite-identifier-pin-stale --allow-thin
SCOPED_GATE_EXIT=0     （夹具 7/7 pass：正控制 2 + 负控制 4 + 不回退守卫 1；9 条 static check 全 PASS）
```

⚠️ **AC5① 逐字（不带 `--allow-thin`）的读数是 exit 1，如实写出**：

```
$ bash scripts/test.sh --for-task gap-ac197-criterion-commitstorewrite-identifier-pin-stale
… （夹具 7/7 pass 照跑）
scripts/test.sh: --for-task … — test-selection-thin (selector exit 1); re-run with --allow-thin to suppress
EXIT=1

$ node --no-warnings --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --root <wt> --task gap-ac197-…
task gap-ac197-…: 1 test file(s)
  packages/quay/test/ac197-criterion-five-kind-wiring.test.mjs
unresolved (2):
  goals/AC-197-kind-tasks-goals-meta-adr-docs-managed-commitstorewrite-5.md — no */test/<goal-basename>.test.mjs found
  tasks/gap-ac197-criterion-commitstorewrite-identifier-pin-stale.md — no */test/gap-ac197-….test.mjs found
coverage: 0.33 (1/3 Touches resolved)
test-selection-thin: … resolved tests for 1/3 Touches entries (0.33) < 0.5; pass --allow-thin to run anyway
SELECTOR_EXIT=1
```

⇒ 这是**选择层**的拒绝（Touches 里两条是 goal / task 文件，按 basename 找不到同名测试 ⇒ 覆盖率 0.33 < 0.5 阈值），⛔ **不是测试失败**：同一命令照跑了选出的 7 个用例且全绿。该阈值对**本任务 Touches 的既定形态**（goal 文件 + 任务文件 self-touch）结构性必然触发，与本次改动无关；`--allow-thin` 正是 driver fan-in 自己用的旗标（`scripts/test.sh:1693` 的注释与 fan-in 调用同源）。⇒ AC5① 按字面在本 Touches 下不可满足；本条按 **fan-in 实际执行的那条命令**（`--allow-thin`）判绿，并把逐字读数与成因留在这里，⛔ 不作静默替换。

$ grep -c 'function commitKindFile' packages/quay/src/goal-store.ts packages/quay/src/meta-store.ts \
        packages/quay/src/adr-store.ts packages/quay/src/document-store.ts
packages/quay/src/adr-store.ts:0
packages/quay/src/document-store.ts:0
packages/quay/src/goal-store.ts:0
packages/quay/src/meta-store.ts:0          ← 四份 per-kind 拷贝未被恢复
$ grep -c 'export function commitKindFile' packages/quay/src/store-commit.ts
1                                          ← 包装仍只有一处
```

附带（⛔ 不在 AC 内，仅确认未回退 943ef47f6）：`packages/quay/src/store-commit.ts` 里 `do not "restore" a per-kind prefix here` 的禁令注释仍在（`grep -c` = 1）。

### AC6 —— 新指纹落账（`payload.criterionHash`）

修前（**生产** checkout `/data/home/yale/work/quay` 台账，逐字）：

```
{"id":"e8559bfa-…","item_id":"AC-197","gate":"goal","actor":"goal-sweep","verdict":"fail",
 "timestamp":"2026-10-12T17:51:11.915Z",
 "payload":{"reason":"acceptance failed (exit 1) — CAUSE=commitStoreWrite-not-in-all-5 — 经 commitStoreWrite 提交的 store 文件数 n=1 ≠ 5（…）",
            "criterionHash":"5a7dc1fc29c3b9a3","evaluationRoot":"/data/home/yale/work/quay","treeSha":"4656ab15…"}}
```

修后（本 worktree 台账尾事件，同一次 `goal gate` + 有界轮转步之后）：

```
$ node packages/quay/bin/quay.js goal gate AC-197
$ node packages/quay/bin/quay.js goal check --stale-pass --sweep --budget 1
{"frozenScope":171,"evaluated":true,"failing":[],"staleUnverified":[],
 "notEvaluated":[],"verifiedFresh":["AC-197"],"amendedUnverified":[],…}   EXIT=0

{"id":"3fa37ce7-…","item_id":"AC-197","gate":"goal","actor":"goal-amend","verdict":"pass",
 "timestamp":"2026-10-12T18:10:51.860Z",
 "payload":{"reason":"acceptance passed (exit 0)","criterionHash":"1e3db4143593300b",
            "evaluationRoot":"…/quay-worktrees/gap-ac197-criterion-commitstorewrite-identifier-pin-stale",
            "treeSha":"04b97218cfa0e02375c1ce370ba2d2a6c95fd18e"}}
```

⇒ 尾事件 `verdict:"pass"` 且 `criterionHash = 1e3db4143593300b` **≠ `5a7dc1fc29c3b9a3`**。

第二次真跑（同一会话末、最终 HEAD 上重取一次，证明它是**可复算的**而非一次性读数）：

```
$ node packages/quay/bin/quay.js goal gate AC-197
"verdict": "pass",   "timestamp": "2026-10-12T18:17:59.250Z"
$ node packages/quay/bin/quay.js goal check --stale-pass --sweep --budget 1
{"frozenScope":171,"evaluated":true,"failing":[],"staleUnverified":[],"verifiedFresh":["AC-197"],…}   EXIT=0

{"id":"13e3a754-…","item_id":"AC-197","gate":"goal","actor":"goal-amend","verdict":"pass",
 "timestamp":"2026-10-12T18:17:59.781Z",
 "payload":{"reason":"acceptance passed (exit 0)","criterionHash":"1e3db4143593300b",
            "evaluationRoot":"…/quay-worktrees/gap-ac197-criterion-commitstorewrite-identifier-pin-stale",
            "treeSha":"2d91e4120efc57567e445e9048900ceee4ba48da"}}   ← = 本轮最终 HEAD 的 tree
```

两次独立真跑给出**同一个新指纹** `1e3db4143593300b`（≠ 旧 `5a7dc1fc29c3b9a3`）。

**⚠️ 三条如实说明（都不影响上述读数为真，但不写就是隐藏）：**

0. **这两行是「取数当时」的读数，本 worktree 台账随后被 `refresh-worktree-quay.sh` 覆盖。** 该脚本由 `scripts/test.sh:283` 调用，把**生产 checkout 的 `.quay/` 整份拷进** worktree（clobber，非 no-clobber）⇒ 本会话随后按 AC5 要求跑 scoped 门时，上面两条事件所在文件被换成了生产台账的拷贝（实测：AC-197 尾事件变回 `2026-10-12T18:15:13.364Z / fail / 旧文本`，`grep -c 3fa37ce7…` = 0）。⇒ 上述两行**逐字留在本任务体内**（本文件才是持久载体），⛔ 且本 worktree 台账此刻**不是**本条的证据面。同族先例与同款处置：`gap-ac289-criterion-cmdline-port-literal-stale`（其台账被快照覆盖过两次，读数同样转存到任务体）。⛔ 复算方式写在这里：把生产台账里 AC-197 的全部事件拷进任一 root 的 `.quay/gate-events.jsonl`，再跑上面两条命令。

1. **`criterionHash` 不是 `goal gate` 写的。** 实测 `goal gate` 事件（`actor: goal-cli`）的 payload 只有 `reason` / `evaluationRoot` / `treeSha`；`payload.criterionHash` 只由**轮转**路径写（`sweepFrozen`，`packages/quay/src/goal-store.ts:2438/2477`）。所以本条的读数由「一次 `goal gate` + 一次有界 `check --stale-pass --sweep --budget 1`」共同产出 —— 后者正是 DoD2 所指的「`criterionHash` 与修订前不同」的那个写者。⛔ 一条 dry-run 输出**不算**，本次两条都是真跑（`dryRun: false`）。
2. **worktree 台账不是持久证据。** 轮转的**修订优先**路径要求该 AC 已有一条**带旧 hash** 的轮转事件（`amendedIds`，`goal-store.ts:2334-2360`）；本 worktree 的台账原本是空的，故先把**生产台账里 AC-197 的 381 条真实历史事件逐字**（含 `e8559bfa` 那条旧 hash 轮转事件）落在本 worktree 台账里，再跑上述两步。持久的那份是**生产 checkout** 的台账：重锚版 `goals/AC-197-*.md` 随 fan-in 落进 develop、`syncDevelopToDoc` 进生产 checkout 后，**生产轮转按同一条修订优先路径**机械地把尾事件翻成新 hash 的 pass —— 与同族 `gap-ac289-criterion-cmdline-port-literal-stale` 记录的收敛形态相同（其 AC6 亦按此读法）。

---

### 第 4 轮（2026-10-13）—— criterion 的「为什么改」注释不再逐字引用旧谓词，AC1 的读数这才真正成立

**为什么还要再动一次**：第 1–3 轮把 AC1 的读数写成**文件级** `grep -c 'grep -l commitStoreWrite' goals/AC-197-*.md` ⇒ 0，**实测为 2**（一处在 criterion 的「为什么改」注释里逐字引用旧谓词，一处在同一记录的 `origin` 里）。那是一句**一条命令即可证伪**的读数（硬规则 2：引用一个计数前先打印它命中到的实际内容）。AC1 自己的口径是「**criterion 正文**里命中 1 → 0」，而当时 criterion 内仍有 1 处 ⇒ **AC1 的读数当时为假**。

**修法**（⛔ 不是放宽判据、⛔ 不是把字面量塞回四个 store 文件）：只把 criterion 里那句注释由**逐字引用**旧谓词改为**描述**它；旧谓词逐字仍留在同一记录的 `origin` 字段（审计面未丢）。同族先例 `gap-ac297-criterion-cmdline-port-literal-stale`：重锚块保留 `grep -oE`，但删掉被 pin 的字面量 `--port [0-9]+`。

```
                             criterion 字段   origin 字段   文件级
改前（第 3 轮末，旧谓词所在的那句注释）        1              1            2
改后（本轮）                                   0              1            1   ← 只剩 origin，那是它该在的地方
$ node packages/quay/bin/quay.ts goal show AC-197 --json   # criterion 计数，逐字复算方式
```

**落库（⛔ 经 `quay goal write`，非手工 Edit）**：

```
$ node packages/quay/bin/quay.ts goal write AC-197 --criterion "$(cat /tmp/ac197-crit-new.txt)" \
      --origin "$(cat /tmp/ac197-origin-keep.txt)" --root <wt>
wrote AC-197
$ git show --stat 5a04e28fa | tail -2
 goals/AC-197-kind-tasks-goals-meta-adr-docs-managed-commitstorewrite-5.md | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)          ← 只有 criterion / origin 两个键
```

读回**逐字节相同**（`goal show --json` 的 `criterion` 与源文本 `EQUAL: True`）⇒ YAML `>-` 折行标量没有损坏脚本；`status: achieved` / `kind: criterion` / `goal: GOAL-008` 逐字未动。

**配套夹具同步**：`93c2650aa test(ac197): keep the fixture comment true after the criterion rationale stopped quoting the old predicate verbatim` —— 夹具里那句「the block's own COMMENT quotes the old text verbatim」在改动后不再成立，改为「**describes** …；逐字的旧谓词在 `origin`」。断言本身**按位置**判定（只剔除 `#` 行），⛔ 判定强度未变；夹具重跑仍 **7/7 pass**。

**本轮新读数（同一时刻 —— **合并 develop 之后的最终树**）**：HEAD `d629c20c6171dee452c70383a865d17f89564496` / tree `edb378445acbe5c6613b18f7d005384d76a9dd93`；develop tip `fa76ebca6a0177e0d82cfe4573946df980385d3f`（本节首次测量时 develop 还是 `1d05f47e…`，中途前进 5 个提交 ⇒ 已 `git merge develop` 后**重测全部读数**，下表是重测值；⛔ 不是拿旧读数配新缓存）。

| 项 | 命令 | 读数 |
|---|---|---|
| AC3 正控制 | `quay goal gate AC-197` | `verdict=pass`，`EXIT=0`，`2026-10-12T18:26:53.787Z`，`actor=goal-cli`，`evaluationRoot` = 本 worktree |
| AC6 新指纹 | `quay goal check --stale-pass --sweep --budget 1` | `EXIT=0`；`sweep.ran=[{"id":"AC-197","verdict":"pass",…}]`；台账尾事件 `2026-10-12T18:26:57.799Z`（`id` 前缀 `c7900ac5`）/ `verdict:"pass"` / `actor:"goal-amend"` / `treeSha:"edb378445acb…"`（= 上表 HEAD 的 tree） / **`criterionHash:"ce927a78256e078f"` ≠ `5a7dc1fc29c3b9a3`** |
| AC2 负控制① | 临时 root：`meta-store.ts` 去掉全部调用点、**保留** `import … from "./store-commit.ts"` | `CAUSE=store-commit-call-site-missing-in-all-5 — 依赖并调用共享原语的 store 文件数 n=4 ≠ 5（五种 kind：tasks/goals/meta/adr/docs-managed）`，`EXIT=1` |
| AC2 负控制② | 临时 root：`commitKindFile` 函数体改为 `return "unchanged";`（第二套并行原语） | `CAUSE=second-primitive — commitKindFile 未委托 commitStoreWrite（出现第二套并行原语）`，`EXIT=1` —— 与①**不同形** |
| AC2 正控制 | 未突变临时 root | `OK — one shared store-commit primitive (commitStoreWrite + delegating commitKindFile) and 5/5 store kinds wired to it (module dependency + call site each)`，`EXIT=0` |
| AC5① | `bash scripts/test.sh --for-task gap-ac197-… --allow-thin` | `SCOPED_GATE_EXIT=0`，夹具 7/7 pass；**输出无 `SCOPED-THIN` 标记** ⇒ 真评了 ≥1 个文件，⛔ 不是 thin 假绿（`parseScopedThin` 的三态） |
| AC5② | 四份 per-kind 拷贝 + 唯一包装 | `grep -c 'function commitKindFile'` 四个 store 全 **0**；`grep -c 'export function commitKindFile' packages/quay/src/store-commit.ts` = **1** |
| 预合并（1c） | `anti-drift-touches-check.ts --task … --worktree <wt> --merge-target develop` | `ANTI-DRIFT OK: … 3 actual file(s), all within declared Touches (3 glob(s))`，`EXIT=0` |
| scoped 门缓存（1b-iv） | `worker-driver.ts --write-scoped-gate-cache --task … --develop-sha fa76ebca… --root /data/home/yale/work/quay` | `{"event":"scoped-gate-cache-written",…,"developSha":"fa76ebca6a0177e0d82cfe4573946df980385d3f","cacheFile":"/data/home/yale/work/quay/.quay/scoped-gate-cache.json"}` ⇒ 键 = `(task, developTip)`，fan-in 对**同一 develop tip** 可证冗余而跳过 |

⚠️ **本轮的 `ce927a78256e078f` 与第 3 轮记录的 `1e3db4143593300b` 不同，不是矛盾**：第 3 轮之后 criterion 文本又被改过一次（即本轮的注释改写），指纹随文本而变，正是它应有的行为。两者都 **≠ 修复前的 `5a7dc1fc29c3b9a3`**。

⚠️ **台账仍是 worktree 本地那一份**（`refresh-worktree-quay.sh` 的 clobber，见上文第 0 条）。本轮的**顺序**已按此安排：先跑 scoped 门（它会 clobber `.quay/`），**再**跑 `goal gate` + 有界轮转，⇒ 退出时台账尾事件就是上表那两条（`18:26:53` pass / `18:26:57` pass+新 hash）。持久收敛走同一条路径：重锚版随 fan-in 落 develop ⇒ `syncDevelopToDoc` ⇒ 生产轮转按**修订优先**路径把生产台账尾事件翻成新 hash 的 pass（与 `gap-ac289-…` 记录的收敛形态相同）。

**本轮删除了两份重复的 `## Evidence` 块（落点映射，硬规则 5）**：原文件有 **3** 份 `## Evidence`（起于第 113 / 269 / 447 行），逐块 diff 显示第 3 块是前两块的**严格超集** —— `diff ev1 ev3` 仅 **2** 行删除、`diff ev2 ev3` 仅 **1** 行删除，且这三行**全部被 ev3 的扩展版取代**（`SCOPED_GATE_EXIT=0（…；9 条 static check 全 PASS）`、`两条如实说明` → `三条如实说明`）。⇒ 前两块里的**每一条**读数都在第 3 块里有落点，⛔ 无内容丢失；合并后本文件只剩一份 `## Evidence`。同一次替换也修掉了三块里**逐字重复的同一句假读数**。

**⚠️ develop 在本轮中途前进过 —— scoped 门缓存因此重写过两次。** 第一次写缓存时 develop 是 `1d05f47e…`，而 scoped 门当时跑在**以它为基**的树上；随后 develop 前进到 `fa76ebca…`（5 个提交）。缓存的前提是「worker 对着**这个确切的 develop tip** 验证过绿」，所以旧缓存**不成立**，⛔ 没有拿它凑数：先 `git merge develop`（`d629c20c…`，无冲突），**在新树上重跑** `scripts/test.sh --for-task … --allow-thin`（`SCOPED_GATE_EXIT=0`，7/7，无 `SCOPED-THIN`），**再**用新 tip 写缓存。⇒ 上表所有读数都是**重测值**，缓存里的 `developSha` 与被我验证过的那棵树一致（`rev-list --count HEAD..develop` = 0）。

### 第 4 轮（2026-10-13 02:40 +0800）—— 上一轮的 suite 红是**环境量**，随生产载体轮转消失，⛔ 不修

上一轮 `exited-not-landed` 的成因是 `plugin/test/prod-data-audit.test.mjs` 的 `ERR_STRING_TOO_LONG`（`## Blocker`）。本轮**先定性再动手**，读数：

| 问 | 读数 | 结论 |
|---|---|---|
| 失败文件在本任务 delta 内吗 | 本任务 delta 仍是 3 个文件，不含 `plugin/scripts/prod-data-audit.ts` | 不在 |
| 该夹具读的是哪棵树 | `prod-data-audit.ts:83 resolveProductionRoot` 在 linked worktree 下用 `git rev-parse --git-common-dir` 回到**主检出** | 读的是**主检出**的载体 |
| 主检出 `…/quay/.quay/meta-driver-round.jsonl` | **95,018,269 B**（02:40，且增速 ~百 B/半分钟）—— 低于 V8 上限 `0x1fffffe8` = 536,870,888 | 立案时的 537,028,872 B 已**轮转掉** |
| worktree 同名副本 | 538,347,076 B（`refresh-worktree-quay` 从主检出拷入）；`readFileSync` 仍抛 `ERR_STRING_TOO_LONG` | 与判据**无关**（判据读主检出）—— ⛔ 不要拿它当成因 |
| 直接重跑该夹具（worktree 内） | `node --test plugin/test/prod-data-audit.test.mjs` ⇒ **10/10 pass，exit 0** | 红已消失 |

⇒ 处置 = **不修**：它是 develop-wide 的真实缺口，已有 `status: ready` 的 `gap-prod-data-audit-whole-file-read-crashes-on-carrier-over-v8-string-limit`（P0，其 `## Touches` 指名该文件）在飞。在本分支修它会同时（a）越过本任务 Touches、（b）与 peer 抢同一文件、（c）把「判据读主检出」这条诊断埋掉。

### 第 4 轮重测读数（全部在 `git merge develop` 之后的新树上取）

| 项 | 命令 | 读数 |
|---|---|---|
| 合并冲突 | `git merge --no-edit develop` | 仅本任务文件一处冲突（本分支 `## Evidence` ↔ develop 的 `## Blocker`）⇒ 按**逐 hunk 并集**解：两份都留，AC tick 与 Touches 不动；`f6c5979e4`。其后 develop 再前进 1 提交，二次合并干净 |
| AC5① | `scripts/test.sh --for-task gap-ac197-… --allow-thin` | `SCOPED_GATE_EXIT=0`，夹具 **7/7 pass**（`test-selection-thin 1/3 Touches` 警告属预期，`--allow-thin` 已给） |
| 1c | `anti-drift-touches-check.ts --task … --worktree <wt> --merge-target develop` | `ANTI-DRIFT OK: … 3 actual file(s), all within declared Touches (3 glob(s))`，`EXIT=0` |
| AC5② | `grep -c 'function commitKindFile'` 四 store | goal / meta / adr / document = **0 / 0 / 0 / 0**；`grep -c 'export function commitKindFile' packages/quay/src/store-commit.ts` = **1** |
| AC4（活读，五 kind） | 逐文件核「依赖 `store-commit.ts` ∧ 出现调用」 | goal 1/3、meta 2/1、adr 2/1、document 2/1、native 3/1 ⇒ **5/5** |
| AC3 | `node packages/quay/bin/quay.js goal gate AC-197` | `"verdict":"pass"`，`GATE_EXIT=0` |
| AC6 台账（修前 → 修后） | `.quay/gate-events.jsonl` 尾行 | 修前 `2026-10-12T18:35:39.270Z fail`（`CAUSE=commitStoreWrite-not-in-all-5`，root=主检出）；修后 `2026-10-12T18:42:26.357Z pass actor=goal-amend hash=ce927a78256e078f` ⇒ **≠ `5a7dc1fc29c3b9a3`** |
| AC6 交叉核对（⛔ 非回声） | 用 `goal-store.ts:449 criterionFingerprint` 独立算 worktree goal 文件的 criterion | `ce927a78256e078f` —— 与台账写入值**逐字相同** |
| AC1 | 同一份 criterion 文本上 `grep -l commitStoreWrite` 逐字匹配 | **0 命中** ⇒ 旧谓词已不在正文（成因描述保留为叙述，不带旧谓词逐字） |
| scoped 门缓存（1b-iv） | `--write-scoped-gate-cache --develop-sha 81f9dd0e…` | `{"event":"scoped-gate-cache-written",…,"developSha":"81f9dd0e0c5895c73f855750ba5523a416a846ca"}`；写前核过 `merge-base --is-ancestor develop HEAD` **是** ∧ `rev-list --count HEAD..develop` = **0** |

⚠️ **缓存重写过一次**：第一次写入后 develop 立刻前进 1 提交，`81f9dd0e…` 已不再是 HEAD 祖先 ⇒ 按「缓存的前提是对着**这个确切 tip** 验过绿」把它作废，重跑 scoped 门 + 重写（同上一轮记录的形态）。⛔ 没有用 merge-base 凑一个「更旧的、仍然合法」的 tip 去换一次假冗余。

⚠️ **台账仍是 worktree 本地那一份**：`scripts/test.sh` 起点的 `refresh-worktree-quay` 会从主检出拷 `.quay/` 覆盖它。本轮顺序因此是「先 scoped 门（它会覆盖）→ 再 `goal gate` + `goal check --stale-pass --sweep`」，⇒ 退出时尾事件即上表那条 `18:42:26` 的 pass。持久收敛仍走落 develop ⇒ `syncDevelopToDoc` ⇒ 生产轮转的路径。

## Blocker

**2026-10-12T18:35:28.029Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: __PERFILE__ duration_ms=31274 /data/home/yale/work/quay-worktrees/gap-ac197-criterion-commitstorewrite-identifier-pin-stale/plugin/test/prod-data-audit.test.mjs passed=false end_ms=1791829892568 cpu_ms=31960.598 mem_peak_kb=1910120
- run_id：wk-prod-anchor
- session_id：bbba55c6-a9dc-49b5-b485-9b5315fe30d8
