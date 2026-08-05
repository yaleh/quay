---
id: gap-full-suite-runner-concurrency-default-and-gate
title: full-suite-runner laneCount default hardcoded 8 (not nproc-derived) +
  --test-concurrency splice is append-not-replace + resource-gate never called —
  ABORT#5 (=8 =8, PSI 88, WAIT-start) same crash class as ABORT#1/3/4; fix all
  three in ONE change
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**ABORT #5（2026-08-05 10:2xZ，管理者紧急报警 + 外层核实）**：外层启动 full-suite-runner 验证套件，
实测进程是 `node --test --test-concurrency=8 --test-concurrency=8`（**两个 8**）——外层显式传 8，
test.sh 又拼接自己的默认 8。有效并发 8（nproc=4，AC5 派生默认应为 1）。PSI cpu 88、resource-gate
WAIT、load 15.77，**正是 ABORT #1/#3/#4 与两次整机崩溃的同一形态**。已立即中止。

**根因（管理者 09:03Z 预警的兑现 + 延伸）**：
1. `full-suite-runner.ts` 的 laneCount 默认硬编码 8（第 32 行注释「default: 8 (canonical full-suite
   concurrency)」），**没读 nproc 派生**——本机 nproc=4，AC5 的派生默认 `max(1,floor(nproc/2.1))=1`
   才对。AC16 只修了「显式传参不生效」，没修「默认值本身是 8」。
2. **拼接是 append 不是 replace**：`--test-concurrency=<N>` 追加到命令尾，与命令里已有的
   `--test-concurrency=*` 并存。node 取最后一个（AC17 记录过），但两个值都合法时无判据发现退化。
3. **resource-gate 从未被调用**：`full-suite-runner.ts` 里 resource-gate 出现 0 次（管理者 07:5x 已报），
   gate 说 WAIT 也没人问它——本轮就是在 WAIT 状态下开跑的。

**管理者的建议（三条应同一次改动做完，只做任一条都会留缝——今晚已证明两次）**：
1. runner 的 laneCount 默认值应**读 nproc 派生**（同 test.sh 的 AC5 派生），不硬编码 8
2. 拼接应是**替换**而非追加：先剥掉命令里已有的 `--test-concurrency=*` 再拼
3. 启动前过一次 resource-gate（WAIT 则不开跑，等下一 tick）

### 选定机制

1. runner 默认 laneCount = `max(1, floor(nproc / 2.1))`（同 test.sh AC5 派生），可被 `--lane-count` 覆盖
2. splice 改为 replace：先正则剥命令里已有 `--test-concurrency=*`（含 `=` 与空格两种拼写），再拼新值
3. 起跑前调 `bash plugin/scripts/resource-gate.sh --for full-suite`，非 0 = WAIT → 不启动，等下一 tick
4. 三条同一次改动 + 测试覆盖（既有 full-suite-runner.test.mjs 扩展）

## Acceptance Criteria

- [ ] AC1: runner 默认 laneCount 读 nproc 派生（nproc=4 → 1），无 `--lane-count` 时生效并发 = 1
- [ ] AC2: splice 是 replace——命令里已有 `--test-concurrency=8`（`=` 与空格拼写）时被替换为派生值，进程只出现一个 `--test-concurrency=<派生>`
- [ ] AC3: 起跑前过 resource-gate，WAIT 时不启动（state 保持 running/green 不动）
- [ ] AC4: `full-suite-runner.test.mjs` 扩展覆盖三行为（负控制：显式 8 + 已有 `=8` → 替换为派生值）

## Touches

- plugin/scripts/full-suite-runner.ts
- plugin/test/full-suite-runner.test.mjs
- tasks/gap-no-resource-awareness-heavy-ops-run-blind.md（AC3 交叉标注）
- tasks/gap-full-suite-belongs-to-outer-background-above-3-min.md（AC16 交叉标注）

## Contract

measure   effective_concurrency = `ps -e -o args | grep -o -- '--test-concurrency=[0-9]*' | wc -l` stdout 数字段（应=1 且值为派生）
band      effective_concurrency = 1（派生值，无重复拼接）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check`
control   显式传 `--lane-count 8` 且命令已含 `=8` ⇒ 进程只出现一个 `=8`（replace 生效）
resume    三条修改分步提交，任一步完成即写盘