---
id: AC-203
title: driver 在无 plugin/ 的第三方项目里真活——判据读载体，⛔ 不读 start 退出码
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
      if r.get("ac")!="GOAL-009-AC-203": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me: continue                 # 必须非本机
      if pr==here or pr.startswith(here+os.sep): continue   # 必须非本仓库项目
      if r.get("has_plugin_dir") is not False: continue     # 目标项目必须无 plugin/
      if int(r.get("driver_alive") or 0)!=1: continue
      if int(r.get("carrier_records") or 0)<=0: continue
      sys.exit(0)
  sys.exit(1)

  P
expect: exit 0 = 载体中存在 ac=GOAL-009-AC-203 的记录，其 host≠本机 ∧ project_root 不在本仓库内 ∧
  has_plugin_dir=false ∧ driver_alive=1 ∧ carrier_records>0。exit 1 = 无（当前）。exit
  3 = 载体缺失。
origin: "2026-09-09 B 机实测：quay driver start --kind promotion 打印 started:
  supervisor pid=2598590 且 exit=0，而 status 为 {supervisor_alive:0,
  driver_alive:0, alive:0, carrier_records:0}；真实死因只在目标项目内部日志：driver-runtime:
  driver not found at
  /tmp/xproj-metacc/plugin/scripts/promotion-driver.ts（driver-runtime.ts:986
  把路径锚在 opts.root）。"
activatedAt: 2026-09-09T11:49:14.255Z
statusLog:
  - at: 2026-09-09T11:49:14.255Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-11T00:20:42.714Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
**判据（能取假）**：2026-09-09 干跑 exit 1。**为什么不能读退出码**：今天 start 的退出码就是 0 而系统是死的 ⇒ 任何形如 exit 0 的判据恒绿且零信息（硬规则 3b：起不来与合格同形）。**复用而非新造**：start-drivers.ts:54 的 parseDriverStatus 已把「读不出」与「不活」分成两个取值，实现时复用它。**结构性反自证**：判据显式要求 host≠本机 ∧ project_root ∉ 本仓库——否则在本仓库上一跑就绿（gap-ac118 实证：自测是结构上不可能报红的绿）。