---
id: AC-281
title: 真实 develop CI test job 一次 success 且 durationSec <= 30（本 GOAL 立案之后的读数）
status: superseded
kind: criterion
goal: GOAL-022
criterion: >-
  python3 - <<'CRIT2'

  import json, os, sys


  CAR = ".quay/ci-runs.jsonl"

  SINCE = "2026-09-17T00:36:33Z"

  THRESHOLD_SEC = 30


  if not os.path.exists(CAR):
      sys.stderr.write("CAUSE=carrier-absent — %s does not exist, so no CI-run outcome can be read at all\n" % CAR); sys.exit(1)

  rows = []

  for ln in open(CAR, encoding="utf-8"):
      ln = ln.strip()
      if not ln:
          continue
      try:
          r = json.loads(ln)
      except Exception:
          continue
      if r.get("workflow") != "CI":
          continue
      if r.get("branch") != "develop":
          continue
      if str(r.get("ts") or "") <= SINCE:
          continue
      rows.append(r)

  if not rows:
      sys.stderr.write("CAUSE=no-post-filing-run — no CI run on develop with ts > %s exists yet in %s; this AC cannot be satisfied by a run that happened before it was filed (hard rule 3b)\n" % (SINCE, CAR)); sys.exit(1)

  rows.sort(key=lambda r: r.get("ts") or "")

  latest = rows[-1]


  test_job = None

  for j in latest.get("jobs") or []:
      if j.get("name") == "test":
          test_job = j
          break

  if test_job is None:
      sys.stderr.write("CAUSE=no-test-job-in-latest-run — the latest post-filing CI run (%s, %s) has no 'test' job entry\n" % (latest.get("runId"), latest.get("url"))); sys.exit(1)

  conclusion = test_job.get("conclusion")


  if conclusion != "success":
      sys.stderr.write("CAUSE=latest-run-not-green — the latest post-filing CI test job (%s) concluded '%s', not 'success'; a fast-but-broken run does not satisfy this AC\n" % (latest.get("url"), conclusion)); sys.exit(1)

  scheduler_ms = test_job.get("schedulerMs")


  if scheduler_ms is None:
      sys.stderr.write("CAUSE=scheduler-ms-not-recorded — the latest post-filing CI test job (%s) carries no schedulerMs reading, so the suite's own scheduler wall-clock cannot be judged from this carrier. This is NOT-EVALUATED, not 'too slow'.\n" % latest.get("url")); sys.exit(1)

  scheduler_sec = scheduler_ms / 1000.0


  if scheduler_sec > THRESHOLD_SEC:
      sys.stderr.write("CAUSE=too-slow — the latest post-filing CI test job's own suite scheduler (%s) took %.1fs, still above the %ss target (job-level durationSec is no longer the measured quantity — 2026-09-17 human ruling: only the suite's own scheduler_ms counts, not fixed job overhead like checkout/npm install/runner teardown)\n" % (latest.get("url"), scheduler_sec, THRESHOLD_SEC)); sys.exit(1)

  print("OK — CI test job %s (run %s, %s) suite scheduler took %.1fs <= %ss
  target" % (latest.get("url"), latest.get("runId"), latest.get("ts"),
  scheduler_sec, THRESHOLD_SEC))

  sys.exit(0)

  CRIT2
expect: criterion exits 0 once the latest post-SINCE develop CI test job is
  success and its own suite scheduler (jobs[].schedulerMs, derived from the
  __OVERHEAD__ scheduler_ms= marker scripts/test.sh's scheduler prints) is <=
  30s. Job-level durationSec (checkout/npm install/runner teardown included) is
  no longer the measured quantity.
origin: 人 2026-09-17 裁定：worker 实测证明原判据（job 总墙钟
  durationSec≤30s）结构上不可达成——不可约开销（checkout/npm install/runner收尾）至少 27s，与 GOAL-022
  自己「不追求绝对30秒数学精确值」的非目标条款矛盾。改为只量套件自身的 scheduler_ms（不含固定 job 开销）。依赖
  ci-runs-collect.ts 新增 schedulerMs 派生字段（见 gap-ci-runs-collect-scheduler-ms
  任务），字段未派生前判据诚实报 NOT-EVALUATED（CAUSE=scheduler-ms-not-recorded），不假装通过。
activatedAt: 2026-09-17T00:46:47.629Z
statusLog:
  - at: 2026-09-17T00:46:47.630Z
    from: draft
    to: active
    actor: manager
    reason: GOAL-022 激活，三条 AC 同步激活为可判定态
  - at: 2026-10-07T08:20:13.008Z
    from: active
    to: superseded
    actor: human
    reason: 人 2026-10-07 裁定取消（口径陈旧，非未达成）：30s 这个数是在 649 测试文件 / job 208s
      的成本结构下立的；套件已涨到 852 文件、scheduler 实测 51–72s。且判据读「最新一次 post-filing run」⇒
      它永远指向最后一个 run，CI 因任何与本目标无关的原因红都让它红（当前
      CAUSE=latest-run-not-green）。结构上不再由工作决定，goal-driver 判为 world-gated。
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T00:46:47.629Z
---
