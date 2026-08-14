---
id: gap-monitor-mount-check-stale-pids
title: monitor-mount-check.sh 报死 pid——扫描后输出前无存活复验，pids 可含已死 pid 而 mounted/targetOk 仍 true（manager 15:2xZ 报）
status: ready
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

**（monitor-mount-check.sh 报死 pid——manager 2026-08-14 15:2xZ 报，outer 核实）**。

**现场**：`monitor-mount-check.sh --json` 曾报 `mounted=true targetOk=true pids=[779887, 2729903]`，而 `ps -p 779887` 不存在（死 pid）、2729903 存活 26.5h。

**根因（机械）**：脚本按 `/proc/<pid>/cmdline` 扫描（:68），匹配 argv[1] basename==session-liveness.sh 后 append 进 pids（:60-92 循环）——**扫描到输出之间无 ps -p / kill -0 复验**。pid 可在扫描时存活、append 后、输出前死亡 ⇒ pids 含死 pid，而 mounted/targetOk 是扫描时算的仍 true。

**后果**：任何按 `len(pids)` 判「有几个监视器」的消费者**高报**（manager 15:2xZ 第一次读就读成「真监视器=2」真值 1）。

**⚠️ 递归形态（manager 特别记）**：今天刚发现 A0-⑤ 用进程计数错 ⇒ 改读「正确机件」monitor-mount-check ⇒ **这个「正确机件」自己不校验 pid 存活** ⇒ **换到正确机件 ≠ 机件没毛病**。

**判据1**：`pids` 数组里每个 pid 逐个校验存活（ps -p 或 /proc 存在性）——死的**剔除并单独报 `stale_pids`**。
**⛔ 不要静默剔除**（「曾经挂过但死了」与「从没挂过」同形 = C29 家族）；`stale_pids` 是独立取值。
**判据2（能取假·真样本不构造）**：pids 里的每个 pid 必须 `ps -p` 得到——现 779887 取不到 ⇒ 假；修后死 pid 进 stale_pids 不进 pids。
**判据3**：mounted/targetOk 基于【存活 pid 集】判定（不是含死 pid 的扫描集）。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改「扫描 /proc 匹配 argv[1]」的匹配逻辑本身（那是 AC1/AC2 的正确部分）；不削弱不自匹配判据。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 monitor-mount-check.sh 的 pids 收集循环（:60-92）+ mounted/targetOk 判定。
2. 判据1：pids 逐个存活校验，死 pid → stale_pids 独立报。
3. 判据2 能取假：死 pid（如 779887 形态）回放红。
4. 判据3：mounted/targetOk 基于存活集。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：pids 逐个存活校验，死 pid → stale_pids 独立报（不静默剔除）。
- [ ] AC2 判据2 能取假：死 pid 回放红（现 pids 可含死 pid）。
- [ ] AC3 判据3：mounted/targetOk 基于存活 pid 集。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] monitor-mount-check 输出前复验 pids 存活（死 pid → stale_pids）+ mounted/targetOk 基于存活集。

## Touches

- plugin/scripts/monitor-mount-check.sh（输出前 ps -p 复验，stale_pids 独立字段）
- plugin/test/monitor-mount-check.test.mjs（补测：死 pid 进 stale_pids）
- tasks/gap-monitor-mount-check-stale-pids.md（自身）

## Evidence

（落地后回填——manager 15:2xZ 实测 pids=[779887,2729903]，779887 不存在；outer 复跑当前仅 [2729903]）
