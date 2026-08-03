---
id: gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down
title: "The installer's file list is hand-maintained, so the shipped cold-start skill calls two scripts the installer never lays down"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

meta-cc 冷启动实测（管理者转达，外层逐项复核）。**产品侧缺陷，不在 meta-cc 本地修。**

`plugin/scripts/quay-init.sh:419` 的 `LOOP_SCRIPTS` 是**硬编码清单**（18 项）。
外层实测：`monitor-mount-check.sh` 与 `send-keys-verified.sh` **一个都不在里面**
（`awk '/LOOP_SCRIPTS=\(/,/^\s*\)/' | grep -c ⇒ 0`），
而两者**都存在于出厂子树** `plugin/scripts/`，且**都被出厂的 cold-start skill 调用**：

```
plugin/skills/cold-start/SKILL.md:77   bash <root>/plugin/scripts/monitor-mount-check.sh --json
plugin/skills/cold-start/SKILL.md:99   bash <root>/plugin/scripts/send-keys-verified.sh <session> ...
```

**⇒ 交付物内部自相矛盾：后一个 skill 依赖前一个 skill 不铺的文件。
任何人照 README 走都会在这里 missing-file。**

### 修法不是往清单里再加两行

**那只是把下一次的同类缺陷推迟。** 根因是**清单由人手维护，而调用方也由人手维护，
两份手工清单之间没有任何机械约束**——它们必然漂移，今天只是第一次被人踩到。

**⇒ `LOOP_SCRIPTS` 应当由 cold-start skill 实际调用的脚本集合推导，或者干脆铺整个 `scripts` 目录。**

### 次要一条（同一形态：文档化的路径走不通）

经 Skill 调用时**宿主不注入 `CLAUDE_PLUGIN_ROOT`**，而 `plugin/skills/init/SKILL.md:101` 的命令是

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/quay-init.sh" \
```

步骤 3 的命令**没带 `--plugin-root`** ⇒ 脚本 fail-closed。
**fail-closed 本身是对的**（比静默用错路径好），**错的是文档化的调用方式走不通**。

## Contract

```
measure uncovered_calls = `grep -ohE 'plugin/scripts/[a-z0-9.-]+' plugin/skills/*/SKILL.md | sort -u` 中不在 LOOP_SCRIPTS 里的脚本数字段
measure missing_after_install = `bash plugin/scripts/quay-init.sh --loop --root <t> && grep -ohE 'plugin/scripts/[a-z0-9.-]+' <t>/plugin/skills/*/SKILL.md | sort -u | while read s; do [ -f "<t>/$s" ] || echo "$s"; done | wc -l` 的缺失文件数字段
band missing_after_install = 0
invariant 出厂 skill 调用的每个脚本，落地后都必须存在；两份手工清单之间必须有机械约束
invoke `bash plugin/scripts/quay-init.sh --loop --root <target>`
control 给某个 skill 新增一个脚本调用而不改 init ⇒ 检查必须报出；移除该调用 ⇒ 必须不报
resume 先建立「调用集合 ⊆ 落地集合」的机械检查，再决定推导还是整目录铺设
```

## Chosen mechanism

1. **先建立机械约束，再改清单**（顺序不可颠倒）：一个检查——
   **出厂 skill/tick 文档里出现的每个 `plugin/scripts/*` 引用，都必须在落地集合中**。
   **上线时它必须报出今天这两个活标本**，否则无从判断它是否真的在看
   （本仓已有先例：`gap-checks-that-verify-an-empty-set-must-fail-closed`）。
2. **然后择一并写明理由**：(a) 由引用集合**推导** `LOOP_SCRIPTS`；
   或 (b) **铺整个 `scripts` 目录**。
   **(b) 更简单且天然免疫漂移**，代价是落地体积；**(a) 更精确**，代价是推导规则本身要被测试。
