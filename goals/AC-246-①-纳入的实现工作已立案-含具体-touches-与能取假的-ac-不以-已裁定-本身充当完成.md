---
id: AC-246
title: ① 纳入的实现工作已立案——含具体 Touches 与能取假的 AC，⛔ 不以「已裁定」本身充当完成
status: achieved
kind: criterion
goal: GOAL-014
criterion: >
  python3 - <<'P'

  import glob,os,re,sys

  TD="tasks"

  if not os.path.isdir(TD):
      sys.stderr.write("NOT-EVALUATED: tasks/ 不可读\n"); sys.exit(3)
  def fm(p):
      lines=open(p,encoding="utf-8").read().splitlines()
      if not lines or lines[0].strip()!="---": return None,None
      for i in range(1,len(lines)):
          if lines[i].strip()=="---": return lines[1:i],"\n".join(lines[i+1:])
      return None,None
  seen=0; rej=[]

  for p in sorted(glob.glob(os.path.join(TD,"*.md"))):
      head,body=fm(p)
      if head is None: continue
      g=None; st=None
      for l in head:
          m=re.match(r"^goal_ac:\s*(\S+)",l)
          if m: g=m.group(1).strip().strip('"')
          m2=re.match(r"^status:\s*(\S+)",l)
          if m2 and st is None: st=m2.group(1).strip()
      if g!="AC-246": continue
      seen+=1; b=os.path.basename(p)
      if st=="superseded": rej.append(b+":superseded"); continue
      mt=re.search(r"^## Touches\s*$(.*?)(?=^## |\Z)", body, re.S|re.M)
      if not mt: rej.append(b+":no-touches"); continue
      paths=[x.strip().strip("`") for x in re.findall(r"^\s*-\s+(.+)$", mt.group(1), re.M)]
      concrete=[x for x in paths if "/" in x and not x.endswith("/") and "*" not in x]
      if not concrete: rej.append(b+":touches-not-concrete"); continue
      if len(re.findall(r"^\s*-\s*\[[ x]\]", body, re.M))<1: rej.append(b+":no-ac-checkbox"); continue
      sys.exit(0)
  sys.stderr.write("CAUSE=no-filed-implementation-task - goal_ac=AC-246 的候选任务 %d
  条，无一同时满足(非 superseded / ## Touches 含具体文件路径 / 至少一条 AC 复选框)；逐条被拒：%s\n" % (seen,
  "; ".join(rej) if rej else "(一条候选都没有)")) ; sys.exit(1)

  P
expect: exit 0 = 存在一条 goal_ac=AC-246、非 superseded、## Touches 列出具体文件路径且带至少一条 AC
  复选框的任务；exit 1 = 不存在这样的任务（stderr 逐条点名候选被拒原因）；exit 3 = tasks/
  不可读（NOT-EVALUATED）。立此 AC 当轮实跑 exit 1（候选 0 条）⇒ 判据能取假，非恒绿。
origin: 2026-09-12 人裁定 GOAL-014 选【① 纳入：建通用聚合读数】，已留痕于其 statusLog 末条 draft→active
  的 reason（AC-245 据此转绿）。本 AC 覆盖 GOAL-014 退出条件②：由该选择产生的实现工作必须【已立案】，且该任务带具体
  Touches 与能取假的 AC——⛔ 不以「已回答/已裁定」本身充当完成。判据机械扫 tasks/：goal_ac=AC-246 且非
  superseded、## Touches 含具体文件路径（⛔ 裸目录/glob 不算）、至少一条 AC 复选框；三种失败各自点名成因；载体不可读时
  exit 3（NOT-EVALUATED，不与合格同形）。取假控制已实测（同形判据在 AC-245 编号下跑过）：合格样本 exit 0；Touches
  退化为裸目录 ⇒ exit 1（touches-not-concrete）；任务标 superseded ⇒ exit 1（superseded）。
activatedAt: 2026-09-12T01:19:43.695Z
statusLog:
  - at: 2026-09-12T01:26:23.705Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
