---
id: AC-194
title: no direct to develop bypass
status: active
kind: criterion
goal: GOAL-007
criterion: |-
  node -e '
  const cp=require("node:child_process");
  const root=cp.execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();
  const r=cp.spawnSync("node",["--no-warnings","--experimental-strip-types",root+"/plugin/scripts/direct-to-develop-bypass-check.ts","--root",root,"--baseline","b11ce7202b46406d5d5bc82ef7b4c030c4aed05b","--json"],{encoding:"utf8",maxBuffer:64*1024*1024});
  if(r.status===0){ console.log("no direct-to-develop bypass (evaluated)"); process.exit(0); }
  let reason="exit "+r.status;
  try{ const o=JSON.parse((r.stdout||"").trim()); if(o&&o.reason) reason=o.reason; }catch{}
  console.log("direct-to-develop bypass check not pass: "+reason);
  process.exit(1);
  '
expect: exit 0
origin: >-
  GOAL-007 三例之③（来源 task：gap-direct-to-develop-bypasses-fan-in-gates）：无绕过 fan-in
  闸直落 develop 的提交。

  该 task 曾 done 而缺陷仍在——已被 gap-bypass-check-unclassifiable-exits-zero
  的任务体逐字记为「假完成」。

  判据读生产载体：git log develop 直接提交检测（先例
  plugin/scripts/direct-to-develop-bypass-check.ts，与

  runner-static-gate 每轮生产接线同一 baseline b11ce7202…、同一 --json 三态退出码）。

  退出码 0 = evaluated 且无绕过；非 0（RED 或 NOT-EVALUATED）一律
  fail-closed（硬规则③b：读不懂不得与合格同形）。非 fixture 注入。
---
