---
id: gap-idle-watch-intent-anchor-restore
title: idle-watch 冷启动锚点 idle-watch-mount.txt 缺席而另一条检查的绿掩盖它（manager 09:1xZ 报，判法归 outer）
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

**（idle-watch 冷启动锚点缺席——manager 2026-08-14 09:1xZ 报；判法(a)归 outer 已定）**。

**缺陷**：manager 层 A19①（`manager-tick-core.md:35` 逐字「idle-watch 挂载意图在位(`<home>/idle-watch-mount.txt` 存在)」）要测的锚点文件**不存在**，而它的缺席被另一条检查的绿掩盖：
```
ls -la /home/yale/.quay-global/manager/   ⇒ 只有 cron-evidence.jsonl / identity / loop-registry.txt / projects.tsv
                                          ⇒ idle-watch-mount.txt 不存在（cold-start-checklist.md / idle-watch.env 也在）
monitor-mount-check.sh --json             ⇒ mounted=true targetOk=true（Monitor 实例 pid=2729903 活 20h09m）
```
**危害在方向**：A19① 测的是冷启动锚点（下一次 `/clear` 后靠它知道该挂什么）。它缺席与「冷启动根本没做」在输出上完全同形；同时 A10② 报绿（真挂载在位）⇒ **每轮读到一个绿，而那个绿不覆盖 A19① 要测的东西**——硬规则 3b 的镜像形态（缺席被另一条检查的绿掩盖）。

**⚠️ 根因线索（outer 09:1xZ 查 + manager 09:2xZ 更正 ×2，实现须先确诊再改）**：`manager-start.sh:244` 的 `cat > "$IDLE_WATCH_INTENT"` 在主路径里**无条件**（非 dry-run/非 check 路径都执行；:205 会话 in-place 不提前退出）。**更正 ①**：`loop-registry.txt` 是**共享容器**（`manager-arm-loop.sh` 每轮都写它，:96/:218）——mtime 对「manager-start 跑没跑过」**零信息**（硬规则 5；09:12 是 manager 跑 arm-loop 写的）。**更正 ②**：`identity`(:161) 也是**创建一次**（:160 `if [ ! -f "$IDENTITY" ]`）⇒ 其 mtime 结构上不可能取到「又跑了一次」（硬规则 4）——不是 last-run 读数。**⇒ 主路径最后运行时刻 = 未知**（该 home 下四文件无一可作 last-run 读数：loop-registry 共用容器 / identity 创建一次 / cron-evidence 他脚本产物 / projects.tsv 写入方待定；硬规则 6：缺值=未查，不是没跑过）。**① 的取证方式限定为【读 :161→:244 实际路径】或【实跑一次看文件出不出来】，禁止用 mtime 推断。诊断拆两问，先问 ① 再问 ②**：
```
① identity(:161) 写在 :244 之前 ⇒ 「写到 identity 而没到 :244」= early-exit，无删除者
   —— 最省的解释；查 :161 到 :244 之间有没有提前退出路径（如 :219 tmux 创建失败 exit 1）
② 仅当 ① 排除（主路径确实到过 :244 且写了文件）后，才查删除者
   —— 一次性人工/脚本清理（$HOME_DIR 在家目录下，无系统清理器）
```
**实现第一步 = 按①→② 顺序确诊，再修。**

**判据（outer 裁定 (a)——修根，不修读）**：
- **判据1**：锚点文件可靠在位——`manager-start.sh`（或其 cadence 路径）每次运行都重写 `idle-watch-mount.txt`，且不受后续清理影响（或清理明确豁免它）。**修根（a）**：让锚点恢复可用；(b)（给 A19① 一个「未评估」独立取值）只让 manager 不再误读、不修根——**不用 (b) 掩盖，缺席是真实异常**。
- **判据2**：确诊根因并写明（主路径 cadence / 谁在清理）——写进 Evidence。
- **判据3 能取假**：复现路径——`bash plugin/scripts/manager-start.sh`（主路径）后 `idle-watch-mount.txt` 存在；再过一个 cadence（或跑清理方）后仍存在。修复前现状 = 缺席（真样本）。

**止损（C21，manager 09:1xZ）**：不需要——理由读数：真挂载在位（mounted=true targetOk=true，实例 20h09m）⇒ 当前观测能力无缺口；缺的只是下一次冷启动的锚点。**结论绑该组读数**：若 Monitor 实例消失或 mounted=false，须立即重判为「需要」。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 确诊根因（按①→② 顺序）：① `identity`(:161) 到 `:244` 之间的 early-exit 路径；② 仅①排除后查删除者。**不用 `loop-registry.txt` mtime 作证据**（共享容器，manager-arm-loop 每轮写）。
2. 判据1：锚点可靠在位——每次主路径运行重写 + 不受清理影响（或清理豁免）。
3. 判据2：根因写明进 Evidence。
4. 判据3 能取假：主路径后文件存在 + 过 cadence 后仍存在（现状=缺席为真样本）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：锚点文件可靠在位（主路径每次运行重写 + 不被清理/清理豁免）；A19① 可满足。
- [ ] AC2 判据2：根因确诊并写明（① early-exit 或 ② 删除者，二选一按序），进 Evidence。
- [ ] AC3 判据3 能取假：主路径后文件存在、过 cadence 后仍存在；修复前现状（缺席）为真样本回放。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] idle-watch-mount.txt 可靠在位（根因确诊 + 重写/豁免清理）+ A19① 可满足 + 真样本回放。

## Touches

- plugin/scripts/manager-start.sh（锚点重写/豁免——具体按根因诊断）
- plugin/scripts/（若根因是清理脚本——其豁免或调用方）
- tasks/gap-idle-watch-intent-anchor-restore.md（自身）

## Evidence

（落地后回填）
