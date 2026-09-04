---
id: gap-ac66-ac-driven-behavior-change-verifiable
title: AC66 AC/任务驱动的行为变更必须可检查确认（前向、不追溯；产物可独立于文本验证）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC66（AC/任务驱动的行为变更必须可检查确认 —— 人 2026-08-14 03:2xZ 裁定，并修正了 manager 03:1xZ 的切法）判据（phase-goal 逐字）**：

**⚠️ 切法修正的教训（写进 AC 正文留档）**：manager 最初按【义务形态】切（「周期性义务 23 条」），**人按【变更来源】切（AC/任务驱动 vs 自主）**。实测三个实证（A22 主线程 10 次 / checker 接线 4 天未接 / AC58 R01 撤销固化）**全部落在人的切法里、一个都不落在 manager 的**；manager 那 23 条里大量是【自主写下】的（「每轮必跑的读数」…）按人的原则不需要产物 ⇒ 原范围多要了。**⇒ 教训：一个看起来合理自洽的切法，可以在真实样本上零命中——切法必须拿实例检验，不能只看它自不自洽。**

- **判据1（范围·按来源，前向不追溯）**：**只覆盖【AC 或任务驱动的行为变更】**——某条 AC 的判据要求的、或某个任务的 Touches 落地的行为规则改动。**明确不覆盖【任务外的自主行为变更】**——三层仍可直接改自己的行为文档、当轮生效不立任务（orchestrator-tick-core.md:98 既有快路径保持不变）。**前向生效，不追溯**（同 AC47「前向闸不追溯，也不该被读成追溯过」）。
- **判据2（可检查确认的产物）**：一个 AC/任务驱动的行为变更，**必须能独立于「文本已改」回答"它生效了吗"**。两个已验证样板：**A22 ⇒ tick-log 读数行必须带 agent 标识**（不是"核里写了要用 subagent"）；**接线 ⇒ 它必须出现在 run_static_checks 列表**（不是"注释里写了必须接"）。**⚠️ 产物必须是「本来就要写的东西」，不得是新增打卡动作**（A0b⑤(b) 教训：原版「跑机件前先打印 Usage 行」因产物无人再用被连续 4 轮跳过）。
- **判据3（能取假·用真样本，不构造）**：**A22 那 10 次主线程调用即现成的真实缺席样本**（文本已改而行为未变）⇒ **回放它必须报红**。合 D2；亦满足 AC49 判据1「从未在真实样本上红过的检查不算判据」。
  **第二枚真实缺席样本（A16 派发记录写入端缺失，2026-08-14，inner 核 + 本任务 判据2 的 A16 义务产物）**：同一派发动作里 A16b（dispatch-record）写了、A16（workflow-events）漏了——AC56/61/62 派发但 `.workflow-events/fm-<id>*` 零文件（AC57 有 1）。**机械判据（无外部判定、无盲区）**：`git worktree list | grep -c quay-worktrees`（直接量，=4）vs telemetry `realInFlight`（派生量，=1）⇒ 差 3 ⇒ 报遥测缺失——**派生量必须等于直接量**，不得拿派生量当真相（与 A22 主线程样本互补：A22 是"主线程更空"盲区，这条是"派生量更少"直接可算）。**回放它必须报红；人已裁定不补记（回填 startedAtMs 是假的），只修写入端。**
  **⚠️ 样本判定的致命陷阱（manager 2026-08-14，两次误报实证）**：**当一层把工作派给 subagent 之后，从外部看它的主线程会【更空】——而"更空"与"没干活"在读数上同形。** ⇒ **越合规的层，从主线程看越像没干活**（实证：A22 subagent 跑 --apply，主线程 Bash 含 `--apply`=0，被读成"没跑"，实为"跑在 subagent 里"）。**⇒ 判据3 的样本回放若基于主线程读数，会把【合规样本】误判为【缺席样本】——判据会系统性冤枉正确行为。** 判定"缺席"必须查 subagent/workflow 内部（`ls` 定位 + `inspect_session_files --files <显式路径>`，CLAUDE.md 硬规则①），不能只读主线程 transcript。
- **⚠️ 不覆盖**：不改任何现有条款内容；不限制自主变更；不引入"每轮自检清单"这类无产物的提醒。

