---
id: AC-237
title: 失败判据必须可归因——goal gate 记录的失败 reason 必须携带判据自身写出的成因，⛔ 不得只留 exit 1
status: active
kind: criterion
goal: GOAL-009
criterion: "node --experimental-strip-types -e 'const m = await
  import(\"./packages/quay/src/gate/acceptance-runner.ts\"); const r =
  m.runAcceptance({ command: \"echo CAUSE-TOKEN >&2; exit 1\", cwd: \".\",
  timeoutMs: 10000 }); if (r.ok) { console.error(\"NOT-EVALUATED: fixture did
  not fail\"); process.exit(3); } if
  (!String(r.reason).includes(\"CAUSE-TOKEN\")) { console.error(\"reason lost
  the criterion stderr: \" + r.reason); process.exit(1); } process.exit(0);'"
expect: 一个失败判据的 reason 含它自己写到 stderr 的成因文本 ⇒ 失败可定向（是「无证据」还是「证据过期」），而不是只剩一个退出码
origin: '本轮读数：criteria[AC-214].verdict=fail 且 reason="acceptance failed (exit
  1)"，而同一读数里 AC-214 的 criterion 自身用 stderr 区分两种失败（"no evidence yet: %s" 与 "stale
  evidence: %s"，两者都 exit 1）；timeSeries["goal:AC-214:verdict"].count=720 /
  crossed=true / threshold=8 ⇒ 该 AC 已连续 720 轮同值红灯，而读数结构上无法判因（缺证据=刷新机制没跑 vs
  证据过期=需重跑跨机验证，两种截然不同的处置）。本轮我因此无法定向任何东西。'
activatedAt: 2026-09-11T03:11:40.607Z
statusLog:
  - at: 2026-09-11T03:11:40.607Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-09-11T03:11:40.607Z
---
