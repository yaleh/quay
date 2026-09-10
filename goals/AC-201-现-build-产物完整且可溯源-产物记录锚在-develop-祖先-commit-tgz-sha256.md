---
id: AC-201
title: 现 build 产物完整且可溯源——产物记录锚在 develop 祖先 commit + tgz sha256
status: achieved
kind: criterion
goal: GOAL-009
criterion: >-
  python3 - <<'P'

  import json,os,subprocess,sys

  p=".quay/productization-verification.jsonl"

  if not os.path.exists(p): sys.stderr.write("NOT-EVALUATED: carrier absent\n");
  sys.exit(3)

  rs=[json.loads(l) for l in open(p,encoding="utf-8") if l.strip()]

  rs=[r for r in rs if r.get("ac")=="GOAL-009-AC-201" and r.get("build_sha") and
  r.get("tgz_sha256")]

  for r in rs:
      if subprocess.run(["git","merge-base","--is-ancestor",r["build_sha"],"develop"],
                        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
          sys.exit(0)
  sys.exit(1)

  P
expect: exit 0 = 载体 .quay/productization-verification.jsonl 中存在
  ac=GOAL-009-AC-201 的记录，其 build_sha 是 develop 的祖先且 tgz_sha256 非空。exit 1 =
  无此记录（当前）。exit 3 = 载体缺失（NOT-EVALUATED，⛔ 不与合格同形）。
origin: AC105 纪律：判据只锚定事后仍可核的对象（commit sha / 内容 sha256），⛔
  不引用生命周期短于判据本身的对象（worktree 内产物路径随 worktree 消失）。
activatedAt: 2026-09-09T11:49:13.531Z
statusLog:
  - at: 2026-09-09T11:49:13.531Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-09T12:14:43.839Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
**判据（能取假）**：2026-09-09 干跑 exit 1（载体存在但无本 AC 记录）。**负控制**：把 build_sha 换成一个非 develop 祖先的 sha ⇒ merge-base --is-ancestor 非零 ⇒ 仍 exit 1。**载体字段约定**：{ac, build_sha, tgz_sha256}，由 verify-deliver-coldstart.sh 的 --ac89 追加面写入（:969/:1098，活脚本；⛔ 注意 productization-verification-record.ts 与 -check.ts 两个独立助手已于 2026-09-07 作为零调用脚本归档，不要引用它们）。