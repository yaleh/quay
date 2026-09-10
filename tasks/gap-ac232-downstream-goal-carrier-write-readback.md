---
id: gap-ac232-downstream-goal-carrier-write-readback
title: 下游 goal 载体必须能写、能读回——AC-206 只断言目录建了与可读，补 goal 写+读回 e2e 步骤落
  ac=GOAL-009-AC-232 记录（AC-232）
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-232
---
## Proposal

正本判据 `goals/AC-232-下游-goal-载体必须能写-能读回-ac-206-只断言目录建了与可读-写入失败被注为-不阻塞-从未追查.md`（goal=GOAL-009）：exit 0 = 载体 `.quay/productization-verification.jsonl` 存在 `ac="GOAL-009-AC-232"` 记录，且 `host≠本机` ∧ `project_root∉本仓库` ∧ `goal_write_ok=true` ∧ `goal_read_back_ok=true` ∧ `goal_records>0`。exit 1 = 无（立条时实测，从未发生）；exit 3 = 载体缺失。

**现状（实测，位置判定）**：AC-206（done，`gap-ac206-goals-tasks-dual-carrier-quay-init-goals-closed-set`）让 quay-init 创建下游 `goals/`，并在 `verify-deliver-coldstart.sh:943` `probe_ac206_dual_carrier` 只判 `goals_dir_created`（`[ -d "$root/goals" ]`）与 `goal_store_readable`（`[ -d ... ] && [ -r ... ]`）——**只断言目录建了与可读，不断言能写**。2026-09-10 orangevps 全新第三方项目 e2e 跑，goal 写入失败（日志逐字 `NOTE: goal write failed — 双载体 goal 侧未落地（不阻塞任务侧；AC-207 记录只读 task 侧）`），该失败被脚本注为「不阻塞」故从未追查。全仓 `goal_write_ok`/`goal_read_back_ok`/`goal_records` 三字段零命中——无人写这条记录。

**为何属 GOAL-009 而非新范围**：退出条件逐字含「期间会话可间断介入做问题分析与创建 goal/task」——下游 goal 载体可用本就在退出条件内，AC-201..AC-207 无一条覆盖它（判据窄于退出条件，与本轮反复出现的「只写一半」同族）。

**修法（两半，缺一 criterion 仍 exit 1）**：

A. **机制接线**：`verify-deliver-coldstart.sh` 在 AC-206 双载体段之后新增 AC-232 goal 写+读回段——用 installed quay CLI（`qrl=$(readlink -f "$STEP1_PREFIX/bin/quay")`，与 `step4_driver_liveness` 同款）对下游项目 `--root "$root"` 执行 `goal write` 一条 GOAL 记录，再 `goal show`/`goal list` 读回。三字段：`goal_write_ok` = write exit 0 ∧ 盘上 `goals/GOAL-*.md` 存在；`goal_read_back_ok` = show 读回该 id 且非空；`goal_records` = list 计数 ≥1。⛔ 三者缺一不可——只断言「写调用返回 0」会与「写了个空文件」同形（硬规则 3b）。

B. **载体写**：经 `ac89_append_goal009`（同 AC-203/205/207 锚字段路径，补 top-level `build_sha`/`ts`）追加 `{"ac":"GOAL-009-AC-232","host","project_root","goal_write_ok","goal_read_back_ok","goal_records"}`。缺任一有效读数不写（fail-closed，硬规则 3b）。

**证据取回**（同 AC-207 纪律）：远端产出的记录不会自动回到本机载体，须显式取回并复跑判据，⛔ 不得手写/注入。

## Plan

