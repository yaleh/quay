---
id: AC-252
title: 控制面上收进 Layer 0 —— 六个 kind 全部从共享骨架获得入站控制（SPEC 阶段 A1）
status: active
kind: criterion
goal: GOAL-017
criterion: >-
  python3 - <<'P'

  import re,sys,pathlib

  rt=pathlib.Path("plugin/scripts/driver-runtime.ts");
  wk=pathlib.Path("plugin/scripts/worker-driver.ts")

  if not rt.exists() or not wk.exists(): sys.stderr.write("AC-252 NOT-EVALUATED:
  driver-runtime.ts or worker-driver.ts missing\n"); sys.exit(3)

  CALL=re.compile(r"(?<![A-Za-z0-9_.])serveControlPlane\s*\(")

  DEF=re.compile(r"(function\s+serveControlPlane|serveControlPlane\s*[:=])")

  def calls(p):
      n=0
      for ln in p.read_text(encoding="utf-8").splitlines():
          s=ln.strip()
          if s.startswith("//") or s.startswith("*") or s.startswith("/*"): continue
          if DEF.search(ln): continue
          if CALL.search(ln): n+=1
      return n
  rt_n=calls(rt); wk_n=calls(wk)

  if rt_n<1: sys.stderr.write("AC-252: driver-runtime.ts (Layer 0) has %d
  serveControlPlane CALL site(s) with definitions excluded => control plane not
  hoisted; the five non-worker kinds still get none\n"%rt_n); sys.exit(1)

  if wk_n>0: sys.stderr.write("AC-252: worker-driver.ts still carries %d own
  call site(s) => two sources, not hoisted\n"%wk_n); sys.exit(1)

  sys.exit(0)

  P
expect: 'exit 0 = `serveControlPlane` 的**调用点**在 Layer 0（`driver-runtime.ts`）∧
  `worker-driver.ts` 不再自带调用点。⊢ 2026-09-13 审计实测出原版的**致命失效**：旧的跳过逻辑 `"(" not in
  s.split(...)[1][:2]` 对 `export async function serveControlPlane(opts: {` 求值为
  False（尾串是 `"(o"`）⇒ **把函数【定义】当成了调用点**⇒ 只要「把定义搬进 driver-runtime.ts + 删掉
  worker-driver 那唯一一处调用」就能 exit 0，而结果是**六个 kind 一个控制面都没有、比现状更差**。现版用 DEF
  正则显式排除定义与赋值形态。exit 1 = 未上收（当前实测：Layer 0 零调用点、worker-driver 一处 ⇒ 必然取假）。exit 3 =
  文件缺失。⚠️ 本判据只测**位置**，⛔ 不测「六个 kind 的控制面各自可达」（SPEC §7-A1 的原判据之一）—— 见
  GOAL「已知覆盖缺口」。'
origin: SPEC §7 阶段 A1 + §2.3。实测：`serveControlPlane` 早在 driver-shared.ts:283
  实现，但只有 worker-driver.ts:4955 一处调用 ⇒ 另外五个 kind 无入站控制。这是【合并已有实现】不是新建（裁定⑤原则①）。
activatedAt: 2026-09-13T14:40:09.757Z
---
