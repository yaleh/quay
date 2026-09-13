---
id: AC-250
title: 观察面：目标项目的 quay web server 绑在 ad-arm1 的 tailscale0 IP 上且真的反映进展（⛔ 不判单点渲染）
status: achieved
kind: criterion
goal: GOAL-016
criterion: >-
  python3 - <<'P'

  import json,os,socket,sys

  p=".quay/productization-verification.jsonl"

  if not os.path.exists(p): sys.stderr.write("AC-250 NOT-EVALUATED: carrier
  .quay/productization-verification.jsonl absent — cannot read the
  web-observability evidence\n"); sys.exit(3)

  me=socket.gethostname(); here=os.path.realpath(".")

  BAD=("127.","0.0.0.0","::","localhost","")

  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      r=json.loads(l)
      if r.get("ac")!="GOAL-016-AC-250": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me or pr==here or pr.startswith(here+os.sep): continue
      bh=str(r.get("bind_host") or ""); ts=str(r.get("tailscale0_ip") or "")
      if not bh or not ts or bh!=ts: continue
      if bh=="localhost" or bh=="0.0.0.0" or bh=="::" or bh.startswith("127."): continue
      pf=str(r.get("probe_from_host") or "")
      if not pf or pf==h: continue
      if int(r.get("http_status") or 0)!=200: continue
      if not r.get("observed_task_id"): continue
      sb=r.get("observed_status_before"); sa=r.get("observed_status_after")
      if not sb or not sa or sb==sa: continue
      if r.get("store_status_after")!=sa: continue
      sys.exit(0)
  sys.stderr.write("AC-250: carrier holds no qualifying GOAL-016-AC-250 record
  (need host != local hostname, project_root outside this repo, bind_host equal
  to tailscale0_ip and neither empty nor loopback, non-empty probe_from_host
  different from the target host, http_status 200, non-empty observed_task_id,
  non-empty and differing observed_status_before/observed_status_after,
  store_status_after equal to observed_status_after)\n"); sys.exit(1)

  P
expect: exit 0 = 载体中存在 ac=GOAL-016-AC-250 的记录，host≠本机 ∧ project_root ∉ 本仓库 ∧
  bind_host==tailscale0_ip 且二者非空、非 127./0.0.0.0/::/localhost（serve 真绑在
  tailscale0 而非回环）∧ probe_from_host 非空且≠目标主机（探测由另一台机器发起，证明跨机真可达）∧
  http_status=200 ∧ observed_task_id 非空（页面里真有目标项目的任务，非空壳/默认页）∧
  **observed_status_before 与 observed_status_after 均非空且互不相等**（两个时间点观察到状态发生变化 =
  反映【进展】，⛔ 不是显示了一个静态快照）∧ store_status_after==observed_status_after（web 所示与 store
  真值一致，⛔ 非陈旧缓存）。exit 1 = 无合格记录（当前：ad-arm1 上 4173 无人监听、无 serve 进程）。exit 3 = 载体缺失。
origin: 人 2026-09-12 追加：验证过程中应在 ad-arm1 的 tailscale0 IP 为目标项目运行 quay web
  server，验证 quay web 可正常反映项目进展，并便于人观察。2026-09-12 实测该主机
  tailscale0=100.100.148.48；原有一个绑 100.100.148.48:4173 的 serve 进程随本日 user-scope
  quay 卸载一并停掉，当前 4173 无监听、无 serve 进程 ⇒ 本 AC 今天结构上必然取假。判据不硬编码该 IP（要求
  bind_host==tailscale0_ip，推导而非复制副本）。
activatedAt: 2026-09-12T09:06:45.143Z
statusLog:
  - at: 2026-09-12T11:48:17.534Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
---
**判据（能取假）**：2026-09-12 干跑 exit 1。**今天的结构性取假**：ad-arm1 上 `ss -ltnp` 对 4173 无监听、无任何 `quay serve` 进程（该主机原有一个绑 100.100.148.48:4173 的 serve，随本日 user-scope quay 卸载一并停掉）⇒ 本 AC 今天不可能为真。**为什么不能只判「起得来」**：`quay serve` 进程存在、端口在听、HTTP 200——这三样加起来仍**只证明有一个 web 服务活着**，不证明它反映的是**目标项目**、更不证明它跟随**进展**更新。⇒ 判据分三层，逐层堵死：①**绑对地址**（`bind_host==tailscale0_ip` 且非回环——绑 127.0.0.1 时人在别的机器上根本看不到，直接违背「便于观察」这个目的）；②**跨机真可达**（`probe_from_host≠host`，探测由判读侧发起，⛔ 不采信目标机自己 curl 自己）；③**反映进展**（`observed_status_before≠observed_status_after` 且 `store_status_after` 与之一致）。**第③层是本 AC 的灵魂**：一个只在首次渲染时读一次 store 的页面、或一个缓存过期的页面，都能满足①②而在③上失败——**「显示了一个页面」与「反映了进展」的区分量就是这个差分**，同 AC-248 只认翻转不认单点的理由。**与 AC-247 的分工**：AC-247 判 driver 真活（后台执行面），本 AC 判 web 真反映（观察面）；driver 活着而 web 显示不动、或 web 好看而 driver 没活，两条各自独立取假。**人 2026-09-12 追加**：本 AC 的目的之一是让人能在验证过程中实时观察目标项目进展，⛔ 不是补一个事后截图。

**范围定位（2026-09-12 scope 审计，人裁定后补）**：**本 AC 属于【可观测性 / 运维面】目标，
⛔ 不参与 GOAL-016「驱动出的开发对不对」这一业务命题的论证。**
它源自人 2026-09-12 中途追加的「便于我观察」，被挂进了 GOAL-016——这是**范围污染**，
如实记录而非事后粉饰。本 AC 已 achieved 且证据扎实（bind_host==tailscale0_ip、跨机探测 200、
todo→ready 真实翻转、store 一致），**其价值成立**；只是它证明的是「人能看见进展」，
与「驱动出的改动是否正确/完整」是两个正交的维度。
⇒ 统计 GOAL-016 对业务目标的支撑度时，**不要把本 AC 计入**。
