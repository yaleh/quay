---
id: AC-276
title: README.md 定位段落机械判定：quay=software engineering agent，Claude Code=其基础设施（内蕴，非反向）
status: achieved
kind: criterion
goal: GOAL-021
criterion: >-
  python3 - <<'P'

  import re, sys

  text = open("README.md", encoding="utf-8").read()

  head = text[:6000]

  POS = ["Software Engineering Agent", "software engineering agent"]

  INFRA = ["基础设施", "infrastructure"]

  NEG_PATTERNS = [
      r"quay\s+(turns|makes|transforms)\s+Claude\s+Code",
      r"quay\s+是让\s*Claude\s+Code",
      r"quay\s+使\s*Claude\s+Code\s*成为",
  ]

  has_pos = any(p in head for p in POS)

  has_infra_context = any(p in head for p in INFRA)

  neg_hit = None

  for p in NEG_PATTERNS:
      if re.search(p, head, re.IGNORECASE):
          neg_hit = p
          break
  if not has_pos: sys.stderr.write("CAUSE=positioning-missing — README.md head
  (first 6000 chars) does not contain \"Software Engineering Agent\"\n");
  sys.exit(1)

  if not has_infra_context: sys.stderr.write("CAUSE=infra-relation-missing —
  positioning present but no 基础设施/infrastructure term nearby to state the
  Claude-Code-as-infra relation\n"); sys.exit(1)

  if neg_hit: sys.stderr.write("CAUSE=reversed-phrasing-detected — matched
  reversed pattern: %s\n" % neg_hit); sys.exit(1)

  sys.exit(0)

  P
expect: exit 0 = README.md 开头 6000 字符内同时含 'Software Engineering Agent' 与
  '基础设施'/'infrastructure' 语境词，且不含任何反向措辞模式（如 'quay turns Claude Code into' /
  'quay 是让 Claude Code'）。exit 1 且 stderr 带 CAUSE=
  说明具体缺口：positioning-missing（定位词缺失）/ infra-relation-missing（有定位词但没有基础设施语境）/
  reversed-phrasing-detected（命中反向措辞模式）。
origin: manager 2026-09-16 激活，随 GOAL-021 一并生效
activatedAt: 2026-09-16T23:33:19.664Z
statusLog:
  - at: 2026-09-16T23:33:19.664Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-17T02:11:48.196Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-09-16T23:33:19.664Z
---
