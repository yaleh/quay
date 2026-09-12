---
id: gap-ac248-adr-check-differential-record-producer
title: AC-248 没有生产者：载体里没有任何记录带 adr_check_before/after_detects —— archguard
  自身检查器的检出翻转无人搬运（⛔ 不读单次退出码）
status: todo
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac247-stalled-project-clean-takeover-record
goal_ac: AC-248
---
## Proposal

**症状（机械可复算，2026-09-12 实测）**：GOAL-016 的 AC-248 要求载体 `.quay/productization-verification.jsonl` 里存在一条 `ac=GOAL-016-AC-248` 记录，且该记录带三个新字段 `adr_check_before_detects`（严格 `false`）/ `adr_check_after_detects`（严格 `true`）/ `adr_check_probe_tool`（非空）。三条读数今天全部为零：

```
载体：82 条记录；键集并集不含 adr_check_before_detects / adr_check_after_detects / adr_check_probe_tool
      含 ac 前缀 GOAL-016 的记录 = 0
grep -rn 'adr_check' --include=*.ts --include=*.sh --include=*.mjs --include=*.js .（排除 node_modules）⇒ 0 命中
grep -rn 'GOAL-016' plugin/scripts/*.sh plugin/scripts/*.ts                            ⇒ 0 命中
grep -rn 'goal_ac:.*AC-248' tasks/*.md                                                 ⇒ 0（无人认领）
```

**不是「有生产者但没跑」，是字段级步骤缺失**：最近的近亲生产者 `write_ac207_record()`（`plugin/scripts/verify-deliver-coldstart.sh:714`，经 `--ac207-e2e` 触发）逐字写满 AC-248 也需要的八个字段（host / project_root / commit_sha / commit_files / task_id / task_status / gate_events / produced_by_driver），但它**一个 adr_check_* 字段都不写**；而这三个字段名在整个仓库（含已归档脚本）零命中 ⇒ 没有任何步骤产生它们。

**目标态判据要求（逐字取自 `goals/AC-248-*.md`，⛔ 本任务不改判据文件）**：`host≠本机` ∧ `project_root` realpath ∉ 本仓库 ∧ `commit_sha`/`task_id` 非空 ∧ `task_status=="done"` ∧ `gate_events>0` ∧ `produced_by_driver is True` ∧ `commit_files` 是非空列表且至少一条不以 `tasks/` `goals/` `.quay/` 开头 ∧ **`adr_check_before_detects is False` ∧ `adr_check_after_detects is True`**（严格 `is`，故 `0/1`、`"false"`、缺字段、`null` 全部不冒充）∧ `adr_check_probe_tool` 非空；缺 ⇒ exit 1，载体缺失 ⇒ exit 3（NOT-EVALUATED，⛔ 不与合格同形）。

**为什么必须是「翻转」而不是「跑通」**：本 GOAL 的靶子缺陷的表现形式正是 `npm run check:adr` 打印 `ADR-007: OK` 并 exit 0——**漏检与合格同形**（硬规则 3b）。任何形如「跑了 check:adr 且 exit 0」的判据**今天就已经是绿的** ⇒ 零信息。⇒ 只有「同一输入形态下，修复前 detects=false、修复后 detects=true」这个**差分**才携带信息。取假两个方向都堵死：改了但没修对 ⇒ after 仍 false ⇒ 红；把 before 直接写成 true 凑翻转 ⇒ `is False` 失败 ⇒ 红。

**正确性判据不由 quay 拥有**：detects 的取值必须来自 **archguard 自己的** `scripts/check-adr.ts` / `npm run check:adr`（及其单测），quay 只搬运读数；⛔ 不在 quay 侧实现一个「等价」的判定（那会变成 quay 给自己打分）。

**与 GOAL-009 AC-207 的本质差别**：AC-207 判「有一个触及非记账文件的提交」（一个改错了的提交同样满足它），AC-248 判「**这个提交让一个外部的、独立的机械判据从假变真**」。

