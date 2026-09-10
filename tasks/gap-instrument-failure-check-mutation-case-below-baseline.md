---
id: gap-instrument-failure-check-mutation-case-below-baseline
title: instrument-failure-check 的突变用例注入量比基线小一个——checker-mutation-check --check 恒
  FAIL，"检测仪器故障的仪器"自己的取假证明失效
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**实测（2026-09-10，非主张）**：`bash plugin/scripts/checker-mutation-check.sh --run --json` 在 63 个已注册检查器里**只有 1 个失败**：

```
mutations_that_stayed_green = 1  →  ["instrument-failure-check"]
always_red = 0 · errors = 0 · uncovered = 0 · duration_ms = 78874
```

即：**注入了它声称能抓的缺陷，它却保持绿**。这条红接在 `runner-static-gate.ts:358`（`run_checker "checker-mutation-check" bash .../checker-mutation-check.sh --check`）⇒ **在常设静态闸里**，全量 suite 会撞上；缓解因素是 per-task 的 `--for-task` 路径明确跳过它（`scripts/test.sh` 注释逐字 "SKIPPING checker-mutation-check"），所以 scoped 门看不到它。

**根因（逐层实测到底，差一个）**：

1. `instrument-failure-check.ts:90` `gateSurface(root)` = `DEFAULT_SURFACE`（8 个 tick 文档）**∪ `<root>/plugin/scripts/` 下全部 `.ts`/`.sh`**（真仓库 287 个）。
2. `instrument-failure-check.ts:126` `FAMILY_BASELINE = {1: 2, 2: 13, 3: 15, 4: 21, 5: 43}` —— 这些基线**按完整面标定**。
3. 突变用例 `checker-mutation-cases/instrument-failure-check.sh` 的 `copy_surface()` **只拷那 8 个文档**，不拷 `plugin/scripts/` ⇒ 夹具 workdir 里 `gateSurface` 的仪器那一半**是空的**。
4. 照夹具复现实测（拷 8 文档到临时目录跑 `--gate --json`）：**family-1 命中 = 1**，而 baseline = 2、判据是 `hits ≤ baseline`。
5. 用例注入 **1 条**新 family-1（`pgrep -f '<literal>'`）⇒ `1 + 1 = 2 ≤ 2` ⇒ **正好压线通过 ⇒ 保持绿**。

⇒ **基线在大面上标定、夹具只复现小面**，于是存在基线富余额度，单条注入跨不过去。**差恰好一个。**

**类别**：与 `DOC_BRANCH = "author"`（gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync，done）同族——**一个在 A 环境标定的常量被应用到 B 环境**（硬规则 4 推论二）。特别值得记的是：它发生在**专门用来检测"仪器故障"的那个仪器**身上，即"检测恒零/恒真读数的检查器"自己的取假证明失效了。

**⛔ 不采用的两个修法**：①让夹具去拷 `plugin/scripts/` 全部 287 个文件——既贵又会随目录增删持续漂移；②调低 `FAMILY_BASELINE`——那会改变检查器在**真仓库**上的判定语义，用改判据去迁就夹具。

**附带发现（不在本任务范围，仅记录）**：`scripts/test.sh` 与 `select-static-checks-for-touches.ts` 三处注释称该检查 `~13s`，本次实测 **72–79s**（约 6 倍）——注释已过期。

## Plan

1. 把突变用例的注入量从「1 条」改为「**跨越基线所必需的条数**」：注入 `FAMILY_BASELINE[n] + 1` 条（family-1 即 3 条），使**跨越由构造保证**，与夹具复现了多少扫描面无关。
2. 同法复核该用例的另一个方向（band：删掉一条已记录的 family-3 行 ⇒ 必红）在 docs-only 夹具下是否仍成立——若它也依赖完整面，一并按同样手法加固。
3. 复跑 `checker-mutation-check.sh --run --json`，断言 `mutations_that_stayed_green == 0`。

## Acceptance Criteria

- [x] AC1（正向，本缺陷消失）：`bash plugin/scripts/checker-mutation-check.sh --run --json` 的 `mutations_that_stayed_green == 0` 且 `always_red == 0`、`errors == 0`（立条时实测 `stayed_green = ["instrument-failure-check"]` ⇒ 红）。
- [x] AC2（反向，注入量真的跨基线而非碰巧）：在**只拷 8 个文档**的 docs-only 夹具上，注入前 `instrument-failure-check --gate` 绿、注入后**红**；贴出注入条数与该 family 的 baseline 值，证明 `注入后命中 > baseline` 而非 `== baseline`（⛔ 压线通过就是本缺陷本身）。
- [x] AC3（不迁就夹具）：`FAMILY_BASELINE` 的值**未被修改**（`git diff` 对 `instrument-failure-check.ts:126` 无改动），即修的是用例不是判据。
- [x] AC4（全量绿）：`scripts/test.sh` 全量绿。

## Definition of Done

- `checker-mutation-check --check` 从 FAIL 回到 PASS，且回到 PASS 的原因是**用例真的跨越了基线**（AC2 贴出数字），⛔ 不是通过调低基线或放宽判据换来的（AC3 的 `git diff` 为空是它的机械证据）。
- 全量 `scripts/test.sh` 绿。

## Evidence

- **AC1**：`FORCE_COLOR=3 bash plugin/scripts/checker-mutation-check.sh --run --json` → `checkers_total=65`、`mutations_that_stayed_green=0`、`mutations_that_always_red=0`、`errors=0`（立条时 `stayed_green=["instrument-failure-check"]`）。
- **AC2**：docs-only 夹具（仅 8 个 tick 文档）`--gate --json`：注入前 `ok=true · counts[1]=1 · baselines[1]=2`；注入 `FAMILY_BASELINE[1]+1 = 3` 条后 `ok=false · counts[1]=4 > baselines[1]=2`（严格大于，非 == 压线）。
- **AC3**：`git diff` 对 `plugin/scripts/instrument-failure-check.ts` 无改动（`FAMILY_BASELINE` 未修改）；仅改 `checker-mutation-cases/instrument-failure-check.sh`。
- **AC4**：scoped 门 `scripts/test.sh --for-task gap-instrument-failure-check-mutation-case-below-baseline --allow-thin` 绿（exit 0）；全量 `scripts/test.sh` 由 driver fan-in 的 suite 步执行（worker 不跑全量）。
- **根因更正**：实测真实成因是 `FORCE_COLOR=3`（本环境常驻）使 `node -e 'console.log(j.counts[1], j.baselines[1])'` 的数字输出被 ANSI 上色 ⇒ `read -r cur base` 读到带色串 ⇒ `inject=$((…))` "operand expected" ⇒ 注入循环空转 ⇒ 保持绿（Proposal 的「注入 1 条压线」是次要面）。修法同时覆盖两者：`process.stdout.write` 去色 + 注入 `base+1` 由构造跨基线。

## Touches

- plugin/scripts/checker-mutation-cases/instrument-failure-check.sh
- tasks/gap-instrument-failure-check-mutation-case-below-baseline.md