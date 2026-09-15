---
id: AC-265
status: active
kind: criterion
goal: GOAL-020
criterion: |-
  python3 - <<'P'
  import json, os, subprocess, sys
  CAR = ".quay/ci-runs.jsonl"
  COLLECTOR = "plugin/scripts/ci-runs-collect.ts"
  land = subprocess.run(["git","log","-1","--format=%cI","--",COLLECTOR],capture_output=True,text=True).stdout.strip()
  if not land:
      sys.stderr.write("CAUSE=collector-not-landed — no commit touches %s => the CI-conclusion collector does not exist, so there is no post-landing window to read (criterion reads a local carrier on purpose: gh is not on the driver's PATH and a network/auth failure would be indistinguishable from a red CI)\n" % COLLECTOR); sys.exit(1)
  if not os.path.exists(CAR):
      sys.stderr.write("CAUSE=carrier-absent — %s does not exist => the collector landed at %s but has never written a run record\n" % (CAR, land)); sys.exit(1)
  rows = []
  for ln in open(CAR, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      if r.get("branch") != "develop": continue
      if r.get("workflow") not in (None, "ci.yml", "CI"): continue
      if r.get("conclusion") not in ("success", "failure"): continue
      ts = str(r.get("ts") or "")
      if not ts: continue
      rows.append((ts, r.get("conclusion"), r))
  rows.sort(key=lambda x: x[0])
  post = [x for x in rows if x[0] > land]
  if not post:
      sys.stderr.write("CAUSE=no-decisive-run-after-landing — carrier holds %d decisive develop runs in total but none with ts > the collector landing %s (cancelled runs are excluded by design: 43%% of develop runs are superseded pushes, not reds)\n" % (len(rows), land)); sys.exit(1)
  greens = [i for i, x in enumerate(rows) if x[1] == "success" and x[0] > land]
  if not greens:
      sys.stderr.write("CAUSE=still-red — %d decisive develop CI runs after %s, none with conclusion=success (baseline at filing: 0 successes in 52 decisive runs)\n" % (len(post), land)); sys.exit(1)
  gi = greens[0]
  g = rows[gi][2]
  gf = g.get("testFiles")
  if not isinstance(gf, int):
      sys.stderr.write("CAUSE=green-run-missing-testFiles — the green run %s carries no integer testFiles field, so the anti-gaming relation cannot be evaluated at all\n" % g.get("runId")); sys.exit(1)
  if gi == 0:
      sys.stderr.write("CAUSE=no-preceding-decisive-run — the green run %s is the earliest decisive run in the carrier, so there is no neighbour to compare testFiles against\n" % g.get("runId")); sys.exit(1)
  p = rows[gi-1][2]
  pf = p.get("testFiles")
  if not isinstance(pf, int):
      sys.stderr.write("CAUSE=preceding-run-missing-testFiles — the decisive run immediately before the green one (%s) carries no integer testFiles, so the relation cannot be evaluated\n" % p.get("runId")); sys.exit(1)
  if gf < pf:
      sys.stderr.write("CAUSE=green-bought-by-skipping — green run %s ran %d test files while the immediately preceding decisive run %s ran %d => the green was bought by running FEWER tests, which is exactly the gaming shape this relation exists to catch\n" % (g.get("runId"), gf, p.get("runId"), pf)); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = 载体 .quay/ci-runs.jsonl 中存在一次
  branch=develop、workflow=ci、conclusion=success 且 ts 晚于采集器落地提交时刻的 decisive run，∧
  该 run 的 testFiles ≥ 紧邻前一次 decisive run 的 testFiles（反作弊关系，非快照）。exit 1 且 stderr
  带 CAUSE=：collector-not-landed / carrier-absent / no-decisive-run-after-landing
  / still-red / green-bought-by-skipping 等，各自指明是仪器缺位还是真红。cancelled run 按设计不计（43%
  的 develop run 是被后续 push 顶替）。
origin: 立案实测 2026-09-15：develop 上 92 次 CI run 零成功（52 failure / 40
  cancelled），decisive 绿率 0/52；最后一次任何分支的绿是 2026-08-03（master）。故 develop
  首绿是待达成的新状态。
activatedAt: 2026-09-15T11:46:20.098Z
statusLog:
  - at: 2026-09-15T11:46:20.098Z
    from: draft
    to: active
    actor: manager
    reason: 激活（--force）：criterion 三次干跑均确定取假(195/198ms,
      CAUSE=collector-not-landed)；fidelity judge 连续两次 exit 143(SIGTERM/180s
      超时)不可读，故以人工双向控制替代其保证——隔离 fixture 正控制(files 640>=631)exit 0、负控制(files
      610<631)exit 1 并指名 green-bought-by-skipping。⛔ force 越过的仅是 judge
      不可读，criterion 本身已跑且能取真能取假。
long-term: true
fidelity:
  verdict: forced
  reason: --force override (skipped evaluability + fidelity gates)
  at: 2026-09-15T11:46:20.097Z
---
