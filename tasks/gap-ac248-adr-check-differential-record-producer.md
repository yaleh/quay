---
id: gap-ac248-adr-check-differential-record-producer
title: AC-248 没有生产者：载体里没有任何记录带 adr_check_before/after_detects —— archguard
  自身检查器的检出翻转无人搬运（⛔ 不读单次退出码）
status: done
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

- [x] **AC1 生产者存在且 fail-closed（能取假）**：`grep -c 'GOAL-016-AC-248' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1，且 `adr_check_before_detects`/`adr_check_after_detects`/`adr_check_probe_tool` 三个字段名在该脚本内各 ≥ 1 命中（**引用计数前先打印前 3 条实际内容**，硬规则 2）；hermetic 自检打印正/负两组读数原文——正控制：字段齐备且翻转方向正确 ⇒ 写出 1 条；负控制：逐个把任一件置为读不出/反向/`0-1`/记账提交 ⇒ **零记录** + 可区分 NOT-EVALUATED + 退出非 0。
- [x] **AC2 三个新字段都是直接量（⛔ 无字面量/默认值）**：grep 证明写入路径上不存在任何字段的硬编码默认值（尤其：不得在 `adr_check_before_detects` 写入处直接写 `false`/`true` 字面量、不得把 probe tool 名硬编码）；每个值可追溯到运行时读数（两条检查器运行输出 + 两次运行匹配集的差集）；把读数命令与前 3 条命中一起贴进记录。
- [x] **AC3 正确性判据不由 quay 拥有**：留档证明 detects 来自 archguard 自己的 `npm run check:adr`（目标机上的命令与输出原文），且 `git diff` 证明 quay 侧**没有**新增任何等价判定实现（⛔ 不重新实现 ADR-007 正则）。
- [x] **AC4 真跑真驱动（生产载体上的判据翻转）**：`/home/yale/work/quay/.quay/productization-verification.jsonl` 里存在该记录（打印该行原文 + 行数）；逐字段满足 criterion：host≠本机 ∧ project_root=ad-arm1 的 archguard ∧ commit_sha/task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧ produced_by_driver=true ∧ commit_files 非空且至少一条不在 tasks/goals/.quay 之下 ∧ **before 严格 false ∧ after 严格 true** ∧ probe tool 非空。随后在**生产 root** 下**逐字取 `goals/AC-248-*.md` 的判据干跑**：改前 exit 1、改后 exit 0，两条读数并列（翻转的成因是载体内容，⛔ 不是环境）。
- [x] **AC5 外部交叉核对（硬规则 4b）**：经 ssh 在 ad-arm1 上 `git -C /home/yale/work/archguard show --pretty=format: --name-only <commit_sha>` 核验该 sha 真实存在且文件列表与记录里的 `commit_files` **逐条一致**；并核 `before` 用的 pre 修订确是该实现提交的 parent（或落档 pre-head）——命令与输出原文留档，⛔ 不采信载体自述。
- [x] **AC6 未测量 ≠ 不合格，且三态可区分**：任一读数读不出时 **零记录** + NOT-EVALUATED + 非 0；留档证明写入器拒收 `0/1`、`"true"`、缺字段（打印被拒的输入与返回码）；载体副本删记录 ⇒ exit 1、移走载体 ⇒ exit 3，与 exit 0 并列留档。
- [x] **AC7 全量套件绿 —— 外层 verification-round 验证**（本条的量产生在 fan-in / 外层 suite 轮，⛔ 不是 worker 自己的读数；scoped 门绿不等于全量绿）

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

## Evidence

**实现落点**：目标侧 `plugin/scripts/verify-deliver-coldstart.sh` 段⑨（`--ac248-adr-flip --target-root <dir> --task-id <id> [--pre-rev <sha>]`；读数助手 `ac248_checker_relpath` / `ac248_materialize_rev` / `ac248_run_checker_cli` / `ac248_candidate_set` / `ac248_pre_rev` / `ac248_adr_flip_reading` / `probe_ac248_measures`，写入点 `write_ac248_record`）；驱动侧 `plugin/scripts/develop-deliver-tgz.sh` 的 `--verify-adr-flip --target-root <abs> --task-id <id>` → `verify_adr_flip_mode` + `validate_adr_flip_args`。落任务分支 `task/gap-ac248-adr-check-differential-record-producer`（5 个提交，见 `git log develop..HEAD`）。

### AC1 —— 生产者存在且 fail-closed（能取假）
**grep 计数 + 前 3 条实际内容**（硬规则 2：引用计数前先打印命中原文）：
```
$ grep -c 'GOAL-016-AC-248' plugin/scripts/verify-deliver-coldstart.sh   ⇒ 6
  2094: ac89_append_goal009 ",\"ac\":\"GOAL-016-AC-248\",\"host\":\"$host\",\"project_root\":\"$project_root\",...
  2097: # ── ⑨ AC-248 步骤（GOAL-016-AC-248）──…
  4394: ac248_w="$(grep -c 'GOAL-016-AC-248' "$ac248_tmp/carrier.jsonl" 2>/dev/null || true)"
