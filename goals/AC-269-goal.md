---
id: AC-269
title: CI 红有机械归因：每条 failure 记录带 {real-defect, infrastructure, known-flake} 之一
status: achieved
kind: criterion
goal: GOAL-020
criterion: |-
  python3 - <<'P'
  import json, os, subprocess, sys
  from datetime import datetime, timezone
  ATTR = "plugin/scripts/ci-red-attribute.ts"
  CAR = ".quay/ci-runs.jsonl"
  VOCAB = ("real-defect", "infrastructure", "known-flake")
  def epoch(s):
      try: d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
      except Exception: return None
      return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()
  land_s = subprocess.run(["git","log","-1","--format=%ct","--",ATTR],capture_output=True,text=True).stdout.strip()
  if not land_s:
      sys.stderr.write("CAUSE=attributor-not-landed — no commit touches %s => nothing mechanically classifies a red CI run, which is precisely the cost this AC exists to remove (2026-09-15: defining one batch of reds took a human read of a 15684-line log)\n" % ATTR); sys.exit(1)
  land = int(land_s)
  land_txt = datetime.fromtimestamp(land, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
  if not os.path.exists(CAR):
      sys.stderr.write("CAUSE=carrier-absent — %s does not exist => the attributor landed at %s but no run record has ever been written\n" % (CAR, land_txt)); sys.exit(1)
  post, bad = [], 0
  for ln in open(CAR, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      ts = epoch(r.get("ts"))
      if ts is None: bad += 1; continue
      if ts > land: post.append(r)
  note = "" if bad == 0 else " [%d carrier rows had a missing/unparseable ts and were not placed in the window]" % bad
  if not post:
      sys.stderr.write("CAUSE=collection-stalled — carrier holds no record with ts after the attributor landing %s (compared as instants, not strings) => either no CI has run since, or the collector stopped writing; both leave this AC unverifiable on production data%s\n" % (land_txt, note)); sys.exit(1)
  reds = [r for r in post if r.get("conclusion") == "failure"]
  if not reds:
      # Legitimate vacuous-but-honest state: collection is demonstrably alive (post is non-empty) and
      # nothing went red, so the attributor has had nothing to classify. NOT a silent pass on absent data.
      sys.exit(0)
  missing = [r for r in reds if r.get("attribution") not in VOCAB]
  if missing:
      sys.stderr.write("CAUSE=red-unattributed — %d of %d post-landing red runs carry no attribution from %r (first 3: %r) => a red still has to be classified by hand\n" % (len(missing), len(reds), list(VOCAB), [(r.get("runId"), r.get("attribution")) for r in missing[:3]])); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = 归因器 plugin/scripts/ci-red-attribute.ts 已落地 ∧ 载体中存在 ts
  晚于其落地的记录（证明采集在跑）∧ 其中每一条 conclusion=failure 的记录都带取值于 {real-defect,
  infrastructure, known-flake} 的 attribution。落地后有记录但无 failure ⇒ exit
  0（归因器无事可做，且采集活性已由非空记录证明，非静默空过）。exit 1 且 stderr 带 CAUSE=attributor-not-landed /
  carrier-absent / collection-stalled / red-unattributed。
origin: 立案动因 2026-09-15：为给一批 CI 红定性（真缺陷 / job 超时截断 / 已知负载 flake 三类混在一起），需要人肉读
  15684 行日志并跨 4 次 run 比对失败集合。无机械归因则每次红都要重复这个成本，持续驱动无法成立。
activatedAt: 2026-09-15T11:34:27.561Z
statusLog:
  - at: 2026-09-15T11:34:27.561Z
    from: draft
    to: active
    actor: manager
    reason: 激活：判据已当轮干跑验证能取假（AC-266 另做了双向控制）
  - at: 2026-09-15T13:41:23.213Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-15T11:34:27.560Z
---
