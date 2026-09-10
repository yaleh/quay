---
id: gap-meta-round-log-rel
title: quality 驱动轮心跳写错路径（repo root 而非 .quay/）——liveness 监测读判词载体 judgedAt 报假 stall
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
quality-gate-driver 驻留环把心跳写到 path.join(root,ROUND_LOG_REL)=repo-root quality-round.jsonl（未跟踪 682KB），而 driver-runtime 监测读 .quay/quality-round.jsonl（判词载体 tsKey=judgedAt）⇒ 心跳对 liveness 不可见，drivers.quality.staleSecs=7686 假报 stall（驱动实为每 30s 心跳，arch-review 载体 15:28 仍在写）

本轮读数（drivers.quality.staleSecs）= `7686`，采于 2026-09-07T15:29:56Z，由 meta-driver 机械采集。
涉及机制关键词：`ROUND_LOG_REL`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `[ ! -e quality-round.jsonl ] || { echo 'repo-root heartbeat log still present' >&2; exit 1; }
python3 - <<'P'
import json,os,time,datetime
f=".quay/quality-round.jsonl"
if not os.path.exists(f): raise SystemExit(1)
t=None
for line in open(f, encoding="utf8"):
    line=line.strip()
    if not line: continue
    try: d=json.loads(line)
    except Exception: continue
    v=d.get("ts") or d.get("judgedAt")
    if v: t=v
if not t: raise SystemExit(1)
age=time.time()-datetime.datetime.fromisoformat(t.replace("Z","+00:00")).timestamp()
raise SystemExit(0 if age < 300 else 1)
P` ⇒ 驱动存活时其新鲜心跳在 .quay/ 可观测（载体最新时间戳 <300s），且 repo root 不再生成 quality-round.jsonl

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/test/quality-gate-driver.test.mjs`
- `plugin/test/driver-runtime.test.mjs`
- `tasks/gap-meta-round-log-rel.md`