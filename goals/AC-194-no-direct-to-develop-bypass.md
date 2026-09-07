---
id: AC-194
title: no direct to develop bypass
status: achieved
kind: criterion
goal: GOAL-007
criterion: |-
  node -e '
  const cp=require("node:child_process");
  const root=cp.execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();
  const r=cp.spawnSync("node",["--no-warnings","--experimental-strip-types",root+"/plugin/scripts/direct-to-develop-bypass-check.ts","--root",root,"--baseline","develop~100","--json"],{encoding:"utf8",maxBuffer:64*1024*1024});
  if(r.status===0){ console.log("no direct-to-develop bypass in recent window (evaluated)"); process.exit(0); }
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
  plugin/scripts/direct-to-develop-bypass-check.ts，复用

  runner-static-gate 每轮生产接线的同一检测器与 --json 三态退出码）。

  baseline 用 develop~100 滑窗（约 100 个 first-parent 提交、墙钟 ~2s，⛔ 不用旧固定边界
  b11ce72——它在生产上

  已扫 9772 条、墙钟 ~69s，会击穿 goal-gate 的 60s criterion 预算恒超时）。滑窗对每 ~42s 重评估的 goal 层

  判据是正解：任何新直投落 tip 即入窗、数分钟到数小时内必被重评估抓到；旧固定边界随 develop 前进累积扫描成本。

  退出码 0 = evaluated 且无绕过；非 0（RED 或 NOT-EVALUATED/unclassifiable）一律
  fail-closed（硬规则③b：读不懂

  不得与合格同形）。非 fixture 注入。
---
