---
id: AC-185
title: G9 缺口语义环 —— driver 派短命 agent 经 ABI 立案，下一轮独立复核
status: achieved
kind: criterion
goal: GOAL-001
criterion: >-
  python3 - <<'P'

  import json,os,sys

  p='.quay/goal-round.jsonl'

  if not os.path.exists(p): sys.stderr.write("AC-185 fail - carrier
  .quay/goal-round.jsonl does not exist\n"); sys.exit(1)

  rs=[]

  for l in open(p):
      l=l.strip()
      if not l: continue
      try: rs.append(json.loads(l))
      except Exception: pass
  def ring(r):
      for f in (r.get('facts') or []):
          v=f.get('value')
          if isinstance(v,dict) and 'gaps' in v: return v
      return None
  first_gap={}

  ok=False

  for i,r in enumerate(rs):
      v=ring(r)
      if v is None: continue
      if 'spawned' not in v or 'llm_invoked' not in v: continue
      sp=v.get('spawned') or 0
      for g in (v.get('gaps') or []):
          ac=g.get('ac'); st=g.get('state')
          if st=='gap' and sp>0 and ac not in first_gap: first_gap[ac]=i
          elif st=='in-progress' and ac in first_gap and i>first_gap[ac]: ok=True
  sys.stderr.write("AC-185 fail - no round pair in .quay/goal-round.jsonl where
  the same AC is gap with spawned>0 and then in-progress\n") if not ok else
  None; sys.exit(0 if ok else 1)

  P
expect: exit 0（生产载体 .quay/goal-round.jsonl 中存在两轮 R1<R2：R1 里某条 AC state=gap 且该轮
  spawned>0，R2 里同一条 AC state=in-progress。轮记录须同时带 spawned 与 llm_invoked
  两键，缺键即判假——不与合格同形）
origin: >-
  人 2026-09-07 指出：goal-driver.ts:19 的「⛔ 不机械写 tasks/*.md」是「应当语义处理并建 task」，

  而该行自身写着「缺口立案属 G7 的语义环，本期不做」——延后不是禁止。实测 goal-driver.ts 408 行零 LLM 路径

  （:89/:113 的 spawn 均为机械 node 子进程），缺口环只报不立：GOAL-003 激活后 gaps=11 会一直报着不前进。

  四块拼图已有三块：结构化输入 computeGoalGaps:193（三态，含 not-evaluated）、独立复核面 readTaskFacts:138

  （按 G7 的 goal_ac 计数，不读 agent 自述）、现成派发形态 promotion-driver.ts spawnFixWorker

  （AC132 spawn 即达成 / AC133 不信自述、下轮重跑闸 / AC150-1 资源门 / AC150-2 halt / AC140-4
  llm_invoked 派生自真实 argv）。

  缺的只是 spawn 那一半。
---
**判据（能取假，三向对照已做）**：读生产载体 `.quay/goal-round.jsonl`，要求存在两轮 R1 < R2 ——
R1 中某条 AC 的 `state == "gap"` 且该轮 `spawned > 0`，R2 中同一条 AC 变为 `state == "in-progress"`（`taskCount ≥ 1`）。

**⊢ 为什么必须是两轮而不是一轮**：一轮只能证明「派了 agent」，而 agent 自述不可信（`promotion-driver` AC133 的既有纪律）。
**下一轮的 `taskCount` 由 0 变 ≥1，是不依赖 agent 自述的独立证据** —— 而这个复核面 G7 已经落地（`readTaskFacts` 按 `goal_ac` 计数）。

**⊢ 三向对照（立条当轮实跑，非事后补）**：
- 当前生产 ⇒ **exit 1**（取假，实现未做）
- 合成「先 gap+spawned>0、后 in-progress」两轮 ⇒ **exit 0**（**非恒假**，正确实现能满足它——硬规则 4c 的另一种失败形态）
- 反例「任务是别人立的」（同样两轮但 `spawned=0`）⇒ **exit 1**（不把他人立案算作语义环的功劳）

**⊢ 缺键即判假**：轮记录缺 `spawned` 或 `llm_invoked` 任一键 ⇒ 判假，**不与合格同形**（硬规则 3b）。

**实现要点（照 `promotion-driver` 的现成形态，不发明新形态）**：
- spawn 前过 `resourceGateCheck`（WAIT ⇒ 本轮不 spawn）与 `.quay/goal-control.json` 的 halt（两者 goal-driver 已具备同族设施）；
- **每轮 spawn 上限**必须有（当前 GOAL-003 有 11 条缺口，不设限会一次炸开）；上限读配置不写死字面量（硬规则 4 推论二）；
- `llm_invoked` **派生自真实 argv**，⛔ 不硬编码（AC140-4 的既有教训）；
- 保留 `--gap-worker-cmd` 一类测试缝，使判据可在不真起 LLM 的情况下被负控制驱动。

**⛔ 不越界**：本条只加「缺口非空 ⇒ 派 agent 立案」这一个环。`draft→active` 激活、`active→retired` 放弃仍是人的裁定；
driver 仍**不直接改 task 状态**、**不自己手写 `tasks/*.md`**——写由 agent 经 ABI 做。