---
id: AC-232
title: 下游 goal 载体必须能写、能读回——AC-206 只断言目录建了与可读，写入失败被注为「不阻塞」从未追查
status: achieved
kind: criterion
goal: GOAL-009
criterion: >-
  python3 - <<'P'

  import json,os,socket,sys

  p=".quay/productization-verification.jsonl"

  if not os.path.exists(p): sys.stderr.write("NOT-EVALUATED: carrier absent\n");
  sys.exit(3)

  me=socket.gethostname(); here=os.path.realpath(".")

  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      r=json.loads(l)
      if r.get("ac")!="GOAL-009-AC-232": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me: continue
      if pr==here or pr.startswith(here+os.sep): continue
      if r.get("goal_write_ok") is not True: continue
      if r.get("goal_read_back_ok") is not True: continue
      if int(r.get("goal_records") or 0)<=0: continue
      sys.exit(0)
  sys.exit(1)

  P
expect: >-
  exit 0 = 生产载体存在 `ac="GOAL-009-AC-232"` 记录，且 `host ≠ 本机` ∧ `project_root ∉ 本仓库`
  ∧ `goal_write_ok=true` ∧ `goal_read_back_ok=true` ∧ `goal_records > 0`。exit 1
  = 无（立条时实测，从未发生）。exit 3 = 载体缺失。


  **为什么这条属于 GOAL-009 而不是新范围**：GOAL-009 退出条件逐字含「期间会话可**间断介入**做问题分析与**创建
  goal/task**（正如本项目当前形态）」——**下游 goal 载体可用本就在退出条件内**，只是 AC-201..AC-207
  无一条覆盖它（判据窄于退出条件，与本轮反复出现的「只写一半」同族）。


  **立条时的实测缺口**：2026-09-10 orangevps 全新第三方项目的 e2e 跑，日志逐字 `NOTE: goal write failed
  — 双载体 goal 侧未落地（不阻塞任务侧；AC-207 记录只读 task 侧）`。⇒ **task 载体可用而 goal
  载体写入失败**，且该失败被脚本注为「不阻塞」故从未被当作缺陷追查。AC-206 只断言
  `goals_dir_created`/`goal_store_readable`（目录建了、可读），**不断言能写**——这正是缺口所在。


  **三个字段各自的取假方向**：`goal_write_ok` 假 ⇒ 写不进；`goal_read_back_ok` 假 ⇒
  写了读不回（写入未持久/格式不可解）；`goal_records > 0` 假 ⇒ 读回为空。⛔ 三者缺一不可——只断言「写调用返回
  0」会与「写了个空文件」同形（硬规则 3b）。


  **证据取回**：同 AC-207，远端产出的记录不会自动回到本机载体，须显式取回并复跑判据，⛔ 不得手写/注入。
origin: >-
  立条依据（人 2026-09-10 令「应当优先更新 goal」后设立）：


  【实测缺口】2026-09-10 orangevps 全新第三方项目（/home/yale/work/ac207-e2e-verify）的 e2e
  跑，日志逐字 `NOTE: goal write failed — 双载体 goal 侧未落地（不阻塞任务侧；AC-207 记录只读 task
  侧）`。task 载体可用、goal 载体写入失败；该失败被脚本自身注为「不阻塞」，因而从未被当作缺陷追查过。


  【为何属 GOAL-009 现有范围而非新范围】GOAL-009 退出条件逐字：「期间会话可间断介入做问题分析与创建
  goal/task（正如本项目当前形态）」——下游 goal 载体可用本就在退出条件之内。缺的是判据：AC-201..AC-207 无一条覆盖 goal
  侧；AC-206 只断言目录已建与 store 可读（`goals_dir_created`/`goal_store_readable`），不断言能写。⇒
  判据窄于退出条件（本轮反复出现的「只写一半」同族，前例：GOAL-010 退出条件①、AC-217、AC-223）。


  【判据形态】沿用 GOAL-009 家族既有形态（读 .quay/productization-verification.jsonl 的跨机记录），与
  AC-203/204/206 同构，⛔ 不新造载体。立条当轮干跑 exit 1（可评估、非 spawn 失败），符合硬规则 4c。


  【类别纪律】判据只引用不会自行回退的量——append-only 载体里的历史事实，⛔ 不含进程存活/远程主机可达性。
activatedAt: 2026-09-10T14:05:04.892Z
statusLog:
  - at: 2026-09-10T14:05:04.892Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-09-11T00:20:50.437Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-10T14:05:04.892Z
---
