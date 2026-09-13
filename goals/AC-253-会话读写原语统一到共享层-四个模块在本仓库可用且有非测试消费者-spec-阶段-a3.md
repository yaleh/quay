---
id: AC-253
title: 会话读写原语统一到共享层 —— 四个模块在本仓库可用且有非测试消费者（SPEC 阶段 A3）
status: active
kind: criterion
goal: GOAL-017
criterion: |-
  python3 - <<'P'
  import subprocess,sys
  MODS=["pty-frame","delivery-audit","session-liveness","session-schema"]
  IMP=r"""(from|require\()\s*['\"][^'\"]*(pty-frame|delivery-audit|session-liveness|session-schema)[^'\"]*['\"]"""
  try: r=subprocess.run(["git","grep","-nE",IMP,"--","packages/quay/src","plugin/scripts"],capture_output=True,text=True,timeout=120)
  except Exception as e: sys.stderr.write("AC-253 NOT-EVALUATED: git grep failed (%s)\n"%e); sys.exit(3)
  got=set()
  for l in r.stdout.splitlines():
      if not l.strip(): continue
      path=l.split(":")[0]
      if "/test" in path or path.endswith(".test.mjs") or path.endswith(".test.ts"): continue
      for m in MODS:
          if m in l: got.add(m)
  missing=[m for m in MODS if m not in got]
  if missing: sys.stderr.write("AC-253: no non-test IMPORT of shared primitive(s): %s (a bare string mention in a comment does NOT count)\n"%",".join(missing)); sys.exit(1)
  try: r2=subprocess.run(["git","grep","-nE",r"net\.createConnection\s*\(","--","packages/quay/src/serve-send.ts","packages/quay/src/observation.ts"],capture_output=True,text=True,timeout=60)
  except Exception as e: sys.stderr.write("AC-253 NOT-EVALUATED: git grep (second pass) failed (%s)\n"%e); sys.exit(3)
  dup=[l for l in r2.stdout.splitlines() if l.strip()]
  if dup: sys.stderr.write("AC-253: a SECOND hand-written socket implementation survives (%d line(s), first: %s) => SPEC 8-1 violated: 'only one implementation' is the actual A3 criterion\n"%(len(dup),dup[0][:100])); sys.exit(1)
  sys.exit(0)
  P
expect: exit 0 = 四个共享原语模块各有**非测试的真 import**（`from '…'` / `require('…')`）**∧**
  旧的手写 socket 实现（`serve-send.ts` / `observation.ts` 里的
  `net.createConnection(`）**已退役** ⇒ 全仓只有一份（SPEC §7-A3 / §8-1）。⊢ 2026-09-13
  审计实测出原版两个失效：① 用 `git grep` 匹配**任意字符串出现**，而 `accounting-emit.ts` /
  `dead-loop-check.sh` 等**今天就已命中**（只是注释里提过这些词）⇒ 「有消费者」这半边**当时就是恒真的**，把四个文件拷进来即
  exit 0、零 import；② **完全不判「只有一份」**，而那正是 SPEC 的原判据 —— 保留旧副本也能绿。另：现版**不再排除
  `node_modules`**，因为 SPEC §9 开放问题 4 尚未裁定取用形态（共享包 / vendored / npm 包），⛔ AC
  不替开放问题做决定。exit 1 = 缺 import 或旧实现仍在。exit 3 = git grep 不可用。
origin: SPEC
  §3.3。四个零依赖模块（pty-frame/delivery-audit/session-liveness/session-schema）已在
  quay-fleet 踩实；本仓库若自己再写一份就是「两份实现 = 假」。⛔ 判据含「有非测试消费者」以防拷进来就算达成。
activatedAt: 2026-09-13T14:40:10.876Z
---
