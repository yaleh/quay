---
id: AC-319
title: 全部 workflow 的全部 job 都在 self-hosted runner 上——计量式 hosted runner 的账单闸不再能挡住 CI 与发布
status: draft
kind: criterion
goal: GOAL-020
criterion: >-
  python3 - <<'P'

  import glob, os, sys

  try: import yaml

  except Exception as e: sys.stderr.write("NOT-EVALUATED:
  CAUSE=pyyaml-unimportable — cannot parse .github/workflows/*.yml (%s), so
  'every job is self-hosted' was not looked at, which is different from 'it
  holds'\n" % e); sys.exit(3)

  files = sorted(glob.glob(".github/workflows/*.yml") +
  glob.glob(".github/workflows/*.yaml"))

  if not files: sys.stderr.write("NOT-EVALUATED: CAUSE=no-workflow-files —
  .github/workflows/ holds no *.yml under the git root, so there is no job to
  judge (an empty population is not a pass)\n"); sys.exit(3)

  ok, bad = [], []

  for f in files:
      try: doc = yaml.safe_load(open(f, encoding="utf-8")) or {}
      except Exception as e: sys.stderr.write("NOT-EVALUATED: CAUSE=workflow-unparseable — %s does not parse as YAML (%s)\n" % (f, e)); sys.exit(3)
      jobs = doc.get("jobs") or {}
      if not isinstance(jobs, dict) or not jobs: sys.stderr.write("NOT-EVALUATED: CAUSE=workflow-has-no-jobs-map — %s parsed but carries no jobs mapping, so its runners were not read\n" % f); sys.exit(3)
      for name, j in jobs.items():
          where = "%s:%s" % (os.path.basename(f), name)
          if not isinstance(j, dict) or "runs-on" not in j: bad.append((where, "no-runs-on (reusable workflow or malformed — its runner is not decided in this file)")); continue
          ro = j["runs-on"]
          labels = [ro] if isinstance(ro, str) else (ro.get("labels") if isinstance(ro, dict) else ro)
          labels = labels if isinstance(labels, list) else [labels]
          labels = [str(x) for x in labels]
          if any("${{" in x for x in labels): bad.append((where, "runs-on is an expression %r — the runner is decided at run time, so it is not statically self-hosted" % (labels,))); continue
          if "self-hosted" in labels: ok.append(where)
          else: bad.append((where, "runs-on=%r" % (labels,)))
  if bad: sys.stderr.write("CAUSE=metered-runner-job — %d of %d workflow jobs
  are not on a self-hosted runner, so a billing/spending-limit refusal still
  stops them (measured 2026-09-24: 'The job was not started because recent
  account payments have failed'): %s\n" % (len(bad), len(ok) + len(bad), ";
  ".join("%s [%s]" % b for b in bad))); sys.exit(1)

  print("ok: %d workflow jobs across %d files, all runs-on self-hosted: %s" %
  (len(ok), len(files), ", ".join(ok))); sys.exit(0)

  P
expect: exit 0 = .github/workflows/*.yml 里每个 job 的 runs-on 都含 self-hosted（逐 job
  列出）。exit 1 且 stderr CAUSE=metered-runner-job 列出每个非 self-hosted job（含 runs-on
  为表达式、或无 runs-on 的 reusable 调用——运行期才决定的 runner 不算静态 self-hosted）。exit 3
  NOT-EVALUATED：pyyaml 不可导入 / 无 workflow 文件 / 文件不可解析 / 无 jobs 映射（没看成 ≠ 成立）。⛔
  立条当轮三向控制：现状 exit 1（7/8 job 在 ubuntu-latest）；副本把 ubuntu-latest 全换成
  [self-hosted, tokyo-alpha] ⇒ exit 0（8 job 全列出）；清空 workflows ⇒ exit 3。
origin: 人 2026-09-24 裁定重开 GOAL-020。直接量：run 35966264609 的 version-consistency /
  dist-verify-node-floor 两 job runner_name 为空、steps=0，annotation 逐字『The job was
  not started because recent account payments have failed or your spending limit
  needs to be increased』；release.yml 3 job + publish-plugin-dist.yml 1 job +
  ci.yml 3 job 同在 ubuntu-latest。
long-term: true
---