**本阶段自查（manager ③，判据2 的第一批对象——本阶段 13 条 AC 里含行为要求的，逐条过"生效有没有产物"）**：
```
AC62 判据1  「持锁期间不得跑 suite、不得做任何其它动作」 ← 行为要求，目前【只有要求没有产物】——AC66 第一对象
AC63 判据1  「ff 之前显式跑 doc 检查」                   ← 行为要求，产物=ff 落地时有对应 doc 检查记录（判据2 已写）
AC65 判据2  「每次直接修必须贴验证输出」                  ← 行为要求，产物=提交/投递里的实际输出（已在用）
A16 派发记录  「每次派发写 workflow-events/fm-<id>*」     ← 行为要求，产物=dispatch-record taskId 集合 vs workflow-events 文件名集合取差集非空即红（"本来就要写的两边取差集"，零额外动作，符合判据2「非新增打卡」；2026-08-14 三个缺失文件=判据3 第二样本）
```
⇒ **本任务必须给 AC62 判据1 配产物**（其余两条已自带）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 实现「AC/任务驱动的行为变更必须可检查确认」：以 A22 样板（tick-log 读数行带 agent 标识）为机制模板。
2. 给 AC62 判据1（持锁期间唯一动作=ff）配产物——独立于「文本已改」能答「生效了吗」。
3. 能取假：A22 那 10 次主线程调用回放必须报红（真样本，不构造）。
4. 本阶段自查：13 条 AC 里含行为要求的逐条过「生效有没有产物」。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：AC/任务驱动的行为变更必配产物（前向不追溯）；任务外自主变更明确不覆盖（快路径 :98 不变）。判据1 的文字已写进检查器头注释 + C17 建议（只加痕迹不改内容）；前向语义由「只判最新 A22 行」实现。
- [x] AC2 判据2：产物能独立于「文本已改」回答「生效了吗」——A22 样板（tick-log 行带 agent 标识）+ AC62 判据1 补产物。A22 样板=ac66-a22-agent-id-check.ts（判最新读数行带 agent 标识）；AC62 判据1 产物=fan-in-ff-protocol-check.ts 新增 `lock-hold-only-ff` 判据（持锁时长毫秒级，超 --max-hold-seconds ⇒ 红）。两件都是读「本来就要写的东西」（tick-log / lock-events），零新增打卡动作。
- [x] AC3 判据3 能取假：A22 10 次主线程调用（真实缺席样本）回放必须报红——不构造新数据（D2）。9 条真实缺席行 + 3 条真实合规行（逐字来自 orchestration/tick-log.md）全部回放正确（缺席 RED / 合规 GREEN），见 Evidence。
- [x] AC4 本阶段自查：13 条 AC 含行为要求的逐条过「生效有没有产物」，缺的补上。自查结论见 Evidence：AC62 判据1 是唯一「只有要求没有产物」者，本任务补上；AC63/AC65/A16 已自带产物。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。scoped 门 exit 0、doc 检查 exit 0、ts-typecheck GREEN、新增 14 条负控制全绿（见 Evidence）。

## Definition of Done

- [x] AC/任务驱动变更可检查确认机制落地 + A22 真样本回放红 + AC62 判据1 产物补齐。
- [x] 接线 + 既有测试绿。

## Touches

- orchestration/orchestrator-tick-core.md（C17：outer 专属，本任务只给改法建议、不编辑——建议文本见 Evidence）
- orchestration/manager-tick-core.md（C17：outer 专属，本任务只给改法建议、不编辑——建议文本见 Evidence）
- orchestration/fast-mode-tick-core.md（C17：outer 专属，本任务只给改法建议、不编辑——建议文本见 Evidence）
- plugin/scripts/ac66-a22-agent-id-check.ts (new)
- plugin/scripts/fan-in-ff-protocol-check.ts（新增 判据1 `lock-hold-only-ff` 持锁时长检查 + `--max-hold-seconds`）
- plugin/test/ac66-a22-agent-id-check.test.mjs (new)（负控制 fixture，A22 真样本回放）
- plugin/test/fan-in-ff-protocol-check.test.mjs（新增 判据1 负控制用例）
- plugin/scripts/checker-mutation-cases/ac66-a22-agent-id-check.sh (new)（mutation case：缺 agent 行 ⇒ 红）
- plugin/scripts/checker-mutation-cases/fan-in-ff-protocol-check.sh (new)（mutation case：300s 持锁 ⇒ 红；同时补掉 fan-in-ff-protocol-check 长期零 mutation 的既有缺口）
- scripts/test.sh（ac66-a22-agent-id-check 接线入 run_static_checks）
- plugin/scripts/capability-catalog.sh（ac66-a22-agent-id-check 入目录 + fan-in-ff-protocol-check 判据1 说明）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照派生刷新）
- tasks/gap-ac66-ac-driven-behavior-change-verifiable.md（自身）

## Evidence

**ts-typecheck（Touches 含新 .ts，必须）**：
```
fan-in-ts-typecheck-gate: task gap-ac66-ac-driven-behavior-change-verifiable — Touches cover new/moved .ts files (1); type graph changed
fan-in-ts-typecheck-gate: typecheck GREEN — ADMITTED (exit 0)
```

**scoped 门 + doc 检查**：
```
scripts/test.sh: --for-task gap-ac66-ac-driven-behavior-change-verifiable — selector selected 0 test files (thin allowed); nothing to run  → SCOPED_EXIT=0
bash scripts/test.sh --static-checks-doc → DOC_EXIT=0（tick-core-drift-check 报 3 对漂移但 --no-block 不阻塞；该漂移为既有状态，非本任务引入）
```

