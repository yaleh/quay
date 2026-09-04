---
id: gap-quay-init-write-state-file-corrupts-hash-after-conflict
title: quay-init.sh write_state_file 在 CONFLICT 分支后无条件用「当前磁盘内容」记账 laidFiles
  哈希——第 3 轮静默吃掉用户编辑且不再报 CONFLICT
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

现场核实（本次立案时直接读源码确认，非转述文档）：`plugin/scripts/quay-init.sh:859-865` 的
`write_state_file()` 对 `laidFiles` 里的每个 rel path 无条件用**当前磁盘内容**算 sha256：

```python
for rel in rels:
    p = os.path.join(workspace_root, rel)
    if os.path.isfile(p):
        with open(p, "rb") as f:
            laid[rel] = hashlib.sha256(f.read()).hexdigest()
state["laidFiles"] = laid
```

`write_state_file()` 在每轮 `--loop` 结束时**总是**被调用（`quay-init.sh:2279`），不区分该文件这一轮
走的是哪条分支：`clean` 覆盖 / `managed` 替换成功 / `managed` 因用户编辑触发 **CONFLICT 后原样保留**。

**根因**：CONFLICT 分支正确地把磁盘上的用户编辑原样保留（不覆盖），但收尾的 `write_state_file()`
无条件把"此刻磁盘上的内容"（=用户编辑）记成"已安装版本"的哈希。下一轮，`laid_hash`（=用户编辑的
哈希，被错记）与 `cur_hash`（=用户编辑的哈希，未变）相等，判定逻辑误判"这只是陈旧安装，可自动
替换"，走无需 `--force` 的 `replaced-stale-install` 静默覆盖分支，用户的编辑丢失且不再报 CONFLICT。

`docs/proposals/archguard-generation-era-primitives.md` §2.9 用全新环境跑了三轮独立复现（第 1 轮
全新安装 → 编辑 1 个 managed 文件 → 第 2 轮正确报 CONFLICT 且保留编辑 → **第 3 轮零改动重跑，编辑
消失，且不报 CONFLICT**），与本任务在 `quay-init.sh:852-865` 现场读到的代码路径完全吻合，是**根因
已定位、尚未修复的活缺陷**。

与本任务最接近的既有任务 `gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them`（已
done）解决的是"落地时字面量替换导致 CONFLICT 语义歧义"（config-driven 安装，AC1-AC7），是本 bug 的
**前提修复**——它让 CONFLICT 从"必然噪声"变成"可行动信号"，但没有覆盖 `write_state_file()` 自身在
CONFLICT 分支后错误记账的这一步；两者是同一子系统里两个不同函数的两个不同缺陷，不是重复。

**修法方向**：`write_state_file()` 只应为**这一轮实际被安装器写入**（`clean` 覆盖成功 / `managed`
替换成功）的文件更新 `laidFiles[rel]` 哈希；CONFLICT 分支保留用户编辑时，`laidFiles[rel]` 必须
**维持上一轮记录的值不变**，这样下一轮 `laid_hash` 仍等于"安装器最后一次真正写入的内容"，与"当前
磁盘内容"（用户编辑）不再相等 ⇒ 继续正确报 CONFLICT。实现上可在 `copy_one()`/CONFLICT 分支处维护
一个"本轮实际写入的相对路径集合"，`write_state_file()` 只对该集合内的路径重算哈希，其余路径沿用
`state.get("laidFiles", {})` 里的旧值。

## AC

- [ ] AC1（复现负控制，须先红后绿）：新建一个全新临时工作区，跑 `quay-init.sh --all --loop`，编辑
      一个 `managed` 类文件（如 `orchestration/orchestrator-loop-tick.md`）追加一行标记，连续三轮
      重跑 `--loop`：第 2 轮必须报 `CONFLICT` 且标记行仍在（`grep -c` ≥1）；**第 3 轮（零其它改动）
      必须仍然报 `CONFLICT` 且标记行仍在**——这条在修复前必须先复现为红（当前第 3 轮会静默吃掉标记、
      不报 CONFLICT），修复后必须转绿，三轮命令与每轮的 `grep -c` 输出全部贴出，不得只贴"通过"结论
- [ ] AC2（正向路径不受影响）：同一临时工作区，`clean` 类文件（如 `plugin/scripts/claim-task.sh`）
      的正常升级路径（无用户编辑）连续三轮 `--loop` 全部 `copied`/`skipped` 且 `conflicted=0`，不因
      本修复引入新的误报 CONFLICT
- [ ] AC3：新增单测 `plugin/test/quay-init-conflict-state-hash.test.mjs` 复现 AC1 的三轮场景（复用
      `plugin/test/helpers/quay-init-install-fixture.mjs` 现有夹具），断言第 3 轮
      `.quay/quay-init-state.json` 的 `laidFiles[<该相对路径>]` 与第 2 轮完全相同（不随磁盘上的用户
      编辑而更新）
- [ ] AC4：`node --experimental-strip-types plugin/test/quay-init-conflict-state-hash.test.mjs` exit 0

## DoD

真实的三轮 `quay-init.sh --all --loop` 命令行复现（AC1）在**修复后的代码**上跑通、输出（含每轮的
`CONFLICT`/`replaced-stale-install` 行与 `grep -c` 结果）贴进本任务体；新增单测随 `scripts/test.sh`
接入主 suite 并绿。不是"写了个断言就算"——必须是修复前后各跑一次 AC1 的真实三轮命令、把红/绿两次
输出都保留在任务体里作对照，证明是这次修复让它从红变绿，而不是测试从一开始就设计成通不过 CONFLICT
分支。

## Touches

- plugin/scripts/quay-init.sh（`write_state_file` / `copy_one` CONFLICT 分支的写账逻辑）
- plugin/test/quay-init-conflict-state-hash.test.mjs（新增）
- tasks/gap-quay-init-write-state-file-corrupts-hash-after-conflict.md
