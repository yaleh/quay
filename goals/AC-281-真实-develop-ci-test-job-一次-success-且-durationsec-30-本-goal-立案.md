---
id: AC-281
title: 真实 develop CI test job 一次 success 且 durationSec <= 30（本 GOAL 立案之后的读数）
status: draft
kind: criterion
goal: GOAL-022
criterion: >-
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

  duration = test_job.get("durationSec")


  if conclusion != "success":
      sys.stderr.write("CAUSE=latest-run-not-green — the latest post-filing CI test job (%s) concluded '%s', not 'success'; a fast-but-broken run does not satisfy this AC\n" % (latest.get("url"), conclusion)); sys.exit(1)

  if duration is None:
      sys.stderr.write("CAUSE=no-duration-recorded — the latest post-filing CI test job (%s) has no durationSec field\n" % latest.get("url")); sys.exit(1)

  if duration > THRESHOLD_SEC:
      sys.stderr.write("CAUSE=too-slow — the latest post-filing CI test job (%s) took %ss, still above the %ss target\n" % (latest.get("url"), duration, THRESHOLD_SEC)); sys.exit(1)

  print("OK — CI test job %s (run %s, %s) took %ss <= %ss target" %
  (latest.get("url"), latest.get("runId"), latest.get("ts"), duration,
  THRESHOLD_SEC))

  sys.exit(0)
expect: criterion exits 0 once .quay/ci-runs.jsonl shows a post-SINCE develop CI
  test job that is success and durationSec<=30
origin: GOAL-022 退出条件：.quay/ci-runs.jsonl 的 develop test job 立案之后 success 且 <=30s
---
