---
id: AC-204
title: quay-init 只写启用不写实现——禁列补 mcp/commands/hooks，且成对判定
status: achieved
kind: criterion
goal: GOAL-009
criterion: |-
  python3 - <<'P'
  import json,os,re,socket,sys
  src=open("plugin/scripts/quay-init-closure-assertion.ts",encoding="utf-8").read()
  m=re.search(r"FORBIDDEN_PREFIXES[^=]*=\s*\[(.*?)\]",src,re.S)
  if not m: sys.stderr.write("NOT-EVALUATED: FORBIDDEN_PREFIXES unreadable\n"); sys.exit(3)
  have=set(re.findall(r'"([^"]+)"',m.group(1)))
  need={".mcp.json",".claude/commands/",".claude/hooks/"}
  if not need.issubset(have): sys.stderr.write("forbidden-list missing: %s\n"%sorted(need-have)); sys.exit(1)
  p=".quay/productization-verification.jsonl"
  if not os.path.exists(p): sys.stderr.write("NOT-EVALUATED: carrier absent\n"); sys.exit(3)
  me=socket.gethostname(); here=os.path.realpath(".")
  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      r=json.loads(l)
      if r.get("ac")!="GOAL-009-AC-204": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me or pr==here or pr.startswith(here+os.sep): continue
      if int(r.get("forbidden_count") if r.get("forbidden_count") is not None else 1)!=0: continue
      if r.get("enable_declared") is not True: continue     # 成对：禁列为空 ∧ 启用声明存在
      sys.exit(0)
  sys.exit(1)
  P
expect: exit 0 = FORBIDDEN_PREFIXES 含 .mcp.json/.claude/commands//.claude/hooks/
  ∧ 载体中存在 ac=GOAL-009-AC-204 的记录（host≠本机、非本仓库项目、forbidden_count=0 ∧
  enable_declared=true）。exit 1 = 禁列不全（当前）或无合格记录。exit 3 = 常量或载体读不出。
origin: 人 2026-09-09：quay-init 过程不应复制 Claude Code 扩展（如 mcp/skill 等），以符合 Claude
  Code 扩展和 plugin 的典型实践。实测：FORBIDDEN_PREFIXES 只有
  .claude/skills|workflows|agents/ + plugin/scripts/，grep -c mcp.json =
  0；且断言只在开发树 laydown 上跑，从未在安装物+第三方项目形态上跑过。
activatedAt: 2026-09-09T11:49:14.970Z
statusLog:
  - at: 2026-09-09T11:49:14.971Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-10T22:49:14.727Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
---
**判据（能取假）**：2026-09-09 干跑 exit 1，报 forbidden-list missing: ['.claude/commands/', '.claude/hooks/', '.mcp.json']。**为什么必须成对**：「禁列为空」单独成立时可被「什么都不做」满足——一个什么都不铺的 init 也过。故判据同时要求 enable_declared=true（项目级 enabledPlugins + permissions.allow 指向已安装插件）。这一对合起来才表达契约：**项目只写启用/授权，实现全部由 plugin bundle 原生提供**。