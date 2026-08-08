---
id: gap-quay-init-config-preserving-incremental-upgrade
title: "quay-init --loop upgrade for EXISTING downstream consumers either STOPS
  (config-conflict: archguard's config loop values ≠ template, no mechanism
  files laid down) or DESTROYS (--force overwrites config losing loop values) —
  archguard real run 2026-08-06 01:27 (tick #114): the just-done
  delivery-surface-grows (51/51) measured drift-REPORTING, NOT the next step
  'what to do AFTER drift is reported' — criterion reports green but misses the
  next step; child (archguard adopter) discovered it in a different usage
  posture (same as the bare-✖ shape); config confirmed intact (stopped before
  writing); fix: config-PRESERVING incremental upgrade entry (backup config,
  apply mechanism files, keep config values)"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**quay-init --loop 升级对已有下游消费者：要么停、要么毁配置——archguard 实跑（子代发现亲代盲区）。**

**【实测（archguard，2026-08-06 01:27，tick #114 + 报告 #11）】**：
- `quay init --loop` **不加 --force** ⇒ 停在 config-conflict（archguard 的 config 有 loop 值 ≠ 模板），
  **新机制文件一个都没铺下来**；
- **加 --force** ⇒ 覆盖 config，**丢掉 loop 值**（gap-quay-init-rewrites-an-executable 的形态）。
- ⇒ 对已有下游消费者，升级**要么停住、要么毁掉配置**。archguard 确认 config 完好（写入前就停了），
  建议加一个**保配置的增量升级入口**。

**【价值】**：外层 51 个测试测的是「**漂移能不能被报出来**」，archguard 撞到的是「**报出来之后怎么办**」——
判据报绿但漏了下一步，且是**子代在不同使用姿态下替亲代发现的**（同 archguard 上次发现裸 ✖ 假红的形态）。

**【裁定（外层）】另立一条**（不重开 done 的 delivery-surface-grows）：done 任务正确交付漂移检测 + 升级
路径的机制；**config 保留对已有消费者是后继需求**（升级的下一步），独立范围。

### 选定机制

1. config-preserving 增量升级入口：备份 config → 铺机制文件 → 保留 config 值
2. 已有消费者无需 --force（不毁 config）；fresh install 不受影响

## Acceptance Criteria

- [x] AC1: 已有消费者 `quay init --loop`（不加 --force）铺下新机制文件且 **config 保留**（loop 值不变，实测）
- [x] AC2: config 备份 + 恢复（升级前备份，失败回滚 config 不变）
- [x] AC3: fresh install 路径不受影响（无 config 冲突）
- [x] AC4: 与 gap-delivery-surface-grows（done）交叉标注——漂移报告已交付，本任务是「报后怎么办」
- [x] AC5: 与 gap-quay-init-rewrites-an-executable 交叉标注（同 config 覆盖形态）
- [x] AC6: **A3 夹具覆盖配置分歧**——`install-config-driven-e2e.test.mjs` 的升级夹具不再只用「配置与模板
      一致的干净 old-install」（合成样本），新增一个**有机演化消费者**形态：工作区有自定义 loop 值 ≠ 模板
      （模拟 archguard 式真实下游），验证升级保留 config loop 值且铺下机制文件（AC1 的真实形态回归测试）
      → 合成侧可测 archguard 撞到的 config-conflict 形态；这是 2026-08-06 裁定「两者都要」的合成侧一半
- [x] AC7: **下游适配验收**（archguard 报告 #12 生态位盲区）——升级铺到下游后，①②③盲区逐项适配测试：
      ①claim-task 单机无共享裸仓 fail-closed 不误判；②slot-refill cap 阈值与下游资格形状可配；③
      self-report-vocab 词汇版本漂移不误判不收敛。④（taskWorkLanded checkbox 信号）已核实为
      archguard 对 quay 机制的误解（第三信号是 git-history 非 checkbox），不列入。

## Touches

- tasks/gap-quay-init-config-preserving-incremental-upgrade.md（自身文件——self-touch，派发资格闸 step 4.5）
- plugin/scripts/quay-init.sh（config-preserving 增量升级入口）
- packages/quay/test/install-config-driven-e2e.test.mjs（AC1/AC2 fixture——有机演化消费者夹具 + 备份/回滚测试；原 Touches 写的 `plugin/test/` 是路径笔误，夹具实际在 packages/quay/test/）
- tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md（AC4 交叉标注）
- tasks/gap-quay-init-rewrites-an-executable-instead-of-generating-config.md（AC5 交叉标注）

## Contract

measure   config_preserved = `bash <upgrade-with-config.sh> 2>&1 | grep -c 'config.*保留\|loop 值不变'` stdout 数字段
band      config_preserved >= 1（升级后 config loop 值不变）
invoke    `grep -n 'config-conflict\|--force\|backup\|保留' plugin/scripts/quay-init.sh`
control   已有消费者不加 --force 升级 ⇒ config 保留（AC1）；fresh install 无冲突（AC3）
resume    备份与升级分步提交，任一步完成即写盘

## Evidence（2026-08-08 执行——gap-quay-init-config-preserving-incremental-upgrade）

**实现（`plugin/scripts/quay-init.sh`）**：
- `ensure_loop_config` 从 `data["loop"] = {...}`（整体替换 loop 节，静默丢掉消费者的自定义键）改为**合并**：
  只更新 repo_root/test_command/tmux_session/worktree_root 四个 fast-mode 键，保留 loop 节其余全部键
  （board/gates/stop/policy/concurrency_bands/fork_baseline/merge_target/routines）。
- `backup_config`：升级前把 `.quay/config.yml` 备份到 `.quay/quay-init-backups/<ts>/config.yml`（与 residue
  cleanup 同一备份目录，AC2 升级前备份）。
- `rollback_config_on_exit`：--loop 块在 config 写之前 armed EXIT trap，config 进入终态后 disarm——升级中途任何
  失败（config 写中断 / 铺后 verify fail-closed）都回滚 config 到备份（AC2 失败回滚 config 不变）。
- `read_existing_loop_value` + 默认值逻辑：已有消费者的 repo_root/test_command/tmux_session 优先于
  重新检测（显式 CLI flag 仍覆盖）——真实下游跑 `quay init --loop` 不因 tmux 会话未运行而 fail-closed，也不被
  重新检测覆盖（AC1 已有消费者无需 --force）。

**实测（AC1 复现 + 修复验证，未提交的临时工作区）**：带自定义 loop 值的消费者升级前 loop 节 =
`{board, gates, stop, policy, concurrency_bands, fork_baseline, merge_target, repo_root, test_command,
tmux_session, worktree_root}`；`quay init --loop`（不加 --force，显式匹配 flag）升级后 loop 节**逐键不变**，
71 个机制文件铺下，备份目录 `.quay/quay-init-backups/<ts>/config.yml` 生成。不带显式 flag 时输出
`using existing config loop.test_command: ...` / `using existing config loop.tmux_session: ...`。
失败注入（铺后 `verify-installed-executables` 因 corrupt 非-loop 脚本 fail-closed）：升级 exit 1，
`rolled back .quay/config.yml from backup`，config 逐字节回滚（test_command 回到原值）。

**自动化测试（`packages/quay/test/install-config-driven-e2e.test.mjs`，新增 2 条，12/12 绿）**：
- `AC6/AC1 — an organically evolved consumer keeps the ENTIRE loop section after a config-preserving
  --loop upgrade (no --force), and the mechanism files are laid down`——有机演化消费者夹具（自定义 loop 值 ≠ 模板，
  archguard 式真实下游），断言整个 loop 节不变 + 机制文件铺下 + `using existing config loop.test_command` 消息。
- `AC2 — config backup before upgrade + rollback restores the config unchanged on a failed upgrade`——
  断言升级前备份存在且捕获升级前 config；注入失败升级（corrupt 非-loop 脚本 → verify fail-closed），
  断言 config 逐字节回滚（SHOULD-NOT-STICK-cmd 写入被撤销）。

**AC3（fresh install 无冲突）**：config-less 工作区走 `write_provider_config` else 分支（无备份、无 trap），
四键照旧生成；A1/A2 既有 fresh-install 断言全绿。

**AC4/AC5（交叉标注）**：`tasks/gap-delivery-surface-grows-but-target-freezes-no-upgrade.md` 追加
「报后怎么办」交叉标注；`tasks/gap-quay-init-rewrites-an-executable-instead-of-generating-config.md`
追加「同 config 覆盖形态」交叉标注。

**AC7（下游适配验收，机制盲区已由既有单测覆盖——机制原样铺到下游行为一致）**：
- ①claim-task 单机无共享裸仓 fail-closed：`plugin/test/claim-task.test.mjs`「claim without a claim
  remote FAILS CLOSED（single-machine workspaces must not silently claim）」（绿）；
- ②slot-refill cap 阈值可配：`plugin/test/slot-refill.test.mjs`「cap is an INPUT — a smaller cap reduces
  free slots（AC5 mechanism/strategy separation）」（绿）；
- ③self-report-vocab 词汇版本漂移不误判不收敛：`plugin/test/self-report-vocab-audit.test.mjs` 停摆态豁免
  （stopped-state honest non-drift ⇒ converged）+ 误报纪律（batch-num 需数字，真名/任务 id 不误判）（绿）。
- ④taskWorkLanded checkbox：外层已核实为对 quay 机制的误解（第三信号是 git-history 非 checkbox），不列入。

## Dispatch review

reviewer: outer
at: 2026-08-06T01:3xZ
changed: archguard 实跑（子代发现）立案——升级对已有消费者停/毁 config；51 测试测漂移报告非报后怎么办。
另立 config-preserving 增量升级（done 任务漂移检测正确，config 保留是后继）。

## 验证范围裁定补充（2026-08-06 01:5xZ，外层——判据 vs 现实：范围不是频率）

**实测**：`install-config-driven-e2e.test.mjs` A3 断言正是 archguard 撞到的场景（old-install 升级到全新
产品文件），6/6 全绿含 A3（29s）——而 archguard 35 分钟前真实跑 `quay init --loop` 停 config-conflict、
零文件铺下。**同一场景：合成夹具绿、真实下游撞墙**。

**根因（范围不是频率）**：A3 用 mkdtemp 造的临时工作区（6 处 mkdtemp/tmpdir/fixture），其 old-install 是
自己刚造的、配置与模板一致的干净样本；archguard 是真实演化过的消费者（.quay/config.yml 有自己的 loop
值 ≠ 模板）。**冲突来自「这个项目真的用过、真的改过配置」——合成夹具造不出这个状态**。该文件头注释
写明是 RED-FIRST 落地（当初红的就是 conflict-skip），后来改绿但没覆盖真实下游的配置分歧。

**裁定（人方向「更频繁验证」+ 管理者意见）——两者都要**：
1. **扩 A3 夹具覆盖配置分歧**（造一个有自定义 loop 值 ≠ 模板的工作区，验证升级保留它）——合成侧可测；
2. **真实下游加入验证目标**（archguard / meta-cc / B 机）——高频验证真实工作区，跑一万次 mkdtemp 也
   撞不到有机分歧，只有真实目标能。

**只提高频率不改验证对象 = 跑一万次也撞不到那个状态。**

**交叉标注（AC4，2026-08-08——`gap-install-upgrade-verification-targets-real-downstream-workspaces`）**：
本任务的 **AC6（合成侧扩 A3 夹具覆盖配置分歧）** 与真实侧已分头落地：合成侧 = 本任务 `install-config-driven-e2e.test.mjs`
新增的有机演化消费者夹具（AC6 已勾）；**真实侧 = `tasks/gap-install-upgrade-verification-targets-real-downstream-workspaces.md`
（本任务的验证对象已从合成夹具扩展到真实下游，`plugin/scripts/real-target-verify.sh` 对 archguard/meta-cc 跑只读
`quay init --loop --dry-run` 并分线标注，synthetic 绿不再当作真实下游绿证据）**。两条合起来才是「两者都要」裁定的完整落地。

## archguard 生态位盲区裁定（2026-08-06 04:3xZ，管理者转达 archguard 报告 #12）

**archguard 对 8 个新机制做静态判据×生态位矩阵，报 4 个盲区。外层逐项核实：**

| 盲区 | archguard 判断 | 外层核实 | 裁定 |
|---|---|---|---|
| ①claim-task 两机认领 | 单机无共享裸仓不适用 | 成立（claim-task 无 remote 时 fail-closed，但单机照搬语义不通） | **真实** |
| ②slot-refill 槽位回填 | cap=3 阈值不匹配 + 治本 AC 改派发资格形状 | 部分成立（cap 可配，但资格形状差异真实） | **部分** |
| ③self-report-vocab-audit | 新工厂语义 vs 旧文档版本 0.3.13 误判 | 成立（词汇版本漂移） | **真实** |
| ④taskWorkLanded 第三信号 | 「AC checkbox 计数 countAcCheckboxes」误判 not-yet-flipped | **错判**——quay taskWorkLanded 第三信号是 **git-history of specific Touches paths**（task-status-drift-check.ts:356-365），非 checkbox；ready-pool-check.ts:14-15/177 明确「不依赖 AC checkbox state（fan-in 不勾框）」 | **不成立** |

**裁定：并入本任务作为适配验收 AC，不单独立案。** 理由：本任务修复后正是「机制铺到下游」的时刻，
适配测试是其自然验收维度；①②③是升级后的适配验收项，④是 archguard 对 quay 机制的误解（已澄清）。
**元结论成立**：机制不会自动适配已有下游——config-preserving 实现后需逐项适配测试，不直接照搬判据。
