---
id: AC-262
title: 缺口B2：quay goal gate/check/batch 落在 plugin 形态 CLI 上，driver 不再引用 Core
  源码树，且生产载体里 goal-ring 非 failed
status: achieved
kind: criterion
goal: GOAL-019
criterion: |-
  python3 - <<'P'
  import json, os, re, subprocess, sys
  BUNDLE = "plugin/vendor/quay/dist/quay.js"
  if not os.path.exists(BUNDLE):
      sys.stderr.write("AC-262: %s absent => the plugin-form CLI surface cannot be exercised at all\n" % BUNDLE); sys.exit(1)
  env = {k: v for k, v in os.environ.items() if k not in ("QUAY_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT")}
  missing = []
  for sub in (["goal","gate"], ["goal","check","--staleness"], ["goal","batch"]):
      try:
          r = subprocess.run(["node",BUNDLE]+sub,capture_output=True,text=True,env=env,timeout=240)
      except Exception as e:
          sys.stderr.write("AC-262: `quay %s` through the vendored bundle did not run (%s)\n" % (" ".join(sub), e)); sys.exit(1)
      if "unknown goal subcommand" in (r.stderr or ""): missing.append(" ".join(sub))
  if missing:
      sys.stderr.write("AC-262: the vendored bundle still answers `unknown goal subcommand` for %r => the B2 verbs have not landed on the plugin-form surface the drivers must use\n" % missing); sys.exit(1)
  off = []
  for f in ("plugin/scripts/goal-driver.ts", "plugin/scripts/meta-driver.ts"):
      if not os.path.exists(f):
          sys.stderr.write("AC-262: %s absent => the driver surface moved and this criterion can no longer judge it\n" % f); sys.exit(1)
      for i, ln in enumerate(open(f, encoding="utf-8"), 1):
          code = ln.split("//", 1)[0]
          if re.search(r'"packages"\s*,\s*"quay"\s*,\s*"src"', code) or "packages/quay/src" in code:
              off.append((f, i, code.strip()[:90]))
  if off:
      sys.stderr.write("AC-262: %d in-code Core-source-tree references remain in the goal/meta drivers (first 3: %r) => the plugin cache holds no such tree, so these resolve to nothing there\n" % (len(off), off[:3])); sys.exit(1)
  land = subprocess.run(["git","log","-1","--format=%cI","--","packages/quay/src/cli/goal.ts"],capture_output=True,text=True).stdout.strip()
  if not land:
      sys.stderr.write("AC-262: no commit touches packages/quay/src/cli/goal.ts => B2 has not landed, so no post-landing window exists to read\n"); sys.exit(1)
  CAR = ".quay/goal-round.jsonl"
  if not os.path.exists(CAR):
      sys.stderr.write("AC-262: carrier %s absent => no goal round has ever been recorded, so the ring has never been observed\n" % CAR); sys.exit(1)
  seen = 0
  ok = 0
  for ln in open(CAR, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      ts = str(r.get("ts") or r.get("at") or "")
      if not ts or ts <= land: continue
      seen += 1
      facts = r.get("facts") or []
      ring = [f for f in facts if isinstance(f, dict) and f.get("name") == "goal-ring"]
      if ring and all(f.get("state") != "failed" for f in ring): ok += 1
  if ok < 1:
      sys.stderr.write("AC-262: carrier %s holds %d rounds after the B2 landing commit (%s) and none with a non-failed goal-ring => the ring still breaks in production, which is the whole point of B2\n" % (CAR, seen, land)); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = ①经 vendored bundle（plugin/vendor/quay/dist/quay.js，两个覆盖变量
  unset）跑 goal gate、goal check --staleness、goal batch，三者 stderr 均不含 unknown goal
  subcommand ∧ ②goal-driver.ts 与 meta-driver.ts 剥掉行注释后指向 packages/quay/src 的点数 =
  0（按位置判定而非关键词；非零时打印前 3 条实际命中）∧ ③生产载体 .quay/goal-round.jsonl 中存在 ts 晚于 B2
  落地提交时刻的轮次，且其 goal-ring fact 无 failed。落地时刻由 git log -1 --format=%cI --
  packages/quay/src/cli/goal.ts 当场派生，⛔ 不写死 sha（写死会随 develop 前进静默过期成永久
  NOT-EVALUATED）。exit 1 = 任一支不成立。③ 是本 AC
  的要害：①②只证明「能产出」，③才证明「已产出」——只靠①②通过的实现，在生产上与「没实现」同形（硬规则 4 推论三）。基线
  2026-09-15：三个子命令都 rc=1 且 stderr 含 unknown goal subcommand。
origin: 2026-09-15 实测：goal/meta driver 对
  resolveQuayCodeRoot/resolveQuaySrcModule 的五个非测试调用点没有一个用 await
  import；goalStoreArgv（meta-driver.ts:182-196）构造的是子进程 argv，把 goal-store 当 CLI
  spawn（8 个子命令）。而 plugin cache 里的 scripts/dist/goal-driver.js 已由
  coreSrcAliasPlugin（build-plugin-dist.mjs:358-376）把 goal-store 库完整内联，却仍留着
  path.join(…,packages,quay,src,…) 去 spawn 一个那里不存在的
  goal-store.ts；goal-store.ts:3042-3043 的 main 守卫在 bundle 里故意为 false，所以 bundle
  自带 CLI dispatch 不可达。缺的不是代码，是调用方式。人 2026-09-15 裁定采用 B2（补 CLI 动词）而非 B1（改
  in-process）。
activatedAt: 2026-09-15T04:01:51.228Z
statusLog:
  - at: 2026-09-15T04:01:51.228Z
    from: draft
    to: active
    actor: manager
    reason: GOAL-019 已激活，本 AC 进入在评
  - at: 2026-09-15T12:58:13.778Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-15T04:01:51.227Z
---
