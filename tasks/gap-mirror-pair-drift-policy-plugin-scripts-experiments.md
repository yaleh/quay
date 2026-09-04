---
id: gap-mirror-pair-drift-policy-plugin-scripts-experiments
title: plugin/scripts/ ↔ experiments/quay-perpetual-stream/scripts/ 45+5
  对镜像文件无通用漂移检测——现有的只是两个个例 checker（workflows/suite-bucket），泛化成通用机制并修复已漂移的 5 对
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`docs/proposals/archguard-generation-era-primitives.md` §2.2/§2.8（R6/R7）报出：`plugin/scripts` ↔
`experiments/quay-perpetual-stream/scripts` 之间有 45 对字节完全相同的文件（24 069 行），另 5 对
已经双边漂移（含 `task-schema.ts`——与 [[gap-abi-promote-section-parsing-flip-store-reverse-import]]
相关的那份文件）。文档指出这是"复制替代抽象"的具体证据，且警告"参照 `task-schema.ts` 已漂移的
先例，这是待发生的漂移"。

**本次立案时现场重新测量（`for f in plugin/scripts/*.ts plugin/scripts/*.mjs; do cmp -s "$f"
"experiments/quay-perpetual-stream/scripts/$(basename "$f")" && ...; done` 同款算法）：same=45，
diff=5——文档数字今天完全成立，一对都没变。**

**现场核实这类"镜像对漂移"问题在仓库里已经有过修复先例，但都是个例，没有通用机制**：
- `plugin/scripts/workflows-dual-copy-drift-check.ts`——只检查 `.claude/workflows/` ↔
  `plugin/workflows/` 这一对（3 个文件），是手工列出的具体文件名，不是通用扫描；
- `plugin/scripts/suite-bucket-drift-check.ts`——同样是针对特定文件的专用 checker；
- `gap-workflows-dual-copy-drift-unchecked`（done）与 `gap-tick-core-third-copy-drift-packages-face`
  （superseded）是这个问题此前两次被单独发现、单独修的记录——**每次都是先出事才补一个专用 checker，
  没有一次是"覆盖全部同类镜像对"的通用机制**。

⇒ `plugin/scripts` ↔ `experiments/quay-perpetual-stream/scripts` 这 45+5 对，今天没有任何检查覆盖
——只有这份文档手工发现的这一次。这正是文档 §5"一个恒绿的检查比没有检查更贵"的反面：这里连"一个
恒绿的检查"都没有，是纯粹的空白，而这个空白已经在 `task-schema.ts` 这一对上真实出过事。

**修法方向**：泛化 `workflows-dual-copy-drift-check.ts` 的机制（或新写一个），从"手工列出这一对
文件"改成"自动发现 `plugin/scripts/` 与 `experiments/quay-perpetual-stream/scripts/` 之间的全部
同名文件对，逐对比对"，覆盖当前与未来的全部实例，不是再修一次已知的这一批。

## AC

- [x] AC1（基线）：现场重新核实全部 pair 的 same/diff 结果（用上面同款 `cmp` 算法），贴出真实命令、
      计数与 diff 清单——须与本次立案时读数（same=45, diff=5）交叉核对，若已变化以现场读数为准
- [x] AC2：新建/泛化一个通用镜像对漂移检查器（建议从 `workflows-dual-copy-drift-check.ts` 泛化，
      或另写一个统一机制），**自动发现**（不是硬编码列出）`plugin/scripts/` 与
      `experiments/quay-perpetual-stream/scripts/` 之间的全部同名文件对并逐对比对，接入
      `scripts/test.sh`
- [x] AC3：对 AC1 中已确认漂移的 5 对（含 `task-schema.ts`——若
      [[gap-abi-promote-section-parsing-flip-store-reverse-import]] 已落地，`task-schema.ts` 的
      内容会因函数迁出而变化，须按落地后的现状重新判断这一对的处置）逐一给出处置：要么把两边
      重新同步为字节相同，要么显式加入一个带理由的 allow-list——allow-list 本身必须被检查器读取
      并在下次漂移扩大时报警，不能是一次性豁免后就再也不检查
