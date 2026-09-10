---
id: AC-188
title: 三例的长期保证已上移为 goal 层【在域】AC，且各带非空 criterion（能被每轮重评估）
status: achieved
kind: criterion
goal: GOAL-007
long-term: true
criterion: |
  node -e '
  const {execFileSync}=require("node:child_process");
  const root=execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();
  const out=execFileSync("node",["--no-warnings","--experimental-strip-types",root+"/packages/quay/src/goal-store.ts","list","--root",root],{maxBuffer:64*1024*1024}).toString();
  const recs=JSON.parse(out);
  const SELF=new Set(["GOAL-007","AC-188","AC-189","AC-190","AC-191"]);
  const need=["gap-fan-in-ff-retry-counter-scope","gap-suite-load-sampler-orphan-process","gap-direct-to-develop-bypasses-fan-in-gates"];
  const inScope=recs.filter(r=>!SELF.has(r.id)&&r.kind==="criterion"&&["active","achieved"].includes(r.status)&&String(r.criterion||"").trim().length>=20);
  const hit=need.filter(t=>inScope.some(r=>String(r.origin||"").includes(t)));
  console.log("covered:",hit.length+"/"+need.length,JSON.stringify(hit));
  process.exit(hit.length===need.length?0:1);
  '
expect: exit 0
origin: |-
  人 2026-09-07 就 GOAL-007 裁定方向【丁：不修，上移 goal 层】——承认 task 层判据是一次性的，
  把需要长期保证的东西显式上移为 goal 层 AC（那里 goal-driver 每轮已有再评估）。四条候选中甲被
  GOAL-007 自陈为不成立（「守与不守在记录上无法区分 ⇒ 硬规则⑨应造产物」）；乙只覆盖三例中的①
  （取值形态漂移），②是 abort 分支未覆盖、③是绕闸，都不是 fixture 与生产的取值不一致。

  本条把「丁」的核心动作变成可查的量：GOAL-007 的三例证据各自对应一个需长期维持的保证
  （① ff 重试计数 per-cycle 不累计；② 不存在 cwd 指向已删 worktree 的孤儿 suite 进程；③ 无绕过
  fan-in 闸直落 develop 的提交），必须各有一条 goal 层 AC 承载。

  判据按位置读 goal-store 的 list 输出，要求：status ∈ {active, achieved}（= I2 的在域集，
  goal-driver 的 :619 只翻 active、in-scope 定义见「draft/superseded/retired 不在域」），
  kind=criterion，criterion 非空且 ≥20 字符（⛔ 空 criterion 是 fail-closed 的空壳，写了等于没上移），
  origin 里点名其来源 task id。

  ⛔ 自满足防护（2026-09-06 实证教训：AC-179 的判据 grep 裸字符串 goal-card，而实现任务被命名为
  gap-dashboard-goal-card-…，dashboard 渲染任务列表 ⇒ 一行实现没写就 PASS）：判据只读 origin 字段、
  且按 id 显式排除 GOAL-007 与 AC-188..191 自身，故本 AC 与兄弟 AC 的正文不能满足它。

  干跑（2026-09-07，落笔当轮）：in-scope AC 38 条，覆盖 0/3，exit 1 ⇒ 今天取假。
---
