---
id: AC-191
title: 迁移后的 goal AC 在【生产】轮记录里有 evidence.at，且晚于其落地提交（只计落地后时间窗）
status: achieved
kind: criterion
goal: GOAL-007
criterion: |
  node -e '
  const {execFileSync}=require("node:child_process");
  const fs=require("node:fs");
  const root=execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();
  const out=execFileSync("node",["--no-warnings","--experimental-strip-types",root+"/packages/quay/src/goal-store.ts","list","--root",root],{maxBuffer:64*1024*1024}).toString();
  const recs=JSON.parse(out);
  const SELF=new Set(["GOAL-007","AC-188","AC-189","AC-190","AC-191"]);
  const need=["gap-fan-in-ff-retry-counter-scope","gap-suite-load-sampler-orphan-process","gap-direct-to-develop-bypasses-fan-in-gates"];
  const mig=recs.filter(r=>!SELF.has(r.id)&&r.kind==="criterion"&&["active","achieved"].includes(r.status)&&String(r.criterion||"").trim().length>=20&&need.some(t=>String(r.origin||"").includes(t)));
  if(mig.length<need.length){console.error("迁移 AC 不足:",mig.length+"/"+need.length);process.exit(1);}
  let ok=0;
  for(const r of mig){
    const file=fs.readdirSync(root+"/goals").find(f=>f.startsWith(r.id+"-"));
    if(!file){console.log("无文件:",r.id);continue;}
    const born=execFileSync("git",["-C",root,"log","--diff-filter=A","--format=%ct","-1","--","goals/"+file]).toString().trim();
    const at=r.evidence&&r.evidence.at?Date.parse(r.evidence.at)/1000:0;
    const pass=Boolean(born)&&at>Number(born)&&Boolean(r.evidence&&r.evidence.verdict);
    console.log(r.id,"born="+born,"evidence.at="+((r.evidence&&r.evidence.at)||"none"),pass?"OK":"NO");
    if(pass)ok++;
  }
  process.exit(ok===need.length?0:1);
  '
expect: exit 0
origin: |-
  人 2026-09-07 就 GOAL-007 裁定方向【丁：不修，上移 goal 层】——承认 task 层判据是一次性的，
  把需要长期保证的东西显式上移为 goal 层 AC（那里 goal-driver 每轮已有再评估）。四条候选中甲被
  GOAL-007 自陈为不成立（「守与不守在记录上无法区分 ⇒ 硬规则⑨应造产物」）；乙只覆盖三例中的①
  （取值形态漂移），②是 abort 分支未覆盖、③是绕闸，都不是 fixture 与生产的取值不一致。

  硬规则④推论三：一个只能被 fixture / 注入数据满足的判据不是测量——它证明「能产出」，不证明
  「已产出」。实证代价：gap-phase-boundary-differential-accounting 曾 status=done、AC 5/5 全勾、
  scoped 门绿，而生产载体 167 轮中含目标读数的 = 0，根因是实现落地于末轮之后、落地后一轮都没跑过。

  本条防的正是丁 的同款失败：三条迁移 AC 写进 goals/ 却从未被 goal-driver 真正评估过（例如停在
  draft、或 criterion 写错导致恒 not-evaluated），而 AC-188 只查「存在」不查「跑过」。

  判据对每条迁移 AC 取其 goals/ 文件的首次提交时刻（git log --diff-filter=A），要求记录里的
  evidence.at 严格晚于它、且 evidence.verdict 非空 ⇒ 只计落地之后的时间窗，落地前的读数不算。

  干跑（2026-09-07）：迁移 AC 0/3，exit 1 ⇒ 今天取假。
---
