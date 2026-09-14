---
id: AC-205
title: 会话投递通道在项目生命周期内持续可用——目标会话 transcript 外部可核
status: achieved
kind: criterion
goal: GOAL-009
criterion: >-
  python3 - <<'P'

  import json,os,socket,sys

  p=".quay/productization-verification.jsonl"

  if not os.path.exists(p): sys.stderr.write("NOT-EVALUATED: carrier absent\n");
  sys.exit(3)

  me=socket.gethostname()

  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      r=json.loads(l)
      if r.get("ac")!="GOAL-009-AC-205": continue
      h=str(r.get("host") or "")
      if not h or h==me: continue
      if r.get("transcript_confirmed") is not True: continue  # 目标会话 transcript 外部可核，⛔ 非发送方自述
      if not r.get("shipped_from_installed_artifact"): continue
      sys.exit(0)
  sys.stderr.write("AC-205 fail - no carrier record ac=GOAL-009-AC-205 with host
  other than this host, transcript_confirmed=true and
  shipped_from_installed_artifact\n"); sys.exit(1)

  P
expect: exit 0 = 载体中存在 ac=GOAL-009-AC-205 的记录，host≠本机 ∧
  shipped_from_installed_artifact 为真 ∧ transcript_confirmed=true（消息在目标会话
  transcript 中被读到）。exit 1 = 无（当前；dist/send-to-session.js 在安装物里为 0）。exit 3 =
  载体缺失。
origin: 人 2026-09-09：点火依靠会话投递，后续驱动依靠 *-drivers，但仍应可间断使用会话（和会话投递）进行调节（典型地是问题分析与创建
  goal/task）。⇒ 通道不是一次性点火能力，而是项目生命周期内的常在能力。
activatedAt: 2026-09-09T11:49:15.742Z
statusLog:
  - at: 2026-09-09T11:49:15.742Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-11T00:20:45.682Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
**判据（能取假）**：2026-09-09 干跑 exit 1。**三重已知障碍**（实现时逐个消除）：① send-to-session.ts 不在 entry 集 ⇒ 安装物里没有可执行形态（由 AC-202 覆盖）；② driver-runtime.ts:449 notifyManager 把它锚在 opts.root，且 fire-and-forget 无 ack ⇒ 失败不可见；③ 它靠 Unix socket + ~/.claude/sessions/<pid>.json 工作 ⇒ **发送方必须与目标会话同主机**，跨主机须先 ssh 过去再发。**⛔ 不采信发送方自述**：判据要求 transcript_confirmed 由读目标会话 transcript 得出（外部可核），而非 send 的退出码（socket 无 ack）。