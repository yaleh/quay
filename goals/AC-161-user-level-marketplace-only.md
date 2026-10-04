---
id: AC-161
title: 用户级只留 marketplace 源，启用迁项目级
status: achieved
kind: criterion
goal: GOAL-003
criterion: >-
  python3 - <<'P'

  import json,os,sys

  p=os.path.expanduser('~/.claude/settings.json')

  try: d=json.load(open(p))

  except Exception as e:
      sys.stderr.write("CAUSE=settings-unreadable — cannot read user-level ~/.claude/settings.json: %r\n" % (e,)); sys.exit(1)
  RELEASE={'quay@quay'}

  bad=[k for k in (d.get('enabledPlugins') or {}) if 'quay' in k and k not in
  RELEASE]

  if bad:
      sys.stderr.write("CAUSE=user-enabled-dev-channel — user-level enabledPlugins enables quay DEV/directory-channel plugin(s): %s — the release channel (quay@quay) is allowed, the dev channel is not\n" % ",".join(bad)); sys.exit(1)
  if 'quay' in json.dumps(d.get('env') or {}):
      sys.stderr.write("CAUSE=user-env-quay-path — user-level settings.json 'env' still carries a quay path in key(s): %s\n" % ",".join(k for k,v in (d.get('env') or {}).items() if 'quay' in str(v))); sys.exit(1)
  sys.exit(0)

  P
expect: exit 0（用户级 ~/.claude/settings.json 的 enabledPlugins 无 quay 键 ∧ env 中不含
  quay 路径；读不到该文件即判假，不静默通过）
origin: >
  人 2026-09-02 裁定③「本项目的开发环境不应污染本机其它项目；仅允许 User Scope 以本项目目录为

  plugin marketplace 源」。正本 SPEC-plugin-lifecycle-single-bundle-2026-09-02.md
  §4b。
long-term: true
---

**判据（能取假）**：用户级只留 marketplace 源，启用迁项目级（SPEC §4b）。**迁移顺序**：确认已安装 →
项目级置 true → **最后**撤用户级（反序会把自己锁在门外）。判据 SPEC AC5——在**非 quay 项目**起会话，
`PATH` 不含 `<quay>/plugin/bin` **且** `quay:author` NOT-AVAILABLE。

**取假**：当前状态即红（实测 PATH 含该路径两次）。


