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

  kinds=set()

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
      k=str(r.get("kind") or "").strip()
      if not k: continue                          # 缺 kind 的记录不计入（缺值≠合格, 硬规则 6）
      kinds.add(k)

  if len(kinds)>=2: sys.exit(0)

  sys.stderr.write("GOAL-009-AC-203: 合格记录覆盖的 kind=%s （需要 >=2 个不同的 driver kind）\n" % sorted(kinds));
  sys.exit(1)

  P
expect: exit 0 = 载体中存在 ac=GOAL-009-AC-203 的记录，其 host≠本机 ∧ project_root 不在本仓库内 ∧
  has_plugin_dir=false ∧ driver_alive=1 ∧ carrier_records>0，且这些记录携带的 kind 取值
  【至少两个不同】。exit 1 = 无（含「只有一种 kind」——缺 kind 的记录不计入）。exit
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

**kind 维度（2026-09-13，gap-ac203-record-schema-has-no-kind-dimension）**：本判据原为五字段过滤，**结构上无法区分验的是哪个 driver kind**（实测：载体里 3 条记录字段集全无 kind，全部来自 promotion）⇒ 它的绿只能说明「**某一个**（未记录是哪个）kind 在第三方项目里活过」，⛔ 不能说明标题那句「driver 在第三方项目里真活」。人 2026-09-13 裁定所有 driver kind 都要在目标项目实际运行后，覆盖对象由 1 个 kind 扩到 5 个 ⇒ 判据必须能区分。现加两条：① 记录必须带非空 `kind`（缺 kind 的记录**不计入**，⛔ 不是「当作合格」——缺值≠合格，硬规则 6）；② 合格记录的 kind 取值**至少两个不同**。选「每个 kind 各一条记录、判据取并集」而不是「一条记录携带已验证 kind 的集合」：产出路径本来就是一次 `driver start --kind <k>` 写一条（append-only 的原子观测，各自带自己的 host/ts/build_sha），把 N 次观测压进一条记录会要求 writer 去**拼**一个自己没验过的集合。⛔ 取「≥2 个不同」而不是「五个全要」是本 AC 的边界（AC1 逐字如此；五个 kind 在 archguard 上的实跑属另一条边界，见该任务 DoD）——判据对 kind 个数是通用的，将来要收紧只需改这一个常量。