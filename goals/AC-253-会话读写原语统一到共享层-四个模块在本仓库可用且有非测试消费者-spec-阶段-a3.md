---
id: AC-253
title: 会话读写原语统一到共享层 —— 四个模块在本仓库可用且有非测试消费者（SPEC 阶段 A3）
status: active
kind: criterion
goal: GOAL-017
criterion: >-
  python3 - <<'P'

  import sys,pathlib,subprocess

  mods=["pty-frame","delivery-audit","session-liveness","session-schema"]

  root=pathlib.Path(".")

  found={}

  for m in mods:
      hits=[p for p in root.rglob("%s.*"%m)
            if "node_modules" not in str(p) and ".claude/worktrees" not in str(p)
            and ".quay/" not in str(p) and p.suffix in (".ts",".mjs",".js")]
      found[m]=[str(p) for p in hits]
  missing=[m for m in mods if not found[m]]

  if missing:
      sys.stderr.write("AC-253: shared primitive module(s) absent from this repo: %s => stage A3 not landed\n"%",".join(missing)); sys.exit(1)
  try:
      r=subprocess.run(["git","grep","-l","-E",r"(pty-frame|delivery-audit|session-liveness|session-schema)",
                        "--","packages/quay/src","plugin/scripts"],capture_output=True,text=True,timeout=60)
  except Exception as e:
      sys.stderr.write("AC-253 NOT-EVALUATED: git grep failed (%s)\n"%e); sys.exit(3)
  consumers=[l for l in r.stdout.splitlines() if l.strip() and "test" not in l]

  if not consumers:
      sys.stderr.write("AC-253: modules present but NO non-test consumer under packages/quay/src or plugin/scripts => vendored dead code, not adopted\n"); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0 = 四个共享原语模块（`pty-frame` / `delivery-audit` / `session-liveness` /
  `session-schema`，SPEC §3.3）在本仓库可用**且**在 `packages/quay/src` 或 `plugin/scripts`
  下有非测试消费者（= 真被采用，⛔ 不是 vendored 死代码）。exit 1 = 模块缺失或零消费者（当前：四个模块都不在本仓库 ⇒
  必然取假）。exit 3 = git grep 不可用。⊢ 「有消费者」这一半是防止把文件拷进来就算达成（硬规则 4 推论三）。
origin: SPEC
  §3.3。四个零依赖模块（pty-frame/delivery-audit/session-liveness/session-schema）已在
  quay-fleet 踩实；本仓库若自己再写一份就是「两份实现 = 假」。⛔ 判据含「有非测试消费者」以防拷进来就算达成。
activatedAt: 2026-09-13T14:40:10.876Z
---
