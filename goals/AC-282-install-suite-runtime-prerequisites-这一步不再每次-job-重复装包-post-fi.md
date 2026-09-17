---
id: AC-282
title: Install suite runtime prerequisites 这一步不再每次 job 重复装包——post-filing 最新一次
  develop CI test job 的日志派生出三个前置全部 already-present（零 per-job install）
status: achieved
kind: criterion
goal: GOAL-022
criterion: >-
  python3 - <<'CRIT2'

  import json, os, sys


  CAR = ".quay/ci-runs.jsonl"

  SINCE = "2026-09-17T00:45:02Z"

  NEED = ("pyyaml", "tmux", "procps")


  if not os.path.exists(CAR): sys.stderr.write("CAUSE=carrier-absent — %s does
  not exist, so no CI-run reading can be made at all\n" % CAR); sys.exit(1)


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

  if not rows: sys.stderr.write("CAUSE=no-post-filing-run — no CI run on develop
  with ts > %s exists yet in %s\n" % (SINCE, CAR)); sys.exit(1)


  rows.sort(key=lambda r: r.get("ts") or "")

  latest = rows[-1]


  job = None

  for j in latest.get("jobs") or []:
      if j.get("name") == "test":
          job = j
          break

  if job is None: sys.stderr.write("CAUSE=no-test-job-in-latest-run — the latest
  post-filing develop CI run (%s, %s) has no 'test' job entry\n" %
  (latest.get("runId"), latest.get("url"))); sys.exit(1)


  prov = job.get("prereqProvision")


  if not isinstance(prov, dict):
  sys.stderr.write("CAUSE=prereq-provision-not-recorded — the test job of run %s
  (%s) carries no prereqProvision reading, so per-job re-installation cannot be
  judged from this carrier. This is NOT-EVALUATED, not 'no install happened'.\n"
  % (latest.get("runId"), latest.get("url"))); sys.exit(1)


  missing = [k for k in NEED if k not in prov]


  if missing: sys.stderr.write("CAUSE=prereq-provision-incomplete —
  prereqProvision lacks %s (got keys %s)\n" % (missing, sorted(prov)));
  sys.exit(1)


  unreadable = {k: prov[k] for k in NEED if prov[k] == "absent"}


  if unreadable: sys.stderr.write("CAUSE=prereq-provision-underivable — run %s
  (%s): %s could not be derived from the job log (NOT-EVALUATED)\n" %
  (latest.get("runId"), latest.get("url"), unreadable)); sys.exit(1)


  installed = {k: prov[k] for k in NEED if prov[k] != "already-present"}


  if installed: sys.stderr.write("CAUSE=still-reinstalling-every-job — run %s
  (%s) provisioned %s INSIDE the job (measured 2026-09-17: this step cost 8s of
  a 30s target = 26.7%%)\n" % (latest.get("runId"), latest.get("url"),
  installed)); sys.exit(1)


  print("OK — run %s (%s, ts=%s): %s were all already present; the install step
  took the no-op path" % (latest.get("runId"), latest.get("url"),
  latest.get("ts"), ", ".join(NEED)))


  sys.exit(0)

  CRIT2
expect: criterion exits 0 once .quay/ci-runs.jsonl 里本 GOAL 立案之后最新一次 develop CI
  test job 的 prereqProvision 读数显示三个前置全部为 already-present；任一为 installed-* ⇒ exit
  1；读数缺失/派生不出 ⇒ exit 1 且带独立 CAUSE（不与通过同形）。
origin: manager 2026-09-17 激活，随 GOAL-022 退出条件更新一并生效
activatedAt: 2026-09-17T02:12:35.567Z
statusLog:
  - at: 2026-09-17T02:12:35.567Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-17T05:30:46.211Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-09-17T02:12:35.567Z
---