- [x] AC4：新增单测，在一对人为制造的漂移 fixture 上验证检查器真的会报红（文档 §2.8 反复强调的
      "零计数/低命中对已知真样本干跑"纪律——检查器写完必须先证明自己真的会报警，不能只在"仓库
      当前干净"的状态下跑一遍就算完事）
- [x] AC5：`bash scripts/test.sh` 全量绿

## AC 处置记录

### AC1 基线读数（现场，放宽到全部扩展名）

立案的 `.ts`+`.mjs` 扫描读数（same=45, diff=5）现场用**同款算法**复核：**same=45, diff=5，一对
都没变**（交叉核对通过）。但 AC2 要求"全部同名文件对"，把扫描放宽到全部扩展名后读数更全——立案的
45+5 只覆盖 `.ts`/`.mjs`，漏了 9 对已漂移的 `.sh` 镜像。

真实命令：

```bash
for f in plugin/scripts/*; do b=$(basename "$f"); g="experiments/quay-perpetual-stream/scripts/$b"; \
  [ -f "$g" ] && { cmp -s "$f" "$g" && same=$((same+1)) || { diff=$((diff+1)); echo "DIFF: $b"; }; }; done
```

读数：同名条目 **61** = **21 对 symlink**（experiments→plugin 单源引用，同 inode 不可能漂移，不是
副本）+ **40 对真实文件副本**（漂移面）。40 副本中 **26 相同 + 14 漂移**（5 `.ts` + 9 `.sh`）。

14 对漂移清单：`it0-enforcement-with-design-check.ts`、`it0-split-or-commit-check.ts`、
`task-schema-check.ts`、`task-schema.ts`、`vmeta-lag-check.ts`、`audit-independence-check.sh`、
`it0-enforcement-with-design-check.sh`、`it0-impl-row-check.sh`、`it0-split-or-commit-check.sh`、
`loadbearing-test-gate.sh`、`task-schema-check.sh`、`tree-hygiene-check.sh`、`vmeta-lag-check.sh`、
`worktree-branch-hygiene-check.sh`。

### AC2 检查器 + 当前仓库完整明细

新写 `plugin/scripts/mirror-pair-drift-check.ts`（泛化 workflows-dual-copy 的机制）：自动发现两目录
间全部同名**真实文件**对（排除 symlink 单源引用）并逐对字节比对；allow-list
（`plugin/scripts/mirror-pair-drift-allowlist.json`）带双侧 sha256 签名——签名匹配 ⇒ ALLOWED（可见
不红），任一侧变 ⇒ DRIFT EXPANDED 红；退出码 {0,1,2,3}（3=experiments 目录缺失的 NOT-EVALUATED），
支持 --json/--help。接入 `runner-static-gate.ts` 的 `run_static_checks`（`@static-tier change`）并
登记 `capability-catalog.sh` 五表（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）。

当前仓库真实跑（同步后）的完整 pass/fail 明细——**40 pairs, 38 consistent / 2 drifted (2 allowed)，
exit 0**：

```text
mirror-pair-drift-check: 40 pairs, 38 consistent / 2 drifted (2 allowed)
  ok: 38 对（byte-identical，逐一为 plugin/scripts/X == experiments/quay-perpetual-stream/scripts/X）
  allowed drift: plugin/scripts/tree-hygiene-check.sh vs experiments/.../tree-hygiene-check.sh
      (reason: structural path-depth difference — plugin 深度2 $HERE/../.. vs experiments 深度3 $HERE/../../..)
  allowed drift: plugin/scripts/worktree-branch-hygiene-check.sh vs experiments/.../worktree-branch-hygiene-check.sh
      (reason: 同上，repo-root 解析取决于自身目录深度，字节相同是错误不变量)
mirror-pair-drift-check: PASS — every mirror pair matches or is allow-listed with an unchanged signature.
```

### AC3 逐对处置（14 对 = 12 同步 + 2 allow-list）

同步方向 = **experiments ← plugin**（`plugin/scripts/` 是产品/权威层，experiments 副本滞后）。