**照实说明的边界（继承 AC-207 的自陈，⛔ 不冒充解决）**：`produced_by_driver` 的最强可得直接量只到「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」，**不能排除人在会话里手敲**；本 AC 沿用该自陈，只把门槛从「敲出一个提交」提高到「敲出一个能让外部判据翻转的正确修复」，⛔ 不假装解决了 AC-207 没解决的半个问题。

**外部可核（人 2026-09-12 裁定不推 origin ⇒ 无裸仓库镜像可用）**：`commit_sha` 与 `commit_files` 必须经 ssh 从 ad-arm1 的真实 git 历史交叉核对，⛔ 不采信载体自述（硬规则 4b）。

**顺序（GOAL-016 风险 1「顺序是硬的：AC-247 → AC-248」）**：修复提交必须由 ad-arm1 上**真活的** driver 产出，而「装当前 build + 干净接管停摆项目 + driver 真活」的生产者是 `gap-ac247-stalled-project-clean-takeover-record` ⇒ 本任务 `depends_on` 它（不在 driver 没活的前提下讨论修得对不对）。

<!-- dedup-ref -->
**与既有任务的关系（仅追溯，不构成任何依赖声明）**：`gap-ac207-e2e-target-driver-driven-real-commit-task-done`（AC-207，done）建了 e2e 段与 `write_ac207_record()`、`gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit`（done）把「实现提交 vs 记账提交」的判定改成按位置（`ac207_select_implementation_commit` / `ac207_commit_files` / `ac207_files_to_json` 三个辅助是 AC 编号无关的、可复用）；`gap-crosscut-checks-zero-coverage-of-plugin-scripts`（done）与 `gap-scoped-selection-blind-to-packaging-state-diff`（done）里的 `check-adr` 指的是**本仓库自己的**跨切测试选择，与本任务要搬运的 **archguard 的** `scripts/check-adr.ts` 不是同一机制。以上都不产出 adr_check_* 字段。本任务不复用它们除上述辅助之外的东西，只补这条缺失的字段级生产者步骤。

## Plan

1. **先定读数，再写代码** —— 三个新字段各定一个**直接量**来源，全部在**目标机**上读，且由 archguard 自己的检查器产生：
   - `adr_check_probe_tool` ← **差分本身**推出来的工具名：对同一输入形态跑检查器，「修复后新进入候选集的那个工具名」（before 的匹配集与 after 的匹配集之差）——⛔ 不是字面量、不是本次修复的 commit message、不是任务 id；读不出 ⇒ 不写记录。
   - `adr_check_before_detects` / `adr_check_after_detects` ← **同一次**检查器的两次真实运行：before 在**修复前修订**（实现提交的 parent，或落档的 pre-head）上跑，after 在修复后的 HEAD 上跑；两次只差修复本身，其余输入形态逐字相同。before 的修订必须用 `git worktree add` / `git archive` **物化**到独立路径再跑（⛔ 不改活树、不靠 `git stash` 往返）。
   - 记录必须带**两次运行的原始输出**（stderr/stdout 原文落档，作为「这两条布尔来自真实读数」的证据）。
   - ⛔ **quay 不重新实现 ADR-007 判定**：detects 只由 `npm run check:adr`（= archguard 的 `scripts/check-adr.ts`）的产出决定；quay 侧不得写「等价」的正则/判定函数（那会变成自证，硬规则 4）。
2. **生产者步骤（目标侧，`plugin/scripts/verify-deliver-coldstart.sh`）**：新增 opt-in 步骤（形如 `--ac248-adr-flip --target-root <项目根>`），在既有 `--ac207-e2e` 段产出实现提交之后执行：① 物化 pre 修订 → ② 跑检查器取 before → ③ 在 HEAD 跑检查器取 after → ④ 求差集得 probe tool → ⑤ 五件（含 AC-207 的八件）**全部有效**才写记录；任一读不出 ⇒ **不写** + 可区分的 `NOT-EVALUATED` + 退出非 0。新增 `write_ac248_record()`，用自己的 `AC248_*` 变量（⛔ 不借用 `AC207_*`，否则两条 AC 无法分别 pass/fail），并**复用 AC 编号无关的** `ac207_select_implementation_commit` / `ac207_commit_files` / `ac207_files_to_json`（⛔ 不复刻一份：复刻出来的绿不证明产品绿）。
   **写入必须走既有唯一补锚 choke point `ac89_append_goal009`**（它统一补 top-level `ts`/`build_sha`）——⛔ 不在新写入点再写一份 `"build_sha"` 字面量（既有注释逐字禁止：多一个补锚点 = 下次改锚格式必漏一处）。
   **JSON 字面量是判据的一部分**：两个 detects 字段必须写成 JSON 布尔 `false`/`true`；写入前 fail-closed 校验——`0`/`1`/`"false"`/空/缺 ⇒ 拒写（criterion 用 `is False` / `is True`，字符串与数字都取不到真）。
