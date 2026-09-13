---
id: AC-252
title: 控制面上收进 Layer 0 —— 六个 kind 全部从共享骨架获得入站控制（SPEC 阶段 A1）
status: active
kind: criterion
goal: GOAL-017
criterion: >-
  python3 - <<'P'

  import re,sys,pathlib

  rt=pathlib.Path("plugin/scripts/driver-runtime.ts")

  wk=pathlib.Path("plugin/scripts/worker-driver.ts")

  if not rt.exists() or not wk.exists():
      sys.stderr.write("AC-252 NOT-EVALUATED: driver-runtime.ts or worker-driver.ts missing\n"); sys.exit(3)
  call=re.compile(r"(?<![A-Za-z0-9_])serveControlPlane\s*\(")

  def calls(p):
      n=0
      for ln in p.read_text(encoding="utf-8").splitlines():
          s=ln.strip()
          if s.startswith("//") or s.startswith("*") or s.startswith("/*"): continue
          if "export" in s and "serveControlPlane" in s and "(" not in s.split("serveControlPlane")[1][:2]: continue
          if call.search(ln): n+=1
      return n
  rt_n=calls(rt); wk_n=calls(wk)

  if rt_n<1:
      sys.stderr.write("AC-252: driver-runtime.ts (Layer 0) has %d serveControlPlane call site(s) => control plane NOT hoisted; every kind does not get it\n"%rt_n); sys.exit(1)
  if wk_n>0:
      sys.stderr.write("AC-252: worker-driver.ts still carries %d own serveControlPlane call site(s) => two sources, not hoisted\n"%wk_n); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = `serveControlPlane` 的调用点在 Layer 0（`driver-runtime.ts`）**且**
  `worker-driver.ts` 不再自带调用点 ⇒ 六个 kind 全部经共享骨架获得控制面（SPEC 阶段 A1）。exit 1 =
  仍未上收（当前实测：Layer 0 零调用点、`worker-driver.ts:4955` 一处 ⇒ 必然取假）。exit 3 = 文件缺失。⊢
  按位置判定（只数非注释行的调用点），⛔ 不按关键词出现次数（硬规则 2）。
origin: SPEC §7 阶段 A1 + §2.3。实测：`serveControlPlane` 早在 driver-shared.ts:283
  实现，但只有 worker-driver.ts:4955 一处调用 ⇒ 另外五个 kind 无入站控制。这是【合并已有实现】不是新建（裁定⑤原则①）。
activatedAt: 2026-09-13T14:40:09.757Z
---
