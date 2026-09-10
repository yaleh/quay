---
id: AC-187
title: syncHealth 读数必须暴露 not-ff 的 benign 分解（ahead-only vs behind），否则 meta-driver
  对同步健康全盲
status: retired
kind: criterion
goal: GOAL-001
criterion: node --experimental-strip-types --input-type=module -e 'import
  {collectSyncHealth} from "./plugin/scripts/meta-driver.ts"; import fs from
  "node:fs"; import os from "node:os"; import path from "node:path"; const
  d=fs.mkdtempSync(path.join(os.tmpdir(),"sh-"));
  fs.mkdirSync(path.join(d,".quay"));
  fs.writeFileSync(path.join(d,".quay","doc-develop-sync.jsonl"),
  JSON.stringify({event:"doc-develop-sync-not-ff",ts:"2026-09-07T00:00:00Z",benign:true})+"\n");
  const h=collectSyncHealth(d); process.exit((("notFfBenign" in
  h)||("notFfAhead" in h)||("notFfBehind" in h))?0:1);'
expect: 一条 benign(ahead-only) 的 not-ff 事件在读数里显现为可区分的 benign 计数，使同步健康可判定
origin: 职能移交到套件（gap-standing-invariants-not-reevaluated-move-to-suite）：collectSyncHealth
  暴露 not-ff 的 benign 分解 已作为常驻断言 plugin/test/goal-invariants-standing.test.mjs
  每轮真跑；goal 层全绿即关闭不再复验，故 retired
---