3. **传输步骤（驱动侧，`plugin/scripts/develop-deliver-tgz.sh`）**：与既有 `--verify-coldstart` / `--verify-upgrade` **同形**地 scp 回证据文件，经既有 `transport_evidence_append`（按 `(ts, ac, host, project_root)` 去重）追加进**驱动方 repo root** 的 `.quay/productization-verification.jsonl`；证据缺失/不可读/零行 ⇒ 非 0 + `NOT-EVALUATED`（⛔ 不静默 exit 0）。
4. **记录必须落在生产 root 的载体里**：判据由生产 goal-driver 在 `/home/yale/work/quay` 求值 ⇒ 传输落点必须是**该 root** 的 `.quay/`。若本任务在 worktree 里执行，先在 worktree 跑通，再把证据传输/追加进生产 root 的载体，并在**生产 root** 下干跑判据核 exit 0（⛔ 不要在 worktree 的 `.quay/` 里自证——那是另一份载体）。
5. **真跑一次（唯一能产出记录的路）**：在 ad-arm1 的 `/home/yale/work/archguard`，由该项目**自己的 drivers** 驱动一条真实任务到 done。**目标侧任务文本只给症状 + 复现入口 + 期望行为**（GOAL-016 风险 3：写进根因/修法/正则所在行 ⇒ 测到的是「能驱动施工」而非「能驱动开发」），⛔ 不给根因、不给修法、不给文件行号。修复对象必须是**真实违反对称要求的工具**（⛔ 不是为验证而编的练习题）。
6. **负控制（能取假）**：a) **翻转双向**：`before=true ∧ after=false`（反向）⇒ **零记录**；`before=false ∧ after=true` ⇒ 写出一条。b) **字面量形态**：`0/1` 或 `"true"` ⇒ 拒写。c) **只跑一侧**：仅 after 有读数 ⇒ 不写 + NOT-EVALUATED（未测量 ≠ 不合格）。d) **bookkeeping-only**：`commit_files` 全在 `tasks/goals/.quay` 之下 ⇒ 拒写。e) **判据三态**：载体副本删该记录 ⇒ exit 1；移走载体 ⇒ exit 3；与 exit 0 并列留档。
7. **夹具与自检**：新步骤要有 hermetic 正/负控制（同既有 `--selfcheck` 形态）并进套件；正控制直接调**产品函数** `write_ac248_record()`，⛔ 不让夹具复刻判定逻辑（硬规则 4 推论三）。

## Acceptance Criteria

