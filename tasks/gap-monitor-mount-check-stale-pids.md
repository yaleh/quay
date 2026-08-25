---
id: gap-monitor-mount-check-stale-pids
title: monitor-mount-check.sh 报死 pid——扫描后输出前无存活复验，pids 可含已死 pid 而
  mounted/targetOk 仍 true（manager 15:2xZ 报）
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
> **RETREATED / 搁置（done 但 AC1-4 全未勾 + 生产复现原症状：manager 实测 monitor-mount-check --json 报 pids=[122043,474265] stale_pids=[]（机件自称两 pid 都活），手动 ps -p 复核 474265 已死——stale_pids 漏报死 pid，正是 AC1 要防的「静默剔除」。重开重做 + 重勾 AC。）**

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

- [x] AC1 判据1：pids 逐个存活校验，死 pid → stale_pids 独立报（不静默剔除）——`pid_alive` 读 `/proc/<pid>/stat` 的 state 字段，state=Z（僵尸）判死，死 pid 单独进 `stale_pids`；测试 `stale-pids AC1/AC3`（死 pid 进 stale_pids 不进 pids）+ `mixed`（活 pid 留 pids、死 pid 进 stale_pids）。
- [x] AC2 判据2 能取假：死 pid 回放红——真实僵尸回放测试 `stale-pids AC2 — a REAL zombie (state=Z) is judged stale`：创建真实僵尸（state=Z），`--probe-alive` 判 `stale`，且断言 `/proc/<zombie>` 仍存在（旧 `os.path.exists` 会误判 alive——正是 2026-08-14 生产复现 `pids=[122043,474265] stale_pids=[]` 而 474265 已死的机制根因）。
- [x] AC3 判据3：mounted/targetOk 基于存活 pid 集——`live_targets` 只含 `pid_alive` 为真的 pid；测试断言唯一监视器死亡 ⇒ mounted=false/targetOk=false，≥1 活 ⇒ mounted=true。
- [x] AC4 既有测试全绿 + `--for-task` scoped 门绿——`node --test plugin/test/monitor-mount-check.test.mjs` 15/15 绿；`scripts/test.sh --for-task gap-monitor-mount-check-stale-pids` 退出码 0（scoped 静态检查全 PASS + 15 测试全绿）。

## Definition of Done

- [x] monitor-mount-check 输出前复验 pids 存活（死 pid → stale_pids）+ mounted/targetOk 基于存活集——`pid_alive` 读 `/proc/<pid>/stat` state（!=Z 才算活），死 pid（含僵尸）→ `stale_pids` 独立字段，mounted/targetOk 基于 `live_targets`；真实僵尸回归测试 + 15/15 测试绿。

## Touches

- plugin/scripts/monitor-mount-check.sh（输出前 stat state 复验，stale_pids 独立字段）
- plugin/test/monitor-mount-check.test.mjs（补测：真实僵尸回放 → stale_pids）
- tasks/gap-monitor-mount-check-stale-pids.md（自身）

## Evidence

（2026-08-25 回填）
- 根因确认：`os.path.exists(/proc/<僵尸 pid>)` 对 state=Z 的僵尸返回 True（实测 `os.path.exists: True`、`stat state: Z`），旧复验把僵尸当活——`ps -p` 判死、/proc 存在性判活，正是 2026-08-14 manager 报 `pids=[122043,474265] stale_pids=[]` 而 474265 已死的机制成因。
- 修法：`pid_alive` 改为读 `/proc/<pid>/stat` 的 state 字段（`!= b"Z"` 才算活，stat 读不到 → 死）；僵尸 cmdline 为空、进不了扫描集，故加 `--probe-alive <pid>` 接缝把真实僵尸 pid 喂给同一个 `pid_alive`（生产不设 → 行为不变）。
- 测试：`node --test plugin/test/monitor-mount-check.test.mjs` → 15 pass / 0 fail（含 2 条新僵尸回归测试）。
- scoped 门：`scripts/test.sh --for-task gap-monitor-mount-check-stale-pids` → 退出码 0（全部 scoped 静态检查 PASS + 15/15 测试绿）。
