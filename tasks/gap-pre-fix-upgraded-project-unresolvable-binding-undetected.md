---
id: gap-pre-fix-upgraded-project-unresolvable-binding-undetected
title: 按旧语义升级过的项目停在绑定不到的裸 `quay-native` 上，且没有任何检查会发现——只能靠人想起来重跑 quay-init
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Finding

2026-09-11 实测（orangevps，外部可核）。`gap-upgrade-leaves-legacy-project-runtime-stale-and-unmigrated`
（status: done）修掉的是**机制**：`quay-init` 从此会把既有项目的裸 PATH 形式 `mcp_entry` 迁成指向本次
交付物的绝对路径。修复落地于 commit `ba960f503`（2026-09-11T04:40Z）。

**本条的残留不在那条任务的范围内**：那条修复只对**修复之后跑的升级**生效。在它之前升级过的项目，
config 停在 `mcp_entry: [quay-native, mcp]` 这个裸 PATH 名上——没有任何路径把 `quay-native` 放进
`$PATH` ⇒ **项目自己的 runtime 读不出自己的任务板**，且**没有任何检查会报出来**。

两个独立现场（不是单次偶然），实测命令与真实输出：

```
$ ssh orangevps 'bash -lc "command -v quay-native" || echo "(not on PATH)"'
(not on PATH)

$ ssh orangevps 'cd /home/yale/quay-verify-upgrade-9eda8c70-root && \
    node --no-warnings .quay/runtime/bin/quay.js task list --root . --json'
Error: spawn quay-native ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:285:19)

$ ssh orangevps 'sed -n "1,7p" /home/yale/quay-verify-upgrade-9eda8c70-root/.quay/config.yml'
providers:
  native:
    enabled: true
    path: .
    mcp_entry:
    - quay-native
    - mcp
```

第二现场 `/home/yale/quay-verify-upgrade-1c202737-root`（同一形态、独立一次升级、独立时间戳）
逐字复现同一结果 ⇒ 是形态不是偶然。两处 `providers.native.path` 仍是 `.`，`mcp_entry` 仍是裸名。

**为什么它至今没被发现（这是本条的核）**：读「升级后项目能不能读自己的盘」的那条检查
（`plugin/scripts/verify-deliver-coldstart.sh` 的 `step_upgrade_existing` ⑥）当时是用
`PATH="$PREFIX/bin:$PATH" node "$rtbin/quay.js" task list …` 跑的——**外部 PATH 辅助把它盖住了**。
辅助一撤，ENOENT 立刻现形。⇒ 该读数在旧写法下**结构上取不到假**（恒绿的辅助），而 AC-238 的四件读数
照常全成立、记录照常写出：**「升级成功」与「升级后项目不可用」在那套读数下同形**。

**自愈路径存在，但只能靠人想起来**：对该项目再跑一次 `quay-init`（ba960f503 之后的版本）即可迁移。
⇒ 缺的不是修法，是**发现**：没有任何检查、告警或登记会把「这个项目处于修复前的绑定形态」讲出来。

（同轮已实测的另一半：`verify-deliver-coldstart.sh` 的 AC-238 步骤本身在 `ba960f503` 之后也失效了——
它 `cp -f` 覆盖 project-local `.quay/runtime/bin/quay.js`，而那正是 quay-init 现在要退休的路径。
那一半已在 `gap-aged-project-post-upgrade-driver-e2e` 里修掉（该步骤的读数改为按当前语义取三方向：
退休备份逐字等于升级前那份 ∧ live 路径不再有 `.quay/runtime` ∧ 项目此刻绑定到的 bundle 逐字等于本次
交付物），⛔ 不在本任务范围内。）

## Acceptance Criteria

- [ ] 明确裁定这一存量怎么处理，并落地其中一条（三选一，⛔ 不得沉默）：① 加一个机械检查——读项目的
      `mcp_entry` 并判它**不借助外部 PATH 辅助**能否解析，不能则报出（可区分取值，⛔ 不与「解析成功」同形）；
      ② 产品侧在启动/读取路径上对裸 PATH 名做一次解析失败的可区分报错（fail-closed）；
      ③ 人裁定历史现场不修，只作已知存量登记——登记里必须逐个列出上引两个现场路径与其绑定形态。
- [ ] 若选 ①/②：该判据必须**能取假**——对一个已迁移（绝对路径绑定）的项目跑同一条检查必须给出「合格」，
      对上面两个现场必须给出「不合格」，两种取值可区分，并且真实跑过这两侧（贴上两条真实输出）。
- [ ] 若选 ①/②：新增/修改的测试在**把修复 revert 之后必须失败**（否则它测的是别的东西）。
- [ ] 上引复现命令与真实输出已落进本任务记录（⛔ 不接受「已复现」的自述）。

## Definition of Done

- [ ] 裁定与落地都已完成，且有一个**不依赖 `$PATH` 辅助**的读数证明结论成立
- [ ] 两个已实测的存量现场（`/home/yale/quay-verify-upgrade-9eda8c70-root`、
      `/home/yale/quay-verify-upgrade-1c202737-root`）在本次工作中被显式处理（修复、或被登记），不留悬空
- [ ] 若新增检查器：它若在修复被 revert 后仍取「合格」，则该检查器视为未完成（硬规则 4）

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/quay-init.sh
- tasks/gap-pre-fix-upgraded-project-unresolvable-binding-undetected.md