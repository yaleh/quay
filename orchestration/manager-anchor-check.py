#!/usr/bin/env python3
"""管理者锚的不变量检查（对照 inner 的 reanchor-prompt.test.mjs）。

背景：inner 的锚是外部送来的固定常量（plugin/scripts/reanchor-prompt.txt），
由 grep 断言 + reanchor-prompt.test.mjs 机械守护；**outer 与管理者都是自锚，
没有任何人校验锚有没有漂**（人 2026-08-07 裁定先修管理者这一层）。

锚的不变量：它必须是【纯指针】——只说去读哪三份文档、必须写哪一行、怎么清扫哨兵。
一旦渗入状态（日期/提交号/任务名）或本轮决策（优先/先做/跳过），它就从"锚"
退化成"又一条散文驱动"，而散文驱动正是 inner 行为漂移的结构根
（gap-inner-has-no-periodic-anchor-prose-only-drives-drift）。

退出码：0 = OK，1 = 违反（fail loud，绝不静默通过）
"""
import re, sys, subprocess, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ANCHOR = ROOT / "orchestration" / "manager-tick-prompt.txt"

if not ANCHOR.exists():
    print("anchor_check=MISSING: 锚文件不存在——重挂 cron 时无对照物可 diff"); sys.exit(1)

s = ANCHOR.read_text()
bad = []

# ① 必须指向四份文档，否则它不再是指针
#    ⚠️ 2026-08-14 SPEC-tick-read-path-slimming §2-A：第 (1) 条的读取目标由 manager-loop-tick.md
#    改为 manager-tick-core.md。理由：loop-tick.md 第 3 行【自己就转指 core】并逐字自称
#    「本文件是理由档案，不是执行清单」——指针指向一个明说"别读我"的 1802 行文件，
#    每轮为此付一次被 25000 token 上限截断的读（实测 57385 token，只拿到 667/1802 = 37%）。
#    loop-tick.md 仍必须【被提到】（理由档案的落点，按 src:N 反查），故留在必需列表里。
for p in ("manager-tick-core.md", "manager-loop-tick.md", "manager-tick-log.md", "manager-phase-goal.md"):
    if p not in s: bad.append(f"缺指向 {p}")
# ② 必须含哨兵清扫规则（否则重挂会靠记住的 ID）
if "哨兵清扫" not in s or "CronList" not in s: bad.append("缺哨兵清扫规则")
# ③ 不得携带状态
if re.search(r"20\d\d-\d\d-\d\d", s): bad.append("含 ISO 日期（状态渗入）")
if re.search(r"\b[0-9a-f]{7,40}\b", s): bad.append("含提交号（状态渗入）")
if re.search(r"gap-[a-z-]{6,}", s): bad.append("含任务名（状态渗入）")
# ④ 不得携带本轮决策——这是 inner 那条 grep 断言的同型
for w in ("本轮重点", "优先", "先做", "暂停", "跳过", "派发"):
    if w in s: bad.append(f"含决策词「{w}」")

# ⑤ 工作树是否干净：未提交的锚改动 = 未经审阅的漂移
rc = subprocess.run(["git", "-C", str(ROOT), "diff", "--quiet", "--", str(ANCHOR)]).returncode
if rc != 0: bad.append("锚有未提交改动（漂移未经审阅）")

if bad:
    print("anchor_check=VIOLATED: " + " / ".join(bad)); sys.exit(1)
print(f"anchor_check=OK ({len(s.strip())} 字符)"); sys.exit(0)
