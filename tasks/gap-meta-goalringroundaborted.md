---
id: gap-meta-goalringroundaborted
title: AC-945 判据须按 goalRingRoundAborted 语义回退到最近一条未中止轮，而不是无条件读最后一行
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
AC-945 的判据把 `goal-round.jsonl` 的最后一行当作「最近一轮」：当最后一行是 stopped_mid_round 中止轮时，其 goal-ring value 只是 {stopped_mid_round,observed,grace_ms} 存根，结构上不可能带 requests ⇒ 健康的请求消费器被读成红（本轮 achieved-but-failing 的真实成因；此前连续 6 轮 pass，本轮因中止轮落在尾部而首次红）。

本轮读数（divergences.AC-945.reason）= `"acceptance failed (exit 1) — no request-consumer reading in the last round"`，采于 2026-11-07T05:16:54Z，由 meta-driver 机械采集。
⚠️ 机制词 `goalRingRoundAborted` 命中【已完成】任务：gap-meta-derivegoalcarriersignals.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const rec=JSON.parse(cp.execFileSync(process.execPath,["--experimental-strip-types","packages/quay/bin/quay.ts","goal","get","AC-945","--root",".","--json"],{encoding:"utf8",maxBuffer:1<<26}));const crit=rec.criterion;if(!crit){console.error("AC-945 has no criterion in the goal store");process.exit(1)}const reqs={evaluated:true,cause:null,badLines:0,openBefore:0,openAfter:0,appended:0,settled:[],alreadySettled:[],errors:[]};const reading={id:"AC-934",verdict:"pass"};const comp=(withReq)=>({round:1,stopped_mid_round:false,facts:[{name:"goal-ring",value:Object.assign({criteria:[reading]},withReq?{requests:reqs}:{}),state:"verified"}]});const aborted={round:2,stopped_mid_round:true,facts:[{name:"goal-ring",value:{stopped_mid_round:true,observed:false,grace_ms:5000},state:"not-evaluated"}]};const dataBeatsFlag={round:3,stopped_mid_round:true,facts:[{name:"goal-ring",value:{criteria:[reading],requests:reqs},state:"verified"}]};const run=(rows)=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),"ac945-"));fs.mkdirSync(path.join(d,".quay"),{recursive:true});fs.writeFileSync(path.join(d,".quay","goal-round.jsonl"),rows.map((r)=>JSON.stringify(r)).join("\n")+"\n");try{cp.execFileSync("bash",["-c",crit],{cwd:d,stdio:["ignore","pipe","pipe"]});return 0}catch(e){return typeof e.status==="number"?e.status:1}};const arms={abortedLast:run([comp(true),aborted]),dataBeatsFlag:run([dataBeatsFlag]),noRequests:run([comp(false)]),abortedOnly:run([aborted])};if(arms.abortedLast!==0||arms.dataBeatsFlag!==0||arms.noRequests===0||arms.abortedOnly===0){console.error(JSON.stringify(arms));process.exit(1)}console.log(JSON.stringify(arms))'` ⇒ 四臂全对：abortedLast 与 dataBeatsFlag 各 exit 0（跳过「没跑完」的轮，且数据优先于记录级旗标），noRequests 与 abortedOnly 各非 0（最近一条已完成轮缺 requests 仍必须红；一条完成的轮都没有时也必须红——不得把「无从判断」混成「合格」），即修好的是采样语义而不是把判据变恒真。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `goals/AC-945-请求消费半边的每轮活性-生产-round-fact-必须携带已测的-goal-ring-requests-而不是靠一次性.md`
- `tasks/gap-meta-goalringroundaborted.md`