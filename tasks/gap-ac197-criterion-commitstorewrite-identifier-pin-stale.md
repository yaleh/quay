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

- [ ] **AC1（承载体已重锚且不减强度）**：`goals/AC-197-*.md` 的 criterion 不再要求五个 store 文件出现字面量 `commitStoreWrite`，改为结构谓词（① 原语模块 `store-commit.ts` 同时导出 `commitStoreWrite` 与委托它的 `commitKindFile`；② 五个 store 文件各自依赖 `store-commit.ts` 且出现一次对共享原语的调用）。读数：重锚前 criterion 正文里 `grep -l commitStoreWrite` 命中 1 处，重锚后 0 处；贴 `git diff`，只有谓词块与「为什么改」变化。⛔ 除非经 `quay goal write` 落库否则不算。
- [ ] **AC2（判据能取假 —— 两个负控制，成因不同形）**：① 五个 store 文件之一去掉调用、只留 import ⇒ `quay goal gate AC-197` 非 0 且以具名 `CAUSE=` 可区分；② 临时副本上 `commitKindFile` 改为不委托 `commitStoreWrite` ⇒ 非 0 且成因与 ① **不同形**。两条均贴退出码与逐字 stderr。⛔ 不得靠放宽谓词（把「调用」降成「提到」）凑绿。
- [ ] **AC3（正控制）**：`node packages/quay/bin/quay.js goal gate AC-197` ⇒ **exit 0**，逐字贴出。
- [ ] **AC4（保证为真的直接量 —— 五 kind 真实写盘往返）**：tasks 与 goals 用本仓真实写入各取一条提交 —— 本任务的 `task_write` 与新 criterion 的 `goal write` 各自产生一条 `tasks/*.md` / `goals/*.md` 的 store-commit 形状提交（贴 `git log -1 --format='%h %s'`）；meta / adr / docs-managed 在 `git init` 过的临时 root 里各驱动一次真实写入，贴各自提交 sha + 消息，并核对 `git status --porcelain <dir>` 为空。⛔ 「谓词绿」与「保证为真」是两件事，本条只认后者；⛔ 不得向本仓塞入假的 adr / docs-managed 载体。
- [ ] **AC5（不回归 + 结构零回退）**：① `bash scripts/test.sh --for-task gap-ac197-criterion-commitstorewrite-identifier-pin-stale` 退出码 0；② `grep -c 'function commitKindFile' packages/quay/src/goal-store.ts packages/quay/src/meta-store.ts packages/quay/src/adr-store.ts packages/quay/src/document-store.ts` 全为 0，且 `grep -c 'export function commitKindFile' packages/quay/src/store-commit.ts` = 1（四份拷贝未被恢复、包装仍只有一处）。
- [ ] **AC6（新指纹落账）**：台账 `.quay/gate-events.jsonl` 中 `item_id=AC-197` 的末条为 `verdict:"pass"`，且其 `payload.criterionHash` ≠ `5a7dc1fc29c3b9a3`（贴修前 / 修后两行）。

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