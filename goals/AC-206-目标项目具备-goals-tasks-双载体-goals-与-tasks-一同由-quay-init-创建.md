---
id: AC-206
title: 目标项目具备 goals+tasks 双载体——goals/ 与 tasks/ 一同由 quay-init 创建
status: achieved
kind: criterion
goal: GOAL-009
criterion: |-
  python3 - <<'P'
  import atexit,json,os,re,shutil,socket,subprocess,sys,tempfile
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
  # WHY GOAL-029 (2026-10-07): quay-init.sh is now a <=40-line shim that execs the TS engine
  # (packages/quay/src/init.ts), so the former check that grepped its goals mkdir literal was
  # STRUCTURALLY always-false (hard rules 4b/4c: a proxy decoupled from the behaviour). This probe
  # reads BEHAVIOUR: run the init ENGINE in a throwaway git workspace and assert the dual carrier.
  _p_root=os.getcwd()
  _p_tmp=tempfile.mkdtemp(prefix="ac206-init-probe-")
  atexit.register(shutil.rmtree,_p_tmp,ignore_errors=True)
  subprocess.run(["git","init","-q","-b","main","."],cwd=_p_tmp,check=True)
  _p_sc=os.path.join(_p_tmp,"scripts")
  os.makedirs(_p_sc,exist_ok=True)
  _p_ts=os.path.join(_p_sc,"test.sh")
  open(_p_ts,"w").write("#!/usr/bin/env bash\nexit 0\n")
  os.chmod(_p_ts,0o755)
  _p_argv=["node","packages/quay/bin/quay.js","init","--root",_p_tmp]
  try: _p_r=subprocess.run(_p_argv,cwd=_p_root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
  except OSError as _e: sys.stderr.write("NOT-EVALUATED: cannot spawn the init engine: %s\n"%_e); sys.exit(3)
  except subprocess.TimeoutExpired: sys.stderr.write("NOT-EVALUATED: init engine exceeded 45s\n"); sys.exit(3)
  if _p_r.returncode!=0:
      _p_err=_p_r.stderr.decode("utf-8","replace").strip()[:300]
      sys.stderr.write("init engine exit %d: %s\n"%(_p_r.returncode,_p_err)); sys.exit(1)
  _p_goals=os.path.isdir(os.path.join(_p_tmp,"goals"))
  _p_tasks=os.path.isdir(os.path.join(_p_tmp,"tasks"))
  if not _p_goals or not _p_tasks: sys.stderr.write("init engine did not create the dual carrier: goals=%s tasks=%s\n"%(_p_goals,_p_tasks)); sys.exit(1)
  _p_cfg=os.path.join(_p_tmp,".quay","config.yml")
  if not os.path.isfile(_p_cfg): sys.stderr.write("init engine wrote no .quay/config.yml in the probe workspace\n"); sys.exit(1)
  _p_txt=open(_p_cfg,encoding="utf-8").read()
  _p_m=re.search(r"QUAY_NATIVE_GOAL_DIR:\s*\"?([^\"\n]+)",_p_txt)
  if not _p_m: sys.stderr.write("QUAY_NATIVE_GOAL_DIR absent from the probe config\n"); sys.exit(1)
  _p_own=os.path.realpath(os.path.join(_p_tmp,"goals"))
  if os.path.realpath(_p_m.group(1).strip())!=_p_own: sys.stderr.write("QUAY_NATIVE_GOAL_DIR is not bound to this project's own goals/: %s\n"%_p_m.group(1).strip()); sys.exit(1)
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
  sys.stderr.write("AC-206 fail - no carrier record ac=GOAL-009-AC-206 with host other than this host, goals_dir_created and tasks_dir_created true, both stores readable\n"); sys.exit(1)
  P
expect: exit 0 = SPEC 闭集块含 goals/ ∧ CLOSED_SET_DIRS 含 goals ∧ 活引擎在一次性 git
  工作区真的创建 goals/ 与 tasks/ 双载体、且产出的 .quay/config.yml 把 QUAY_NATIVE_GOAL_DIR
  绑到该项目自己的 goals/ ∧ 载体中存在 ac=GOAL-009-AC-206 的记录（host≠本机、非本仓库项目、两目录均创建、两 store
  均可读）。exit 1 = 任一不成立。exit 3 = SPEC 块/常量读不出，或引擎在本机无法运行（无法评估，与「不成立」区分）。
origin: 人 2026-09-09 裁定④：goals/ 目录应当和 tasks/ 目录一起创建（当时 tasks/ 由
  quay-init.sh:2232 创建，goals/ 未创建，CLOSED_SET_DIRS=["tasks"]）。要求③：目标项目中的实际开发活动应使用
  goals 和 tasks 等载体。2026-10-09
  重锚（gap-ac206-criterion-pinned-to-retired-quay-init-sh-goals-mkdir）：GOAL-029（2026-10-07，e0279c77a）把
  quay-init.sh 改成 exec TS 引擎的 ≤40 行 shim，check③ 那条 grep 字面量随之结构性恒假；改为在一次性 git
  工作区跑活引擎的行为探针（硬规则 4b/4c）。
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