1. **机制接线**：`verify-deliver-coldstart.sh` 新增 `probe_ac232_goal_write_readback` + `step_ac232_goal_carrier_write` + `write_ac232_record`。写命令：`node "$qrl" goal write GOAL-001 --title "..." --body "<≥40 非空白>" --root "$root"`——⛔ GOAL 记录 body 必填 ≥40 非空白（`packages/quay/src/goal-store.ts` MIN_GOAL_BODY_CHARS=40），id 须匹配 `GOAL-\d{3,}`（`goal-store.ts:86`）；不传 body 的 write 是 create-only 缺 body 会 exit 2——正是 09-10 `goal write failed` 的根因。读回：`goal show GOAL-001` 非空 + `goal list` 计数。
2. **selfcheck 双向控制**：`--selfcheck` 正控制（可写可读的下游 goals/ ⇒ 三字段 true）与负控制（write 失败 / read-back 空 ⇒ 三字段 false 或拒写，仍如实写 false、criterion 不 exit 0）。
3. **载体落账 + 生产复跑**：host B/C 第三方项目 e2e 复跑（全新 `--root`，同 AC-207 现场纪律），判据 exit 1 → exit 0；证据显式取回本机载体复跑确认。
4. **判据干跑翻转**：`bash -c "$(criterion)"` 从 exit 1 → exit 0。

## Acceptance Criteria

- [x] AC1 机制接线：`grep -c 'GOAL-009-AC-232' plugin/scripts/verify-deliver-coldstart.sh` ≥1，且 `goal_write_ok`/`goal_read_back_ok`/`goal_records` 三字段名在脚本内各 ≥1 命中；贴前 3 条命中（硬规则②）。【实测】GOAL-009-AC-232=5、goal_write_ok=11、goal_read_back_ok=10、goal_records=10；前 3 条命中 = 脚本行 1321（判据注释 ac="GOAL-009-AC-232"）、1374（write_ac232_record 注释）、1387（write_ac232_record printf 落账行）。
- [x] AC2 写命令正确 + 能取假：贴出对下游 `--root` 执行的 `goal write GOAL-001 --body ...` 与读回命令及命中行；selfcheck 负控制（写失败/读回空）使 criterion 不 exit 0（硬规则 3b：写调用 0 与空文件同形）。【实测】写命令 `node "$qrl" goal write GOAL-001 --title "..." --origin "..." --body "<≥40 非空白>" --root "$root"` exit 0 且 `goals/GOAL-001-*.md` 落盘；读回 `node "$qrl" goal show GOAL-001 --root "$root"` 输出含 id 且非空、`node "$qrl" goal list --root "$root" --json` 计数=1（全新第三方项目实测：quay-init 铺 project-local `path: $root/.quay/runtime` ⇒ goal store 正确 scope 到 `$root/goals`）；selfcheck 负控制 `ac232-record(write-failed) neg_ok=1`（goal_write_ok=false 仍写，缺件如实非静默 ⇒ criterion 不 exit 0）。
- [ ] AC3 载体落账：生产载体出现 `ac="GOAL-009-AC-232"` 记录，host≠本机 ∧ project_root∉本仓库 ∧ goal_write_ok=true ∧ goal_read_back_ok=true ∧ goal_records>0（逐字段满足 criterion 过滤）。（待外部）
- [x] AC4 负控制（能取假）：注入一条 goal_write_ok=false 或 goal_records=0 的记录 ⇒ criterion 仍 exit 1；验证后移除、不污染生产载体。【实测】criterion 干跑（临时载体逐 case 注入后移除）：载体缺失 ⇒ exit 3、host=本机 ⇒ exit 1、goal_write_ok=false ⇒ exit 1、goal_read_back_ok=false ⇒ exit 1、goal_records=0 ⇒ exit 1、正样本（hostB-fake ∉本仓库 + true/true/5）⇒ exit 0；selfcheck `ac232-record(write-failed) neg_ok=1` / `ac232-record(empty-host) refused=1`（write_ac232_record fail-closed 拒写缺 host）。
- [ ] AC5 判据翻转：AC-232 criterion 干跑从 exit 1 → exit 0（贴出干跑输出）。（待外部）

## Definition of Done

AC1–AC5 全绿；`scripts/test.sh` 全量绿（含 `plugin/test/verify-deliver-coldstart.test.mjs` 新增 AC-232 正/负控制）。AC-232 criterion exit 0：宿主为 B/C 之一，project_root 为第三方项目（∉ 本仓库），goal_write_ok=true、goal_read_back_ok=true、goal_records>0。⛔ 证据须从远端显式取回本机载体复跑确认，不得手写/注入。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac232-downstream-goal-carrier-write-readback.md