**判据3 A22 真样本回放（逐字来自 orchestration/tick-log.md 2026-08-14，D2 不构造）——9 条真实缺席行全部 RED、3 条真实合规行全部 GREEN**：
```
ac66-a22-agent-id-check: FAIL — all-a22-reading-lines-lack-agent-id (1 A22 reading line(s), 1 without agent id)   ← 「A22 心跳：promotions=AC76+AC77（todo→ready，fddb20b8）；pool 7/floor 20。」
ac66-a22-agent-id-check: FAIL — …(1, 1)   ← 「A22 后台心跳已跑（--cap 5 校正后 pool 7/floor 20/deficit 13…）」
ac66-a22-agent-id-check: FAIL — …(1, 1)   ← 「A22 后台 subagent 心跳：… 晋 AC73 todo→ready（416cd1d2 已提交）」（有 subagent 但 416cd1d2 是 commit SHA，非 agent id）
ac66-a22-agent-id-check: FAIL — …(1, 1)   ← 「A22 晋 AC56/AC61/AC62 ready（cbb1791e——AC55 done 解封 deps）」
ac66-a22-agent-id-check: OK — latest-a22-reading-carries-agent-id (1, 0)   ← 「本轮 A22 由后台 subagent（agentId afb5faed96138c7c6）执行，读数 POOL=4…」
ac66-a22-agent-id-check: OK — latest-a22-reading-carries-agent-id (1, 0)   ← 「A22 后台 subagent（a841b6b1db36f0098）晋 AC66 ready（6f0e6f3a）」
（单测断言：9 条缺席全 RED exit 1、3 条合规全 GREEN exit 0、`--log` fixture 最新行缺 agent ⇒ RED、最新行带 agent ⇒ PASS、无 A22 行 ⇒ NOT-EVALUATED exit 0）
```

**AC62 判据1 产物（持锁唯一动作=ff——锁事件持锁时长毫秒级）**：
```
真实锁事件（.quay/fan-in-merge-lock-events.jsonl，14 行 acquire/release 全同秒）：[lock-hold-only-ff] ok=true eval=true all-lock-holds-ms-scale
负控制（300s 持锁区间）：[lock-hold-only-ff] ok=false eval=true lock-hold-covers-non-ff-action  → exit 1
```

**新增测试**：`plugin/test/ac66-a22-agent-id-check.test.mjs` 11 条全绿；`plugin/test/fan-in-ff-protocol-check.test.mjs` 16 条全绿（原 13 + 新增 3 条判据1）。
**Mutation cases**：`checker-mutation-cases/ac66-a22-agent-id-check.sh` PASS（缺 agent 行捕获、合规行恢复）；`checker-mutation-cases/fan-in-ff-protocol-check.sh` PASS（300s 持锁捕获、ms-scale 恢复）。mutation gate uncovered 3→2（仅剩 per-task-suite-record-check / rhythm-consumer-check 两个既有缺口，归其 owning 任务）。

**接线**：`scripts/test.sh` run_static_checks 新增 `ac66-a22-agent-id-check`（@static-tier change；对象=orchestration/tick-log.md + checker 自身 + test）。worktree 内无 tick-log ⇒ NOT-EVALUATED（exit 0，硬规则 3b 独立取值）；主检出的真实 tick-log 若最新 A22 行缺 agent ⇒ RED（强制即生效）。

**本阶段自查（判据2 第一批对象——13 条 AC 含行为要求的，逐条过「生效有没有产物」）**：
```
AC62 判据1  「持锁期间不得跑 suite、不得做任何其它动作」 ← 本任务补齐：lock-hold-only-ff 判据（持锁时长毫秒级，超界 ⇒ 红）。此前【只有要求没有产物】。
AC63 判据1  「ff 之前显式跑 doc 检查」                   ← 已自带：ff 落地时有对应 doc 检查记录（AC63 判据2）
AC65 判据2  「每次直接修必须贴验证输出」                  ← 已自带：提交/投递里的实际输出（已在用）
A16 派发记录  「每次派发写 workflow-events/fm-<id>*」     ← 已自带：dispatch-record taskId 集合 vs workflow-events 文件名集合取差集非空即红（2026-08-14 三个缺失文件=判据3 第二样本；人已裁不补记）
```

**C17 建议（orchestration/ 为外层专属，本任务不编辑；三条核心各给改法建议）**：
1. `orchestration/orchestrator-tick-core.md` A22 行（:46）：在「不在主线程跑」之后加痕迹「tick-log A22 读数行必须带 agent 标识（无标识即视为未执行——ac66-a22-agent-id-check.ts 每轮判最新行）」——只加痕迹，不改 A22 的行为要求本体。
2. `orchestration/fast-mode-tick-core.md` A6 行（AC62 新协议段）：加痕迹「持锁段锁内唯一动作=ff，锁事件持锁时长毫秒级（fan-in-ff-protocol-check.ts `lock-hold-only-ff` 判据，超 --max-hold-seconds ⇒ 红）」——把 AC62 判据1 的产物位置写进执行核，后续 AC/任务驱动的行为变更照此留产物。
3. `orchestration/manager-tick-core.md`：加一条通则痕迹「本核内任何 AC/任务驱动的行为变更，必须能独立于文本回答『生效了吗』——给产物（读本来就要写的东西），不留『核里写了』这种无产物要求」——AC66 判据1/2 的执行核落点。