$ grep -c 'adr_check_before_detects'  …                          ⇒ 3
  388: #   · adr_check_before_detects / adr_check_after_detects ← 同一个检查器在【两个修订】上的两次真实运行：
  2094: …"adr_check_before_detects":$before,"adr_check_after_detects":$after,"adr_check_probe_tool":"$probe"…
  4395: for f in … '"adr_check_before_detects":false' '"adr_check_after_detects":true' '"adr_check_probe_tool":"tool_newly_seen"'; do
$ grep -c 'adr_check_after_detects'   …                          ⇒ 6   （同 2094 那条是唯一写出点；其余是文档/夹具/自检）
$ grep -c 'adr_check_probe_tool'      …                          ⇒ 3   （2094 写出点 + 394 文档 + 4395 夹具）
```

**selfcheck 正/负读数原文**（`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` ⇒ `selfcheck: PASS`）：
```
selfcheck: ac248-flip-reading(hermetic 2-commit checker) probe='tool_newly_seen' before='false' after='true' ok=1 missing='' (expect tool_newly_seen/false/true/1/'' — 读数与写入都由产品函数产生)
selfcheck: ac248-refusal(13 negative specs) negatives_all_refused=1 (expect 1 — 反转/0-1/字符串/缺件/记账提交/空探针 ⇒ 零记录)
selfcheck: ac248-noop-fix(差集为空) carrier_lines=1 (expect 1 — 只有 51b 那一条; 无修复 ⇒ 无 probe ⇒ 不新增记录)
```
正控制走的是**产品函数**（`ac248_adr_flip_reading` + `write_ac248_record`），夹具只提供「一个真 git 仓库 + 一个真会翻转的检查器」这两样**输入形态**，⛔ 不复刻判定逻辑。夹具带三个真实形态：**修复由多个提交组成**（fix + test）、修复段之前有一条**记账边界**、检查器**按 cwd 相对路径**读输入 ⇒ 这三条各自对应的缺陷（见「过程发现」）在自检里都是红的。

真跑的负路径也留档（`/home/yale/work/quay/.quay/verify-adrflip-remote-C-88630f42.log`，TASK-88 尚未 done 时的那次）：
```
[⑨f] AC248-NOT-EVALUATED: record NOT written (缺值≠合格): task-not-done(ready); gate-events-not-positive(0); not-produced-by-driver; no-probe-tool(候选集差集为空…); before-detects-unreadable; after-detects-unreadable; flip-not-forward(before=<unreadable>,after=<unreadable>);
```

### AC2 —— 三个新字段都是直接量（⛔ 无字面量/默认值）
逐字段来源（每条贴 grep 模式 + 命中原文；⛔ 不引用行号——行号随编辑漂移）：
```
field=adr_check_before_detects / adr_check_after_detects  写入点：`"adr_check_before_detects":$before,"adr_check_after_detects":$after`（⛔ 不加引号 ⇒ JSON 布尔）
  $before/$after ← `AC248_BEFORE_DETECTS="$(… python3 …)"` / `AC248_AFTER_DETECTS="$(…)"` ← 两次运行里【探针是否在候选集内】的成员判定
  候选集本身 ← `ac248_candidate_set` ← 目标项目自己的 `extractMcpToolNames()`（导入其 check-adr.ts）
