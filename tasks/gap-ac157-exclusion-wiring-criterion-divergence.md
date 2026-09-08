---
id: gap-ac157-exclusion-wiring-criterion-divergence
title: AC157 判据仍红——两个排除面（runtime-usage-inventory.ts / scripts/test.sh）非注释行无字面
  archive/ 引用
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-157
---
## Proposal

**问题（立案当轮实测）**：`goals/AC-157-archive-mechanism-exclusion-wiring.md`（status=active、goal=GOAL-003）的判据现为 fail（exit 1）。判据两段：① `archive/INDEX.tsv` 表头恰 7 个 tab 字段——**已过**（`head -1 archive/INDEX.tsv | awk -F'\t' '{print NF}'` = 7）；② 五个排除面各自在【非注释行】含字面 `archive/`。实测五面结果：

- ✅ `plugin/scripts/capability-catalog.sh`（2 处非注释 `archive/`）、`plugin/scripts/laydown-set-check.sh`（1 处）、`scripts/version-consistency-check.ts`（1 处）——**已过**。
- ❌ `plugin/scripts/runtime-usage-inventory.ts`——archive 排除写成了 `SKIP_DIR_NAMES` 里的 basename `"archive"`（无斜杠），全文无字面 `archive/` 子串；**且该文件夹带 2 个嵌入 NUL 字节**：`globMatch` 里 `*` 的哨兵被腐成 `\0`（原意是 `@`，见第 767 行 `.map((c) => (c === "*" ? "\0" : …))` 与第 769 行 `.replace(/\0/g, …)`），使 `file` 判 `data`、grep 判 binary ⇒ 判据的 `grep -vE … | grep -q 'archive/'` 管道即便有子串也读不到行。
- ❌ `scripts/test.sh`——archive 过滤写成 awk 正则 `$1 !~ /(^|\/)archive\//`（`\/` 是 awk 转义，字面文本是 `archive\/` 反斜杠+斜杠），非注释行无字面 `archive/`。

**关联任务**：`gap-archive-mechanism-and-exclusion-wiring`（done）建了机制并接了三面，但（a）从未带顶层 `goal_ac: AC-157`（故 goal-driver 视 AC-157 无人认领），（b）这两面的接线形式与判据的字面 `archive/` grep 不一致。本任务**只补这两面的判据一致性 + NUL 修复**，不重做机制、不移动死集（那是 AC158）。

**修法（最小面）**：① `runtime-usage-inventory.ts` 把 2 个 NUL 哨兵还原为 `@`（行为不变：`*`→`@`→`[^/]*`），并在非注释代码里以字面 `archive/` 表达 archive 排除（如 `relPath === "archive" || relPath.startsWith("archive/")` 的显式跳过，或等价形式），保持功能不变。② `scripts/test.sh` 把该 awk 过滤改写为含字面 `archive/` 的等价形式（如双引号 awk 正则 `$1 !~ "(^|/)archive/"` 或 shell `case`/`grep -v 'archive/'`），过滤语义不变。③ 全程不碰 AC 记录本体、不改 INDEX 表头。

## AC

- [x] AC1 判据取真（AC-157 自己的判据，goal-driver 下一轮独立复核并翻 pass）：`head -1 archive/INDEX.tsv | awk -F'\t' '{print NF}'` ⇒ 7，且五个文件（capability-catalog.sh / runtime-usage-inventory.ts / test.sh / laydown-set-check.sh / version-consistency-check.ts）各自 `[ -e "$f" ]` 为真、`grep -vE '^[[:space:]]*(#|//|\*)' "$f" | grep -q 'archive/'` 为真——整段 bash ⇒ exit 0
- [x] AC2 NUL 修复：`grep -cP '\x00' plugin/scripts/runtime-usage-inventory.ts` ⇒ 0，且 `file plugin/scripts/runtime-usage-inventory.ts` 不再报 `data`、grep 不再报 `binary file matches`
- [x] AC3 两面字面引用：`for f in plugin/scripts/runtime-usage-inventory.ts scripts/test.sh; do grep -vE '^[[:space:]]*(#|//|\*)' "$f" | grep -qF 'archive/'; done` ⇒ exit 0
- [x] AC4 行为不变：archive 排除功能与 globMatch `*` 语义未被改坏——`runtime-usage-inventory.test.mjs` 与 `archive-exclusion-wiring.test.mjs` 仍全绿（经 `scripts/test.sh` 的 engine 组跑法，或 fan-in 的 suite 步机械验证）
- [x] AC5 能取假：临时撤掉任一面改动（如把字面 `archive/` 改回 `archive`/`archive\/`）⇒ AC1 判据 exit 非 0（证明判据测的是真接线，不是恒真）
- [x] AC6 `node plugin/scripts/task-schema-check.ts tasks/gap-ac157-exclusion-wiring-criterion-divergence.md` ⇒ exit 0

## DoD

AC-157 判据在 goal-driver 下一轮由 fail 翻 pass（读 `.quay/goal-round.jsonl` 该 AC 的 verdict），且达成靠的是两面的**真排除**——archive/** 功能接线未动、`archive-exclusion-wiring.test.mjs` 五个撤排除即红负控制仍绿 + `runtime-usage-inventory.test.mjs` 仍绿——不是往文件里塞一行无功能的 `archive/` 字符串来糊判据。⛔ 只修 NUL 而没让两文件非注释行含字面 `archive/`，或只塞关键词而破坏功能，均不算达成。

## Touches

- plugin/scripts/runtime-usage-inventory.ts
- scripts/test.sh
- plugin/test/runtime-usage-inventory.test.mjs
- plugin/test/archive-exclusion-wiring.test.mjs
- tasks/gap-ac157-exclusion-wiring-criterion-divergence.md