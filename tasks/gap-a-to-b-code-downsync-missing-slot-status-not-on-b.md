---
id: gap-a-to-b-code-downsync-missing-slot-status-not-on-b
title: "NO A→B code downsync mechanism — B machine is running stale quay code
  and re-enters A's earlier blind spot (--slot-status missing on B: grep -c
  slot-status B's fast-mode-telemetry.ts=0, B telemetry shows 5 in-flight
  brackets indistinguishable real vs stale, no tool to verify; A resolved this
  exact blind spot hours ago via --slot-status/gap-telemetry-brackets; AC15
  criterion ③ only covers B→A BACKUP direction (quay-sync.git = B pushes to A),
  NO A→B code downsync; manager B-machine measurement 2026-08-06 04:1xZ; SAME
  CLASS as archguard config-preserving (improved mechanisms don't reach running
  downstream) but DIFFERENT mechanism (repo-layer cross-machine sync vs
  install-layer upgrade), filed separately + cross-ref"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**A→B 代码下行同步缺失——B 机跑的是 A 几小时前的代码，重入 A 已解决的盲区。**

**【实测（管理者 B 机，2026-08-06 04:1xZ）】**：`--slot-status`（telemetry-brackets 修复，A 机 commit
1724e7fd）**没传播到 B 机**——B 机 `grep -c slot-status fast-mode-telemetry.ts = 0`。B 机现在处于
A 机几小时前同样的盲区：遥测显示 5 个在飞括号，**无法区分真实执行者与陈旧账面**（B 机 pane 只显示
1 个 agent，但没有工具能验证另外 4 个是不是真的已完成）。资源闸（resource-gate.sh）在 B 机是同步的、
干净的（GO），**只是这个可观测性工具没跟上**。

**【外层核实】A→B 下行机制不存在**：manager-phase-goal.md 只记录「A 机直推 B 机裸仓库 3326 提交」的
**一次性**同步（历史事件），无常驻下行。`~/work/quay-sync.git` 是 B→A 备份方向（b-machine-push-backup，
AC15 判据③ = B 最新提交 vs 裸仓库差值），**反向（A master → B）无机制**。A 机 `--slot-status` 已 git
tracked（fast-mode-telemetry.ts 6 处命中），但 B 机不 pull 就拿不到。

**【同族但不同机制——单独立案】**：与 archguard config-preserving（gap-quay-init-config-preserving-
incremental-upgrade）同类——「改进的机制不会自动到达已在跑的下游」。但机制不同：
- archguard = **安装层升级**（quay-init --loop 通道停/毁 config）
- B 机 = **仓库层跨机同步方向缺失**（无 A→B 下行）
修复路径不同（跨机同步机制 vs 安装升级入口），单独立案 + 交叉标注。

### 选定机制

1. **补 A→B 代码下行**：A 机（或 B 机定时）`git fetch` A 的 master 到共享裸仓库的某分支/或 B 机直接
   pull A 可达的 remote——让 B 机代码跟上 A。与 b-machine-push-backup（B→A 备份）对称。
2. **B 机 `--slot-status` 落地**：下行机制生效后 B 机重跑 telemetry-brackets 的槽位视角，
   区分真实/陈旧括号。

## Acceptance Criteria

- [ ] AC1: A→B 代码下行机制落地——B 机代码跟上 A master（`--slot-status` 出现在 B 的
       fast-mode-telemetry.ts）
- [ ] AC2: B 机槽位视角可用——`--slot-status` 在 B 机能区分真实执行者 vs 陈旧括号（B 遥测
       不再 5 个在飞无法区分）
- [ ] AC3: 与 AC15（manager-phase-goal）交叉标注——AC15 判据③只覆盖 B→A 备份方向，本任务补
       A→B 下行方向
- [ ] AC4: 与 gap-quay-init-config-preserving-incremental-upgrade 交叉标注——同族（改进机制不到达
       下游）不同机制（仓库层 vs 安装层）

**needs-human 时效性分诊关闭（2026-08-09，outer 依人裁定执行；判定：withdrawn in body (2026-08-06): frame corrected, narrow A→B downsync superseded by gap-two-peer-quay-developers-continuous-bidirectional-merge.）**
全文见 git 历史（`git log -p -- tasks/gap-a-to-b-code-downsync-missing-slot-status-not-on-b.md`）。

## Touches

- plugin/scripts/（A→B 下行同步脚本，与 periodic-push-backup.sh 对称）
- orchestration/manager-phase-goal.md（AC15 判据③扩展或新增下行判据）
- tasks/gap-b-machine-periodic-push-backup-to-bare-repo.md（AC3 交叉标注，对称方向）
- tasks/gap-quay-init-config-preserving-incremental-upgrade.md（AC4 交叉标注）

## Contract

measure   b_has_slot_status = `grep -c 'slot-status' <B机 fast-mode-telemetry.ts>` stdout 数字段
band      b_has_slot_status >= 1（B 机工具跟上 A）
invoke    `grep -rn 'A→B\|下行\|downsync\|fetch.*master' plugin/scripts/ orchestration/manager-phase-goal.md`
control   B 机遥测可区分真实/陈旧括号（AC2）；AC15 判据③仍覆盖备份方向（AC3）
resume    下行脚本与 AC15 扩展分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T04:2xZ
changed: 管理者 B 机实测立案——--slot-status 未传播到 B，B 重入 A 已解决的盲区。外层核实 A→B
下行机制不存在（AC15 只覆盖 B→A 备份）。同族（archguard config-preserving）不同机制（仓库层 vs
安装层），单独立案 + 交叉标注。

## 撤回（2026-08-06 04:5xZ，外层——框架更正，人指出问题更大）

**本任务撤回（status: needs-human），不按此窄框架立案。** 管理者更正：人指出问题不是「A 的进展能到 B」
单向，而是「**两台机器上的 quay 项目都能持续应用最新版本，并在最新版本上继续开发**」——**对称的**。
且更深一层：A、B 都在独立开发 quay 本身（不是 quay 装给下游，是 quay 开发它自己），**谁的版本对谁是
权威的「最新」没定义清楚**——不像 archguard「quay 稳定发布、archguard 下游消费」的单向关系。

**外层理解（供裁定参考）**：这可能不是 config-preserving（安装态套壳）能解决的——是两个**对等**的
quay 开发者需要**持续合并彼此进展**。claim-task.sh / branch-model 已朝这个方向做了机制（任务认领、
integration 分支），但**只做了任务认领，没做双向代码合并**。原窄任务（--slot-status 单点缺失）是
这个大问题的一个症状，撤回独立立案。

**替代**：见 `gap-two-peer-quay-developers-continuous-bidirectional-merge`（另立，替代本任务）。
本任务标记 needs-human 存档（框架更正留痕），不按原范围派发。
