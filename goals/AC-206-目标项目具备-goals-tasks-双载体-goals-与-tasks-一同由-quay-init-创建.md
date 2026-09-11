---
id: AC-206
title: 目标项目具备 goals+tasks 双载体——goals/ 与 tasks/ 一同由 quay-init 创建
status: achieved
kind: criterion
goal: GOAL-009
criterion: |-
  python3 - <<'P'
  import json,os,re,socket,sys
  spec="orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md"
  t=open(spec,encoding="utf-8").read()
  m=re.search(r"QUAY-INIT-CLOSED-SET:BEGIN\n(.*?)QUAY-INIT-CLOSED-SET:END",t,re.S)
  if not m: sys.stderr.write("NOT-EVALUATED: closed-set block unreadable\n"); sys.exit(3)
  entries={x.strip("- ").strip() for x in m.group(1).strip().splitlines()}
  if "goals/" not in entries: sys.stderr.write("SPEC closed set lacks goals/\n"); sys.exit(1)
  a=open("plugin/scripts/quay-init-closure-assertion.ts",encoding="utf-8").read()
  mm=re.search(r"CLOSED_SET_DIRS[^=]*=\s*\[(.*?)\]",a,re.S)
  if not mm: sys.stderr.write("NOT-EVALUATED: CLOSED_SET_DIRS unreadable\n"); sys.exit(3)
  if "goals" not in set(re.findall(r'"([^"]+)"',mm.group(1))): sys.stderr.write("CLOSED_SET_DIRS lacks goals\n"); sys.exit(1)
  if 'mkdir -p "$WORKSPACE_ROOT/goals"' not in open("plugin/scripts/quay-init.sh",encoding="utf-8").read():
      sys.stderr.write("quay-init.sh does not create goals/\n"); sys.exit(1)
  p=".quay/productization-verification.jsonl"
  if not os.path.exists(p): sys.stderr.write("NOT-EVALUATED: carrier absent\n"); sys.exit(3)
  me=socket.gethostname(); here=os.path.realpath(".")
  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      r=json.loads(l)
      if r.get("ac")!="GOAL-009-AC-206": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me or pr==here or pr.startswith(here+os.sep): continue
      if r.get("goals_dir_created") is not True or r.get("tasks_dir_created") is not True: continue
      if r.get("goal_store_readable") is not True or r.get("task_store_readable") is not True: continue
      sys.exit(0)
  sys.exit(1)
  P
expect: exit 0 = SPEC 闭集块含 goals/ ∧ CLOSED_SET_DIRS 含 goals ∧ quay-init.sh 真的
  mkdir goals/ ∧ 载体中存在 ac=GOAL-009-AC-206 的记录（host≠本机、非本仓库项目、两目录均创建、两 store
  均可读）。exit 1 = 任一不成立（当前：SPEC 闭集缺 goals/）。exit 3 = SPEC 块或常量读不出。
origin: 人 2026-09-09 裁定④：goals/ 目录应当和 tasks/ 目录一起创建（现 tasks/ 由 quay-init.sh:2232
  创建，goals/ 未创建，CLOSED_SET_DIRS=["tasks"]）。要求③：目标项目中的实际开发活动应使用 goals 和 tasks
  等载体。
activatedAt: 2026-09-09T11:49:16.443Z
statusLog:
  - at: 2026-09-09T11:49:16.443Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-10T22:49:16.953Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
---
**判据（能取假）**：2026-09-09 干跑 exit 1，报 SPEC closed set lacks goals/。**六处同步改动（硬规则 5b：修好一个 ≠ 只在一处）**：① SPEC-plugin-lifecycle-single-bundle-2026-09-02.md:163-170 的 QUAY-INIT-CLOSED-SET 机器可读块（verify-deliver-coldstart.sh:568 解析它，是闭集的唯一正本）；② quay-init.sh:2220/2232/2233 的 dry-run 文案 + mkdir + created 文案；③ quay-init-closure-assertion.ts:36 的 CLOSED_SET_DIRS；④ docs/analysis/quay-init-closure-ratchet.baseline.json 重锚（⛔ 机械 --reanchor，非手工并 JSON）；⑤ plugin/scripts/laydown-set-check.sh；⑥ plugin/test/quay-init*.test.mjs 五个测试。判据同时读①②③，任一漏改即红。