3. **次要条**：修正 `init/SKILL.md` 步骤 3 的命令，使其在宿主不注入 `CLAUDE_PLUGIN_ROOT` 时仍可用
   （显式 `--plugin-root`，或让脚本自解析自身位置）。**保留 fail-closed 行为**。

**不做**：**不许只往 `LOOP_SCRIPTS` 里加那两行**——那是修标本不修类，
本仓今晚已记录四次同形（规则名覆盖类、实现覆盖标本）；
不移除 `--plugin-root` 的 fail-closed（**静默用错路径比失败更糟**）。

## Acceptance Criteria

- [ ] AC1: **机械检查落地**——出厂 skill/tick 文档中的每个 `plugin/scripts/*` 引用 ⊆ 落地集合
- [ ] AC2: **活标本验证**——检查上线时**必须报出** `monitor-mount-check.sh` 与
      `send-keys-verified.sh` 这两个真实缺失（实跑输出贴任务体）。
      **修清单之前先跑这一步**——否则无从判断检查是否真的在看
- [ ] AC3: **双向负控制**——给某 skill 新增一个未铺设的脚本调用 ⇒ **报出**；
      移除该调用 ⇒ **不报**。两个方向都贴
- [ ] AC4: **落地后端到端**——装进一个空目录后，遍历出厂 skill 的每个脚本引用，
      **文件全部存在**（`missing_after_install = 0`，实跑输出贴任务体）
- [ ] AC5: **照 README 走通**——`/quay:init --all --loop` 后执行 cold-start skill 的步骤 3 与步骤 5，
      **不出现 missing-file**（实跑输出贴任务体）
- [ ] AC6: **`--plugin-root` 条**——宿主不注入 `CLAUDE_PLUGIN_ROOT` 的情形下，
      文档化的调用方式可用；**fail-closed 行为保留**（两种情形都贴）
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group product`

## Definition of Done

- [ ] AC2 与 AC3 的实跑输出都贴进任务体——
      **一个从没在真实产物上报出过东西的检查，与「永远返回空集」不可区分**
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录根因：**两份手工清单（落地清单与调用点）之间没有机械约束 ⇒ 必然漂移**；
      **今天只是第一次被人踩到**

## Touches

- plugin/scripts/quay-init.sh
- plugin/skills/init/SKILL.md
- plugin/test/quay-init-loop.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T23:25:00Z
changed: 管理者转 meta-cc 冷启动实测缺陷。**外层逐项复核**：`LOOP_SCRIPTS`（:419）18 项，
`awk` 取整个数组后 `grep -c` 那两个脚本 ⇒ **0**；两者都在 `plugin/scripts/` 里存在；
`cold-start/SKILL.md:77` 与 `:99` 确实调用它们 ⇒ **交付物内部自相矛盾成立**。
**人的裁定里最重要的一句被原样保留为机制**：**修法不是往硬编码清单里再加两行，
那只是把下一次的同类缺陷推迟**——根因是**两份手工清单之间没有机械约束，必然漂移**。
**外层把顺序钉死**：**先建立「调用集合 ⊆ 落地集合」的检查并用今天这两个活标本验证它（AC2），
再改清单**；顺序颠倒的话，清单一改标本就消失，检查是否真的在看就再也无法判断——
本仓已有 `gap-checks-that-verify-an-empty-set-must-fail-closed` 这个先例。
**两条路都写进机制并要求择一写明理由**：整目录铺设天然免疫漂移但体积大，
推导更精确但推导规则本身要被测试——**不替实现者做这个取舍，但要求他写下理由**。
**次要条按其本来的形状记录**：`--plugin-root` 的 **fail-closed 是对的**，
**错的是文档化的调用方式走不通**——不要把这条修成「去掉 fail-closed」，
**静默用错路径比失败更糟**。
**排期**：与 [[gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them]] 及
[[gap-init-guesses-the-tmux-session-and-writes-the-guess-into-the-monitor]] 同动 `quay-init.sh`，三者须串行。
