---
id: AC-187
title: syncHealth 读数必须暴露 not-ff 的 benign 分解（ahead-only vs behind），否则 meta-driver
  对同步健康全盲
status: draft
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
origin: syncHealth.notFf=109 vs ffSynced=8 且读数无 benign 分解；collectSyncHealth
  (meta-driver.ts:419-420) 计数 not-ff 时不读 AC-183 已要求载体携带的 benign
  字段，导致读数无法区分良性分叉与真实背离
---