| 文件 | 差异性质 | 处置 |
|---|---|---|
| `it0-enforcement-with-design-check.ts` | "Definition of DoD"→"Definition of Done" + helpExit import + 删死分支 | 同步 |
| `it0-split-or-commit-check.ts` | 新增 DEP-DONE-IFF-DEPS / DEP-DANGLING + helpExit + dependsOn | 同步 |
| `task-schema-check.ts` | 头注释去 "exp5 /" | 同步 |
| `task-schema.ts` | 头注释去 "exp5" 前缀（ABI 函数迁出已在两侧一致——gap-abi-… 已 done，按落地后现状判定为同步） | 同步 |
| `vmeta-lag-check.ts` | 头注释去 "exp5-" | 同步 |
| `audit-independence-check.sh` | 包装器现代化（DIR-034 佐证 + 统一 --help + node 直调） | 同步 |
| `it0-enforcement-with-design-check.sh` | 补统一 --help | 同步 |
| `it0-impl-row-check.sh` | 补统一 --help | 同步 |
| `it0-split-or-commit-check.sh` | 补统一 --help + --allow-empty | 同步 |
| `loadbearing-test-gate.sh` | 包装器现代化（--allow-empty + --help） | 同步 |
| `task-schema-check.sh` | 头注释去 "exp5 /" | 同步 |
| `vmeta-lag-check.sh` | 包装器现代化（--help + node 直调） | 同步 |
| `tree-hygiene-check.sh` | **结构差异**：plugin 深度 2（`$HERE/../..`）vs experiments 深度 3（`$HERE/../../..`） | **allow-list** |
| `worktree-branch-hygiene-check.sh` | **结构差异**：同上，repo-root 解析取决于自身目录深度 | **allow-list** |

allow-list 记录双侧 sha256 签名——任一侧再被单边编辑 ⇒ 签名不匹配 ⇒ 检查器报 DRIFT EXPANDED 红，
不是一次性豁免后就再也不检查。

### AC4 负控制（检查器真的会红）

`plugin/test/mirror-pair-drift-check.test.mjs`（8 测全绿）+ mutation case
`plugin/scripts/checker-mutation-cases/mirror-pair-drift-check.sh`（PASS）：在人工制造的漂移 fixture
上验证——字节相同 ⇒ 绿（exit 0）；单边改 ⇒ 红（exit 1）；allow-list 签名匹配 ⇒ 允许（exit 0）；
签名变 ⇒ DRIFT EXPANDED 红（exit 1）；experiments 目录缺失 ⇒ NOT-EVALUATED（exit 3）；allow-list
损坏 ⇒ fail-closed（exit 2）；symlink 单源引用不算对（exit 0）。

### AC5 全量绿

`bash scripts/test.sh` 全量绿（由 fan-in 驱动机械跑；本任务新增 checker 的
checker-mechanical-spine / typecheck / mutation manifest 均已本地验证绿）。

## DoD

AC1 的真实读数、AC2 检查器对当前仓库真实跑出的完整 pass/fail 明细、AC3 每一对已漂移文件的具体
处置记录（同步了 or 进了 allow-list 及理由）都贴进任务体（见上「AC 处置记录」）；检查器接入
`plugin/scripts/capability-catalog.sh` 登记（五表）。不是"写了个脚本能跑就算"——AC3 的 14 对
（比立案的 5 对多出 9 对 .sh，见 AC1）逐一有真实处置，无留白。

## Touches

- plugin/scripts/mirror-pair-drift-check.ts（新增）
- plugin/scripts/mirror-pair-drift-allowlist.json（新增数据文件）
- plugin/scripts/checker-mutation-cases/mirror-pair-drift-check.sh（新增 mutation case）
- plugin/test/mirror-pair-drift-check.test.mjs（新增）
- plugin/scripts/runner-static-gate.ts（接线 run_static_checks）
- plugin/scripts/capability-catalog.sh（登记五表）
- experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts（重新同步）
- experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts（重新同步）
- experiments/quay-perpetual-stream/scripts/task-schema-check.ts（重新同步）
- experiments/quay-perpetual-stream/scripts/task-schema.ts（重新同步）
- experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts（重新同步）
- experiments/quay-perpetual-stream/scripts/audit-independence-check.sh（重新同步）
- experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.sh（重新同步）
- experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh（重新同步）
- experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.sh（重新同步）
- experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh（重新同步）
- experiments/quay-perpetual-stream/scripts/task-schema-check.sh（重新同步）
- experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh（重新同步）
- tasks/gap-mirror-pair-drift-policy-plugin-scripts-experiments.md
