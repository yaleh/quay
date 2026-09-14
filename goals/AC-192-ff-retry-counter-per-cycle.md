---
id: AC-192
title: ff retry counter per-cycle
status: achieved
kind: criterion
goal: GOAL-007
criterion: >-
  node -e '

  const fs=require("node:fs"), cp=require("node:child_process");

  const
  root=cp.execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();

  // Falsifiability seam (negative control only): an explicit carrier path
  overrides the production

  // carrier. Unset => the production carrier at the git root is read — never a
  fixture.

  const f=process.env.QUAY_FAN_IN_RETRIES_CARRIER ||
  (root+"/.quay/fan-in-retries.jsonl");

  if(!fs.existsSync(f)){ console.log("no retry carrier yet — nothing has
  accumulated across tasks (pass)"); process.exit(0); }

  const recs=[];

  for(const l of fs.readFileSync(f,"utf8").split("\n")){
    if(!l.trim()) continue;
    let o; try{ o=JSON.parse(l); }catch{ continue; }
    if(!o || typeof o.taskId!=="string" || !o.taskId) continue;
    recs.push(o);
  }

  // Per-cycle key is attemptKey (mfi-<task>-<epoch>-<rand>); runId became a
  process-lifetime id

  // (wk-prod-<epoch>) and legitimately spans tasks — runId is NOT judged here.
  Records without a

  // non-null attemptKey are pre-fix (runId-only) and excluded from the
  per-cycle check.

  const byKey={};

  let withKey=0;

  for(const o of recs){
    if(typeof o.attemptKey==="string" && o.attemptKey.length>0){
      withKey++;
      (byKey[o.attemptKey] ??= new Set()).add(o.taskId);
    }
  }

  if(recs.length>0 && withKey===0){
    console.log("NOT-EVALUATED: carrier has "+recs.length+" retry records but none carries attemptKey — per-cycle key absent, guarantee untested (fail, not pass)");
    console.error("AC-192 fail - carrier "+f+" has "+recs.length+" retry records but none carries attemptKey (per-cycle key absent, guarantee untested)"); process.exit(1);
  }

  const bad=Object.entries(byKey).filter(([,t])=>t.size>1);

  console.log("attemptKeys spanning >1 task (cross-task accumulation):",
  bad.length);

  for(const [k,t] of bad) console.log("  "+k+" -> "+[...t].join(", "));

  process.exit(bad.length===0?0:1);

  '
expect: exit 0
origin: >-
  GOAL-007 三例之①（来源 task：gap-fan-in-ff-retry-counter-scope）：ff 重试计数必须 per-cycle
  不累计。


  该 task 的 AC2 逐字写着取假条件——「历史失败 2 次的任务在新 dispatch 第 1 次就被锁 ⇒ 假」。


  前提已变：runId 从 fm-<task>-<epoch>-<rand>（每次 dispatch 一个）变成
  wk-prod-<epoch>（每个驱动进程一个），

  per-cycle 计数键改为 attemptKey（mfi-<task>-<epoch>-<rand>，ff-merge.ts countKey =
  attemptKey ?? runId）。

  故「runId 横跨 >1 task」是进程级语义的合法形态——原判据按 runId 分组测错字段 ⇒ 恒红（exit 1），等于没测到保证。


  本判据重锚到 attemptKey：任一 attemptKey 横跨 >1 个不同 taskId 即跨任务累计 ⇒ 保证被违反（exit 1）。

  时间窗：只计带非空 attemptKey 的记录（修复前仅 runId 的记录自动排除），不写死绝对时间戳。

  不静默通过：载体有记录但无一条带 attemptKey ⇒ exit 1（NOT-EVALUATED），不与 pass 同形（硬规则 3b）。

  可证伪：注入两个 taskId 共享同一 attemptKey 的 fixture ⇒ exit 1（QUAY_FAN_IN_RETRIES_CARRIER
  缝）。


  判据读生产载体 .quay/fan-in-retries.jsonl；载体缺失 = 尚无重试记录 = 空真（exit 0），非 fixture 注入。
---
