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

- [ ] AC1（基线）：现场重新核实全部 pair 的 same/diff 结果（用上面同款 `cmp` 算法），贴出真实命令、
      计数与 diff 清单——须与本次立案时读数（same=45, diff=5）交叉核对，若已变化以现场读数为准
- [ ] AC2：新建/泛化一个通用镜像对漂移检查器（建议从 `workflows-dual-copy-drift-check.ts` 泛化，
      或另写一个统一机制），**自动发现**（不是硬编码列出）`plugin/scripts/` 与
      `experiments/quay-perpetual-stream/scripts/` 之间的全部同名文件对并逐对比对，接入
      `scripts/test.sh`
- [ ] AC3：对 AC1 中已确认漂移的 5 对（含 `task-schema.ts`——若
      [[gap-abi-promote-section-parsing-flip-store-reverse-import]] 已落地，`task-schema.ts` 的
      内容会因函数迁出而变化，须按落地后的现状重新判断这一对的处置）逐一给出处置：要么把两边
      重新同步为字节相同，要么显式加入一个带理由的 allow-list——allow-list 本身必须被检查器读取
      并在下次漂移扩大时报警，不能是一次性豁免后就再也不检查
- [ ] AC4：新增单测，在一对人为制造的漂移 fixture 上验证检查器真的会报红（文档 §2.8 反复强调的
      "零计数/低命中对已知真样本干跑"纪律——检查器写完必须先证明自己真的会报警，不能只在"仓库
      当前干净"的状态下跑一遍就算完事）
- [ ] AC5：`bash scripts/test.sh` 全量绿

## DoD

AC1 的真实读数、AC2 检查器对当前仓库真实跑出的完整 pass/fail 明细、AC3 每一对已漂移文件的具体
处置记录（同步了 or 进了 allow-list 及理由）都贴进任务体；检查器接入
`plugin/scripts/capability-catalog.sh` 登记。不是"写了个脚本能跑就算"——AC3 的 5 对必须逐一有
真实处置，不能留白。

## Touches

- plugin/scripts/mirror-pair-drift-check.ts（新增，或改造 workflows-dual-copy-drift-check.ts 的
  机制使其可复用/泛化）
- plugin/scripts/task-schema.ts（若判定需要重新同步）
- experiments/quay-perpetual-stream/scripts/task-schema.ts（若判定需要重新同步）
- plugin/test/mirror-pair-drift-check.test.mjs（新增）
- plugin/scripts/capability-catalog.sh（登记新脚本）
- tasks/gap-mirror-pair-drift-policy-plugin-scripts-experiments.md
