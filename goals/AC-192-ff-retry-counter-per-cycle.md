---
id: AC-192
title: ff retry counter per-cycle
status: active
kind: criterion
goal: GOAL-007
criterion: >-
  node -e '

  const fs=require("node:fs"), cp=require("node:child_process");

  const
  root=cp.execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();

  const f=root+"/.quay/fan-in-retries.jsonl";

  if(!fs.existsSync(f)){ console.log("no retry carrier yet — nothing has
  accumulated across tasks (pass)"); process.exit(0); }

  const byRun={};

  for(const l of fs.readFileSync(f,"utf8").split("\n")){
    if(!l.trim()) continue;
    let o; try{ o=JSON.parse(l); }catch{ continue; }
    if(!o.runId || !o.taskId) continue;
    (byRun[o.runId] ??= new Set()).add(o.taskId);
  }

  const bad=Object.entries(byRun).filter(([,t])=>t.size>1);

  console.log("runIds spanning >1 task (cross-task accumulation):", bad.length);

  for(const [rid,t] of bad) console.log("  "+rid+" -> "+[...t].join(", "));

  process.exit(bad.length===0?0:1);

  '
expect: exit 0
origin: >-
  GOAL-007 三例之①（来源 task：gap-fan-in-ff-retry-counter-scope）：ff 重试计数必须 per-cycle
  不累计。

  该 task 的 AC2 逐字写着取假条件——「历史失败 2 次的任务在新 dispatch 第 1 次就被锁 ⇒ 假」。

  前提变更：runId 从 fm-<task>-<epoch>-<rand>（每次 dispatch 一个）变成
  wk-prod-<epoch>（每个驱动进程一个），

  同一 runId 于是跨任务累计，突破每周期预算（闸 >=3；代价：立案时 7 条中 5 条永久闩锁、每周期只剩 1 次 ff 机会而非 3 次）。

  判据读生产载体 .quay/fan-in-retries.jsonl：任一 runId 横跨 >1 个不同 taskId 即跨任务累计 ⇒
  保证被违反（exit 1）。

  载体缺失 = 尚无重试记录 = 空真（exit 0），非 fixture 注入。
---
