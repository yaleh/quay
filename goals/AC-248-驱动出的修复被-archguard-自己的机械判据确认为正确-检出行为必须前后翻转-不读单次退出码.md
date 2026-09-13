---
id: AC-248
title: 驱动出的修复被 archguard 自己的机械判据确认为正确——检出行为必须前后翻转，⛔ 不读单次退出码
status: achieved
kind: criterion
goal: GOAL-016
criterion: >-
  python3 - <<'P'

  import json,os,socket,sys

  p=".quay/productization-verification.jsonl"

  if not os.path.exists(p): sys.stderr.write("AC-248 NOT-EVALUATED: carrier
  .quay/productization-verification.jsonl absent — cannot read the adr-check
  before/after flip evidence\n"); sys.exit(3)

  me=socket.gethostname(); here=os.path.realpath(".")

  BOOK=("tasks/","goals/",".quay/")

  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      r=json.loads(l)
      if r.get("ac")!="GOAL-016-AC-248": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me or pr==here or pr.startswith(here+os.sep): continue
      if not r.get("commit_sha") or not r.get("task_id"): continue
      if r.get("task_status")!="done": continue
      if int(r.get("gate_events") or 0)<=0: continue
      if r.get("produced_by_driver") is not True: continue
      cf=r.get("commit_files")
      if not isinstance(cf,list) or not cf: continue
      if all(str(x).startswith(BOOK) for x in cf): continue
      if r.get("adr_check_before_detects") is not False: continue
      if r.get("adr_check_after_detects") is not True: continue
      if not r.get("adr_check_probe_tool"): continue
      sys.exit(0)
  sys.stderr.write("AC-248: carrier holds no qualifying GOAL-016-AC-248 record
  (need host != local hostname, project_root outside this repo, non-empty
  commit_sha and task_id, task_status done, gate_events greater than zero,
  produced_by_driver exactly true, commit_files a non-empty list with at least
  one path outside tasks/ goals/ .quay/, adr_check_before_detects exactly false,
  adr_check_after_detects exactly true, non-empty adr_check_probe_tool)\n");
  sys.exit(1)

  P
expect: exit 0 = 载体中存在 ac=GOAL-016-AC-248 的记录，host≠本机 ∧ project_root ∉ 本仓库 ∧
  commit_sha 与 task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧
  produced_by_driver=true ∧ commit_files 是非空列表且至少一条不在 tasks/ goals/ .quay/
  之下（区分实现提交 vs 记账提交，沿用 GOAL-009 AC-207）∧ **adr_check_before_detects 严格为 false ∧
  adr_check_after_detects 严格为 true**（archguard 自己的检查器对该输入形态的行为必须发生翻转；用 is False
  / is True 而非 truthy，使缺字段/null 不能冒充 false）∧ adr_check_probe_tool
  非空（记录用哪个工具名作探针）。exit 1 = 无合格记录（当前，从未发生）。exit 3 = 载体缺失。
origin: GOAL-009 AC-207 逐字承认它判的是『commit_files 至少一条不在 tasks/ goals/ .quay/
  之下』，即『有一个触及非记账文件的提交』——一个改错了的提交同样满足它。本 AC 接在该边界上：正确性由 archguard 自己的
  scripts/check-adr.ts 判定，quay 只搬运读数。2026-09-12
  本会话已独立复现该缺陷并验证其最小复现，故靶子是真实缺陷而非为验证而编的练习题（硬规则 4 推论三）。
activatedAt: 2026-09-12T08:43:31.523Z
statusLog:
  - at: 2026-09-12T11:09:07.455Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
---
**判据（能取假）**：2026-09-12 干跑 exit 1（从未发生过）。**为什么必须是「翻转」而不是「跑通」**：本缺陷的表现形式正是 `npm run check:adr` 打印 `ADR-007: OK` 并 exit 0——**漏检与合格同形**（硬规则 3b）。任何形如「跑了 check:adr 且 exit 0」的判据今天就已经是绿的 ⇒ 零信息。⇒ 只有「同一输入形态下，修复前 detects=false、修复后 detects=true」这个**差分**才携带信息。**取假的两个方向都堵死**：①若 worker 交出一个改了但没修对的提交 ⇒ after 仍 false ⇒ 红；②若有人把 before 直接写成 true 想凑翻转 ⇒ `before is False` 失败 ⇒ 红。**正确性判据不由 quay 拥有**：detects 的取值由 archguard 自己的 `scripts/check-adr.ts` / 其单测跑出，quay 只搬运读数，⛔ 不自行实现一个「等价」的判定（那会变成 quay 给自己打分）。**与 GOAL-009 AC-207 的本质差别**：AC-207 判「有一个触及非记账文件的提交」，本 AC 判「**这个提交让一个外部的、独立的机械判据从假变真**」。**照实说明的边界**：本 AC 同样**不能排除人在会话里手敲**（沿用 AC-207 对 `produced_by_driver` 的自陈），它只把门槛从「敲出一个提交」提高到「敲出一个能让外部判据翻转的正确修复」；⛔ 不冒充解决了 AC-207 没解决的那半个问题。**外部可核**：commit_sha 与 commit_files 必须经 ssh 从 ad-arm1 的 archguard git 历史交叉核对（人 2026-09-12 裁定不推 origin ⇒ 无裸仓库镜像可用），⛔ 不采信载体自述（硬规则 4b）。