---
id: AC-267
title: SEA 产物的 quay serve 可用：plugin-root.ts 模块顶层求值 import.meta.url 的点数归零 +
  seaVerify=success
status: achieved
kind: criterion
goal: GOAL-020
criterion: |-
  python3 - <<'P'
  import json, os, re, subprocess, sys
  SRC = "packages/quay/src/plugin-root.ts"
  if not os.path.exists(SRC):
      sys.stderr.write("CAUSE=source-absent — %s does not exist => the module moved and this criterion can no longer judge it\n" % SRC); sys.exit(1)
  # Position-based (hard rule 2): a line that EVALUATES import.meta.url at module top level is one
  # whose code (comments stripped) contains it, starts at indent 0, and is a declaration/assignment.
  # A mention inside a function body is indented and is exactly the fix shape, so it must NOT match.
  top = []
  for i, ln in enumerate(open(SRC, encoding="utf-8"), 1):
      code = ln.split("//", 1)[0]
      if "import.meta.url" not in code: continue
      if code[:1].strip() == "" : continue          # indented => inside a function/block => fine
      if not re.search(r"\b(const|let|var)\b|=", code): continue
      top.append((i, code.strip()[:100]))
  if top:
      sys.stderr.write("CAUSE=top-level-eval-remains — %d module-top-level evaluation(s) of import.meta.url remain in %s (first %d: %r) => import alone executes them, and in the SEA CJS bundle import.meta.url is undefined, so `quay serve` crashes at fileURLToPath while `quay --help` (which does not pull the goal-store -> gate/config/loader chain) still passes\n" % (len(top), SRC, min(3, len(top)), top[:3])); sys.exit(1)
  # Carrier arm: the shipped artifact must actually have been exercised. A green static arm with no
  # production evidence is the "implemented, tested, never ran" shape (hard rule 4 corollary 3).
  land = subprocess.run(["git","log","-1","--format=%cI","--",SRC],capture_output=True,text=True).stdout.strip()
  if not land:
      sys.stderr.write("CAUSE=no-landing-commit — %s has no commit, so no post-fix window exists to read\n" % SRC); sys.exit(1)
  CAR = ".quay/ci-runs.jsonl"
  if not os.path.exists(CAR):
      sys.stderr.write("CAUSE=carrier-absent — %s does not exist => the static arm holds but no release run has ever been recorded, so the SEA artifact has never been exercised\n" % CAR); sys.exit(1)
  sea = []
  for ln in open(CAR, encoding="utf-8"):
      ln = ln.strip()
      if not ln: continue
      try: r = json.loads(ln)
      except Exception: continue
      if r.get("workflow") not in ("release.yml", "Release"): continue
      ts = str(r.get("ts") or "")
      if ts and ts > land and r.get("seaVerify") is not None: sea.append(r)
  if not sea:
      sys.stderr.write("CAUSE=no-sea-verify-after-fix — carrier holds no release run with a seaVerify reading and ts > %s => the static arm holds but the shipped binary has never been verified in production\n" % land); sys.exit(1)
  bad = [r for r in sea if r.get("seaVerify") != "success"]
  if bad:
      sys.stderr.write("CAUSE=sea-verify-still-red — %d of %d post-fix release runs report seaVerify != success (first: %s => %r) => the shipped binary still cannot run `quay serve`\n" % (len(bad), len(sea), bad[0].get("runId"), bad[0].get("seaVerify"))); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = ①静态臂（按位置判定，剥行注释 + 要求缩进为 0
  的声明行）：packages/quay/src/plugin-root.ts 中模块顶层求值 import.meta.url 的点数 = 0（命中时打印前
  3 条实际行号与源文）∧ ②载体臂：存在 ts 晚于修复落地、且 seaVerify=success 的 release run。exit 1 且
  stderr 带 CAUSE=top-level-eval-remains / no-sea-verify-after-fix /
  sea-verify-still-red 等。
origin: 立案实测：sea-verify-node-free 在三平台全挂，quay serve 一起手即崩于
  fileURLToPath（quay-bundle.cjs:8607），根因 plugin-root.ts:33 的 const MODULE_DIR =
  path.dirname(fileURLToPath(import.meta.url)) 在模块顶层求值，而 SEA 的 CJS bundle 里
  import.meta.url 是 undefined；quay --help 不拉该链故看似正常。v0.5.0/v0.6.2/v0.6.3
  反复复现，是发出去的二进制核心功能不可用。
activatedAt: 2026-09-15T11:39:47.422Z
statusLog:
  - at: 2026-09-15T11:39:47.422Z
    from: draft
    to: active
    actor: manager
    reason: 激活：判据当轮干跑取假，精确命中 plugin-root.ts:33 顶层求值
  - at: 2026-09-15T15:28:44.137Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-15T11:39:47.422Z
---
