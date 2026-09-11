---
id: AC-243
title: AC-241 的空因常量必须与 acceptance-runner 实际产出的零输出成因文本同源——AC-241 自身退化为恒绿时必须报红
status: achieved
kind: criterion
goal: GOAL-009
criterion: >-
  python3 - <<'P'

  import glob,re,subprocess,sys

  # 1) runner 对【零输出的失败判据】实际写出什么成因——运行时取值，⛔ 不写死

  r=subprocess.run(["node","--experimental-strip-types","-e",
   'const m=await import("./packages/quay/src/gate/acceptance-runner.ts");'
   'const r=m.runAcceptance({command:"exit 1",cwd:".",timeoutMs:10000});'
   'process.stdout.write(String(r.reason||""));'],capture_output=True,text=True)
  if r.returncode!=0 or not r.stdout.strip():
      sys.stderr.write("NOT-EVALUATED: could not obtain runner reason for a zero-output failing criterion: %r\n"%r.stdout); sys.exit(3)
  real=re.sub(r"^acceptance failed \(exit [^)]*\)","",r.stdout).strip("
  -\u2014\u2013\t")

  # 2) AC-241 用来识别「空因」的那个常量

  f=glob.glob("goals/AC-241-*.md")

  if len(f)!=1:
      sys.stderr.write("AC-241 record not uniquely locatable: %r\n"%f); sys.exit(1)
  src=open(f[0],encoding="utf-8").read()

  m=re.search(r'T\s*=\s*"([^"]+)"',src)

  if not m:
      sys.stderr.write("AC-241 no longer declares a bare-reason constant T=... - its detector shape changed; re-scope this AC\n"); sys.exit(1)
  if real and m.group(1)!=real:
      sys.stderr.write("AC-241 bare-reason constant %r != runner live text %r => AC-241 passes on unattributable fails (degenerate green)\n"%(m.group(1),real)); sys.exit(1)
  print("ok: AC-241's bare-reason constant matches the runner's live zero-output
  text")

  sys.exit(0)

  P
expect: exit 0 = AC-241 声明的空因常量与 runner 对零输出失败实际产出的成因文本逐字相同（AC-241 此刻仍能对不可归因的
  fail 报红）；exit 1 = 二者已漂移、或该常量已被移除（AC-241 退化为恒绿，GOAL-009 台账的失败归因检测器失效，须修
  AC-241）；exit 3 = runner 读数取不到（未评估，与合格不同形，⛔ 不得当作通过）
origin: readings.criteria 中 AC-241 的 criterion 正文自带逐字告警：「⚠️ 与 runner
  的模板措辞耦合：acceptance-runner 改这句文案，须同步改本判据，否则退化为恒绿」，其判定实现为字面量 T="criterion wrote
  no output to stderr/stdout"；同一 readings 显示本轮 AC-241 verdict=fail、reason 逐字点名
  AC-161 与 AC-239 两条不可归因 fail —— 即它是当前唯一在 ledger
  上把「不可归因的失败」变成红的东西；它一旦静默恒绿，GOAL-009 的失败归因面（AC-237 runner 侧 + AC-241 台账侧）就只剩
  AC-237 的 fixture 自证。
activatedAt: 2026-09-11T09:37:17.717Z
statusLog:
  - at: 2026-09-11T09:37:17.717Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-09-11T09:38:19.382Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-11T09:37:17.716Z
---