field=adr_check_probe_tool  写入点：`"adr_check_probe_tool":"$probe"` ← `AC248_PROBE_TOOL` ← `python3`：`sorted(set(after) - set(before))[0]`
  两侧候选集 ← `ac248_candidate_set "$pre_t"` / `"$post_t"`，两个修订由 `git -C "$root" archive … | tar -x` 物化
field=host          `AC248_HOST="$(hostname …)"`        ← 目标机
field=project_root  `AC248_PROJECT_ROOT="$(cd "$root" && pwd -P)"`
field=commit_sha / commit_files  ← `ac207_select_implementation_commit` / `ac207_commit_files` / `ac207_files_to_json`（AC 编号无关的通用辅助，⛔ 未复刻）
field=task_id       `AC248_TASK_ID="$AC248_TASK_ID_ARG"`（⛔ 不猜、不取最新一条）
field=task_status   `node "$qrl" task view <id> --json`   ← 目标项目自己的 store
field=gate_events   `wc -l < "$root/.quay/gate-events.jsonl"`
field=produced_by_driver  ← done ∧ gate>0 ∧（task 分支在 ∨ 提交信息提及该 id），经 `ac248_produced_by_driver_json` 映射成 JSON 布尔（⛔ 调用点没有 `"true"` 字面量）
field=build_sha     由 `ac89_append_goal009` 统一补（唯一补锚 choke point）
```
**写入路径上的字面量计数**（自检钉住，可证伪：往函数体里加一行默认值即翻）：
```
selfcheck: ac248-writer-literal-hits=0 adr007-in-producer-hits=0 checker-export-hits=2 step-call-hits=1 step-literal-hits=0
  （写入器【函数体】里 true/false 字面量 = 0；⑨ 的【调用点】里 = 0；`build_sha` 在写入器体内命中数 = 0 —— 见 ac247-record 的 anchor-literal-hits=0）
```
字面量只允许出现在判定助手里（`ac248_json_bool_ok` / `ac248_flip_is_forward` / `ac248_produced_by_driver_ok|_json`）。

### AC3 —— 正确性判据不由 quay 拥有
**目标机上检查器自己的两次运行原文**（`node --experimental-strip-types scripts/check-adr.ts`，即该项目 `package.json` 的 `check:adr` 脚本体；两个修订各自物化后跑）：
```
BEFORE (修复前修订 a90c17b3):  rc=0
  ArchGuard ADR Compliance Checker
  ADR-006: OK — all tool descriptions pass verb-first check
  ADR-007: OK — all MCP tools have matching CLI flags
  All ADR checks passed.