- [ ] **AC1 生产者存在且 fail-closed（能取假）**：`grep -c 'GOAL-016-AC-248' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1，且 `adr_check_before_detects`/`adr_check_after_detects`/`adr_check_probe_tool` 三个字段名在该脚本内各 ≥ 1 命中（**引用计数前先打印前 3 条实际内容**，硬规则 2）；hermetic 自检打印正/负两组读数原文——正控制：字段齐备且翻转方向正确 ⇒ 写出 1 条；负控制：逐个把任一件置为读不出/反向/`0-1`/记账提交 ⇒ **零记录** + 可区分 NOT-EVALUATED + 退出非 0。
- [ ] **AC2 三个新字段都是直接量（⛔ 无字面量/默认值）**：grep 证明写入路径上不存在任何字段的硬编码默认值（尤其：不得在 `adr_check_before_detects` 写入处直接写 `false`/`true` 字面量、不得把 probe tool 名硬编码）；每个值可追溯到运行时读数（两条检查器运行输出 + 两次运行匹配集的差集）；把读数命令与前 3 条命中一起贴进记录。
- [ ] **AC3 正确性判据不由 quay 拥有**：留档证明 detects 来自 archguard 自己的 `npm run check:adr`（目标机上的命令与输出原文），且 `git diff` 证明 quay 侧**没有**新增任何等价判定实现（⛔ 不重新实现 ADR-007 正则）。
- [ ] **AC4 真跑真驱动（生产载体上的判据翻转）**：`/home/yale/work/quay/.quay/productization-verification.jsonl` 里存在该记录（打印该行原文 + 行数）；逐字段满足 criterion：host≠本机 ∧ project_root=ad-arm1 的 archguard ∧ commit_sha/task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧ produced_by_driver=true ∧ commit_files 非空且至少一条不在 tasks/goals/.quay 之下 ∧ **before 严格 false ∧ after 严格 true** ∧ probe tool 非空。随后在**生产 root** 下**逐字取 `goals/AC-248-*.md` 的判据干跑**：改前 exit 1、改后 exit 0，两条读数并列（翻转的成因是载体内容，⛔ 不是环境）。
- [ ] **AC5 外部交叉核对（硬规则 4b）**：经 ssh 在 ad-arm1 上 `git -C /home/yale/work/archguard show --pretty=format: --name-only <commit_sha>` 核验该 sha 真实存在且文件列表与记录里的 `commit_files` **逐条一致**；并核 `before` 用的 pre 修订确是该实现提交的 parent（或落档 pre-head）——命令与输出原文留档，⛔ 不采信载体自述。
- [ ] **AC6 未测量 ≠ 不合格，且三态可区分**：任一读数读不出时 **零记录** + NOT-EVALUATED + 非 0；留档证明写入器拒收 `0/1`、`"true"`、缺字段（打印被拒的输入与返回码）；载体副本删记录 ⇒ exit 1、移走载体 ⇒ exit 3，与 exit 0 并列留档。
- [ ] **AC7 全量套件绿 —— 外层 verification-round 验证**（本条的量产生在 fan-in / 外层 suite 轮，⛔ 不是 worker 自己的读数；scoped 门绿不等于全量绿）

## Definition of Done

**AC-248 criterion 在生产载体上 exit 0**，且该记录是一次**真安装、真驱动、真读数**的产物：修复提交由 ad-arm1 上 archguard 自己的 driver 产出（`produced_by_driver=true` ∧ `gate_events>0` ∧ `task_status=done`），`before`/`after` 两个布尔来自 **archguard 自己的** `npm run check:adr` 的两次真实运行（只差修复本身，原始输出落档），且翻转方向为 `false → true`；host 与 project_root 都指向外部项目；`commit_sha`/`commit_files` 经 ssh 外部可核。任一读数读不出 ⇒ **不写记录**（未测量 ≠ 不合格），且 quay 侧**没有**任何「等价」的 ADR-007 判定实现。

⛔ 以下不算达成：

- 在 quay 侧自己实现一个「等价」的 ADR-007 判定（自证：quay 给自己打分）；
- 只跑一次 `npm run check:adr` 且 exit 0（**今天就已经是绿的**——漏检与合格同形）；
- 用 `0`/`1` 或 `"false"`/`"true"` 冒充 JSON 布尔（criterion 用 `is False`/`is True`）；
- 用夹具伪造出 `before=false ∧ after=true` 的读数（读数必须来自真跑 archguard 自己的检查器，且两次只差修复本身）；
- 把「没跑成」（或只跑了一侧）写成 `adr_check_after_detects=false`（未测量被伪装成「查过且未翻转」）；
- 只在一个「做对了的」练习 target 上跑（修复对象必须是真实违反对称要求的工具）；
- 只在 worktree 的 `.quay/` 里自证，而生产 root 的载体上没有该记录；
- 在目标侧任务文本里写进根因/修法/正则所在行（GOAL-016 风险 3）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/scripts/develop-deliver-tgz.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- plugin/test/develop-deliver-tgz-evidence-transport.test.mjs
- plugin/test/ac248-adr-check-flip-record.test.mjs (new)
- tasks/gap-ac248-adr-check-differential-record-producer.md