AFTER  (实现提交 886f40f4):   rc=0
  ArchGuard ADR Compliance Checker
  ADR-007: OK — …
  MCP tool declaration audit (ADR-007 candidate set):
    candidate set (35): archguard_analyze, … archguard_get_evidence_pack, … archguard_get_metric_trend, archguard_get_package_metrics, …
    declared  set (35): …
    candidate − declared: ∅ (empty)
    declared − candidate: ∅ (empty)
    server.tool( call sites: 35
```
⇒ **两次的退出码都是 0**：这正说明为什么判据不能读单次退出码（`ADR-007: OK` 与「漏检」同形）。翻转读的是**检查器自己的候选集**：32 → 35，新进入的三个工具正是它此前**彻底看不见**的那三个；`probe_tool=archguard_get_evidence_pack` 是差集里排序第一个。

**quay 侧没有新增任何等价判定**：
```
$ git diff develop...HEAD -- plugin/scripts/ | grep '^+' | sed 's/#.*//' | grep -icE 'adr-ok|ADR-007|extractCliFlags|toCanonical|server\.tool'
⇒ 2
  其一：ac248_adr007_hits="$(… | grep -cE 'adr-ok|ADR-007' …)"   ← 自检里【反向】断言（证明生产者不含 ADR-007 判定）
  其二：selfcheck PASS 文案里的散文
```
真正的调用点是**调用目标项目自己的导出函数**：
```
1892:  process.stdout.write(JSON.stringify(m.extractMcpToolNames()));      ← import 目标项目的 scripts/check-adr.ts
1891:  if (typeof m.extractMcpToolNames !== "function") process.exit(3);    ← 导出缺失 ⇒ 读不懂 ⇒ 非 0，⛔ 不与空集同形
```

### AC4 —— 真跑真驱动（生产载体上的判据翻转）
**生产载体**：`/home/yale/work/quay/.quay/productization-verification.jsonl` 全载体 **90 行**（+3：本次传输带回 AC88 + GOAL-009-AC-201 + 本记录）。记录**原文**（`adr_check_before_tools` / `adr_check_after_tools` / 两段 CLI 原文按长度截断显示）：
```
{"build_sha":"88630f423db90bfd6cec2cb33eb92bcabb5cb860","ts":"2026-09-12T11:06:51Z","ac":"GOAL-016-AC-248","host":"instance-20221019-1509","project_root":"/home/yale/work/archguard","commit_sha":"886f40f460ec7014346ef14690acb300d8a7d1a9","commit_files":["tests/unit/scripts/check-adr.test.ts"],"task_id":"TASK-88","task_status":"done","gate_events":1,"produced_by_driver":true,"adr_check_before_detects":false,"adr_check_after_detects":true,"adr_check_probe_tool":"archguard_get_evidence_pack","adr_check_pre_rev":"a90c17b3d35a8eec9f64f0cb8bef8a609e784673","adr_check_pre_rev_source":"fix-series-boundary","adr_check_pre_rev_span":2,"adr_check_before_tools":[32 项…],"adr_check_after_tools":[35 项…],"adr_check_checker_command":"node --experimental-strip-types scripts/check-adr.ts","adr_check_before_cli_rc":"0","adr_check_after_cli_rc":"0","adr_check_before_cli":"…","adr_check_after_cli":"…"}
```
逐字段核（criterion 的谓词）：`host=instance-20221019-1509` ≠ 本机 ✓ · `project_root=/home/yale/work/archguard` ∉ 本仓库 ✓ · `commit_sha`/`task_id` 非空 ✓ · `task_status=done` ✓ · `gate_events=1>0` ✓ · `produced_by_driver=true`（严格 `is True`）✓ · `commit_files=["tests/unit/scripts/check-adr.test.ts"]` 非空且不以 `tasks/`/`goals/`/`.quay/` 开头 ✓ · **`before is False` ∧ `after is True`** ✓ · `probe_tool` 非空 ✓。

**驱动侧传输输出原文**：
```
develop-deliver: --verify-adr-flip develop=88630f423db9 target_root=/home/yale/work/archguard task_id=TASK-88 carrier=/home/yale/work/quay/.quay/productization-verification.jsonl
develop-deliver: C (ad-arm1.wan.hwang.men) — scp verify-deliver-coldstart.sh + its FULL closure … + both .tgz
develop-deliver: C (ad-arm1.wan.hwang.men) remote stdout persisted → /home/yale/work/quay/.quay/verify-adrflip-remote-C-88630f42.log (rc=0)
EVIDENCE-TRANSPORT appended=3 carrier=/home/yale/work/quay/.quay/productization-verification.jsonl evidence=/home/yale/work/quay/.quay/verify-adrflip-evidence-C-88630f42.jsonl
develop-deliver: evidence-completeness COMPLETE present=1
develop-deliver: C (ad-arm1.wan.hwang.men) — declared ac set [GOAL-016-AC-248] transported into … ✓
develop-deliver: --verify-adr-flip OK — GOAL-016-AC-248 record transported into …
```

**在被驱动的项目上真跑的那次**（远端 stdout 全文：`/home/yale/work/quay/.quay/verify-adrflip-remote-C-88630f42.log`）：
```
[⑨a] 八件（与 AC-207 同源）: task_status=done commit_sha=886f40f460ec gate_events=1 produced_by_driver=1
[⑨a] commit_files=["tests/unit/scripts/check-adr.test.ts"]
[⑨b] 修复前修订 pre_rev=a90c17b3d35a source=fix-series-boundary span=2 commit(s)
[⑨c] before 候选集（目标项目自己的检查器在 pre 修订上 scan 出的工具名，1011 字节）: ["archguard_analyze",…,"archguard_get_entity_coverage"]      ← 32 项
[⑨c] after  候选集（同一检查器在实现提交上）                                           : […,"archguard_get_evidence_pack",…]                      ← 35 项
[⑨e] probe_tool=archguard_get_evidence_pack before_detects=false after_detects=true
[⑨f] ac248 record written → … ✓
```

**生产 root 下逐字取 `goals/AC-248-*.md` 的 criterion 干跑**（payload 由该文件提取并折叠 YAML `>-` 块标量后喂 python，⛔ 不手抄；三条并列，证明翻转的成因是载体内容而非环境）：
```
exit 0 : cd /home/yale/work/quay && python3 <criterion>                                   → exit=0（无输出）
exit 1 : cd <tmp> && 载体副本剔除 ac=GOAL-016-AC-248 那行后跑同一条                        → exit=1
         stderr: AC-248: carrier holds no qualifying GOAL-016-AC-248 record (need host != local hostname,
         project_root outside this repo, …, adr_check_before_detects exactly false, adr_check_after_detects exactly true, non-empty adr_check_probe_tool)
exit 3 : cd <tmp> && rm -f .quay/productization-verification.jsonl 后跑同一条                → exit=3
         stderr: AC-248 NOT-EVALUATED: carrier .quay/productization-verification.jsonl absent — cannot read the adr-check before/after flip evidence
```

**驱动侧真跑（TASK-88 落地）的留档**：`quay driver restart --kind worker` 后的机械 fan-in `fan-in-step-trace.jsonl` 末两行
```
{"event":"step-begin","step":"ff","task":"TASK-88","runId":"wk-prod-1789210173",…}
{"event":"step-end","step":"ff","task":"TASK-88","runId":"wk-prod-1789210173",…,"ok":true}
```
`git -C /home/yale/work/archguard log --oneline develop` ⇒ `54b3cd72 tasks: 翻 TASK-88 done（driver 机械 fan-in）`；`.quay/gate-events.jsonl` = 1 行（`gate:"complete", verdict:"pass", actor:"quay-driver"`，由 `appendCompleteGateEvent` 写）。

### AC5 —— 外部交叉核对（硬规则 4b）
```
$ ssh ad-arm1 git -C /home/yale/work/archguard cat-file -t 886f40f460ec7014346ef14690acb300d8a7d1a9
commit
$ ssh ad-arm1 git -C /home/yale/work/archguard show --pretty=format: --name-only 886f40f460ec7014346ef14690acb300d8a7d1a9
tests/unit/scripts/check-adr.test.ts
```
⇒ 记录里的 `commit_files=["tests/unit/scripts/check-adr.test.ts"]` 与该 sha 的真实文件列表**逐条一致**（单元素，逐字相同）。

pre 修订的核对（AC5 允许「实现提交的 parent 或落档 pre-head」；这里是**落档并推导**的 pre-head，故核的是**祖先关系 + 它确实在修复之前**）：
```
$ ssh ad-arm1 git -C /home/yale/work/archguard merge-base --is-ancestor a90c17b3d35a8eec9f64f0cb8bef8a609e784673 886f40f460ec…
  → IS an ancestor
$ ssh ad-arm1 git -C /home/yale/work/archguard log -1 --format='%H %s' a90c17b3d35a8eec9f64f0cb8bef8a609e784673
  a90c17b3d35a8eec9f64f0cb8bef8a609e784673 tasks: TASK-88 首次登记（status=ready，promotion-driver 机械落盘）
```
**为什么 pre 不是 `<impl>^`**（AC5 的括号里那半条）：真跑实测——一次修复由多个提交组成（`eeadae3a fix(adr): …` + `886f40f4 test(adr): …`），`<impl>^` = `eeadae3a` **已经带着修复** ⇒ 两个候选集逐字相同 ⇒ 差集为空 ⇒ 无探针。`a90c17b3` 是修复段之前那条**记账边界**（只动 `tasks/TASK-88.md`），其树里的检查器是修复前的（候选集 32 项，见 AC4 的 before 原文）。反向对照：把落档 pre-head 显式传成 `<impl>^` ⇒ 差集必须为空（自检 `ac248-flip-reading` 与 `ac248-adr-check-flip-record.test.mjs` 各有一条），证明这条推导规则不是「挑那个能算出差集的」。

### AC6 —— 未测量 ≠ 不合格，且三态可区分
**写入器拒收表**（直接把【产品函数】`write_ac248_record` 逐项驱动；`plugin/test/ac248-adr-check-flip-record.test.mjs` ③b 覆盖 14 条 + 自检 13 条）：
```
REFUSED : reverse direction (true → false)          REFUSED : 0/1 impostors         REFUSED : string "false"/"true" impostors
REFUSED : before unreadable (empty)                 REFUSED : after unreadable (empty)
REFUSED : probe tool empty                          REFUSED : bookkeeping-only commit_files
REFUSED : gate_events 0                             REFUSED : produced_by_driver false
REFUSED : task not done                             REFUSED : task_id / commit_sha / host / project_root empty
```
（每一条都断言**零记录 + 返回值非 0**；正控制同时断言写出的那两个字段是 **JSON 布尔**：`assert.equal(typeof rec.adr_check_before_detects, "boolean")`。）

**判据三态 + 各冒充形态**（真 criterion payload，逐条 exit code）：
```
exit(record)              : 0        exit(after=false)         : 1
exit(after=1 literal)     : 1        exit(after="true" string) : 1
exit(before=true)         : 1        exit(before=0 literal)    : 1
exit(probe empty)         : 1        exit(bookkeeping files)   : 1
exit(host=local)          : 1        exit(project_root=local)  : 1
exit(dropped record)      : 1        exit(absent carrier)      : 3
```
**未测量 ≠ 不合格**：真跑的失败路径（TASK-88 未 done 时那次）写出的是 `AC248-NOT-EVALUATED: record NOT written (缺值≠合格): task-not-done(ready); gate-events-not-positive(0); not-produced-by-driver; no-probe-tool(…)` —— ⛔ 没有写成 `adr_check_after_detects=false`。

**传输侧同形三态**（`--selfcheck-adrflip-transport` ⇒ PASS，`plugin/test/develop-deliver-tgz-evidence-transport.test.mjs`）：
```
positive append → EVIDENCE-TRANSPORT appended=1 ；positive completeness → COMPLETE (exit 0)
negative(other-ac) → NOT-EVALUATED          （★传输成功 ≠ ★产出成功）
negative(missing/zero-lines) → NOT-EVALUATED ；json-bool-shape positive=1 impostors-refused=1
write-points(in-verify_adr_flip_mode) hits=2
```
另加一条**行为**控制（见「过程发现」3）：从 `set -e` 的 shell 里驱动 `check_evidence_completeness`，断言它既给出可区分的 `ALL-MISSING` 判词、又**继续执行**到判词之后（⛔ 不是静默中止）。

### AC7 —— 全量套件绿（外层 verification-round 验证）
scoped 门在 worktree 内绿（`bash scripts/test.sh --for-task gap-ac248-adr-check-differential-record-producer --allow-thin` ⇒ rc=0）；全量 suite 的量产生在 fan-in / 外层的 suite 轮，⛔ 不是 worker 自己的读数。

### 过程发现（5 个，都是真跑暴露出来的，⛔ 不是设计时想出来的）

1. **`<impl>^` 不是修复前修订** —— 第一次真跑（ad-arm1 的 TASK-88）拿到的两个候选集**逐字相同**：一次修复由多个提交组成（`fix(adr): …` / `test(adr): …`），而 `ac207_select_implementation_commit` 选中的是最新一条（只改了测试文件），它的 parent 已经带着修复 ⇒ 差集为空 ⇒ 无探针 ⇒ 无记录。fail-closed 方向对，但它拒的是一个**真实完成且确实让检查器翻转**的修复。修法：pre 取【整段修复序列之前】那条**记账边界**（沿第一父回溯，停在第一条记账提交上；与 AC-207 同一套按位置判据），并记录 `adr_check_pre_rev_source` / `adr_check_pre_rev_span`。**反向对照**：显式传入 `<impl>^` 作落档 pre-head ⇒ 差集必须为空（自检与测试各一条），证明这条规则不是「挑那个能算出差集的」。

2. **候选集必须在物化树里读** —— 第一版 `ac248_candidate_set` 忘了 `cd "$tree"`：真实检查器按 `process.cwd()` 定位它要扫的目录 ⇒ 对 archguard 读到 **0 个工具**（工作树里是 32 个），**退出码 0、无报错**。空候选集正是让差集算法安静少算一个工具的那个形态。夹具当时是绿的，因为它的假检查器返回硬编码数组、不看 cwd ⇒ **夹具已改成按 cwd 相对路径读输入**，所以这类缺陷现在在自检与测试里都是红的。

3. **非 0 的判定值不能是静默中止** —— 第一次真跑的负路径（没有任何 AC-248 记录）只打印到 transport 那一行就停了：`check_evidence_completeness` 的 python 在 PARTIAL / ALL-MISSING 时**故意**非 0，而 `set -e` 下的裸 `result="$(…)"` 会在那一行杀掉脚本 —— 判词与最终 FAILED 摘要都不会出现，「判为缺」与「脚本炸了」又同形（硬规则 3b）。修法用 if-形（⛔ 不是函数体内 `set +e`/`set -e`：试过，它把调用方的 errexit 提前恢复，于是函数返回非 0 就在调用方那一行把调用方杀掉 —— 实测 `--selfcheck-evidence-completeness` 停在第三条用例）。同一形状在本文件有**四处**调用点，按硬规则 5b 一起改，并加位置断言钉住。

4. **目标项目要先能被落地**（⛔ 不是本任务改的机制，是这次真跑必须先清的环境）：
   - 该项目的 `develop` 不存在（它初始化于 quay 建立 branch model 之前）⇒ fan-in 第一步 `merge develop` 直接失败（`not something we can merge`）。用**它自己的**交付物跑 `quay init --branch-model-only` 建 `develop`（机制本来就该在 init 时做这件事）。
   - 主检出停在 `master` 而 `mergeTarget` 是 `develop` ⇒ `ffMode` 会是 `push`：ref 前进了而**工作树**没动，判据要读的 `task view` 会一直读到 `ready`。把主检出切到 `develop`（= quay 自己的 landing 基线）后 ff 走 **merge 模式**。
   - 两个 8/11 的旧 loop 残留**未跟踪目录**（`milestones/`、`plugin/.quay/`）不在 ff 的 benign 白名单（只认 `?? .quay/…`）里 ⇒ merge 模式的 clean-tree 前提永不成立（实测 ff：`working tree not clean`）。移到仓外（可逆，不改任何已跟踪文件）。

5. **一次真跑的失败尝试也在生产载体上留下两条记录**（照实说明，⛔ 不隐藏）：TASK-88 尚未 done 时那次 `--verify-adr-flip` 是**负路径**（本记录未写出，`AC248-NOT-EVALUATED`），但段① 安装段自己的 `AC88` + `GOAL-009-AC-201` 两条记录照常回传并追加进了 `/home/yale/work/quay/.quay/productization-verification.jsonl`（+2 行）。它们是那次真安装/真取证的**如实**记录（`build_sha`/`tgz_sha256` 均来自真实产物），⛔ 不是伪造；但这说明**判负的运行也会改生产载体的行数** —— 读者若按行数变化判「这次跑成了」，会读错。
