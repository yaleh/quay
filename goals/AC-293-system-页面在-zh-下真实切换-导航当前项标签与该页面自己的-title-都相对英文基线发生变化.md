---
id: AC-293
title: /system 页面在 zh 下真实切换——导航当前项标签与该页面自己的 <title> 都相对英文基线发生变化
status: draft
kind: criterion
goal: GOAL-024
criterion: >-
  python3 - <<'CRIT'

  import re, socket, subprocess, sys, time, urllib.request


  ROUTE = "/system"

  NAV_LABEL_EN = "System"


  def free_port():
      s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
      s.bind(("127.0.0.1", 0))
      p = s.getsockname()[1]
      s.close()
      return p

  def title_of(body):
      m = re.search(r"<title>(.*?)</title>", body, re.S)
      return m.group(1) if m else None

  port = free_port()

  proc = subprocess.Popen(
      ["node", "packages/quay/bin/quay.js", "serve", "--host", "127.0.0.1", "--port", str(port)],
      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
  )

  try:
      base = "http://127.0.0.1:%d" % port
      deadline = time.time() + 90
      up = False
      while time.time() < deadline:
          try:
              urllib.request.urlopen(base + ROUTE, timeout=3)
              up = True
              break
          except Exception:
              time.sleep(1.5)
      if not up:
          sys.stderr.write("CAUSE=server-did-not-come-up -- quay serve on 127.0.0.1:%d never answered %s within 90s\n" % (port, ROUTE)); sys.exit(1)

      body_en = urllib.request.urlopen(base + ROUTE, timeout=15).read().decode("utf-8", "replace")
      if NAV_LABEL_EN not in body_en:
          sys.stderr.write("CAUSE=english-baseline-missing -- default-locale %s does not contain the current nav label %r at all; the probe's assumption about today's baseline is stale, re-derive it against the live page before trusting this criterion\n" % (ROUTE, NAV_LABEL_EN)); sys.exit(1)
      title_en = title_of(body_en)
      if not title_en:
          sys.stderr.write("CAUSE=no-title-tag -- default-locale %s has no <title> tag to compare against\n" % ROUTE); sys.exit(1)

      req_zh = urllib.request.Request(base + ROUTE, headers={"Cookie": "lang=zh"})
      body_zh = urllib.request.urlopen(req_zh, timeout=10).read().decode("utf-8", "replace")
      if '<html lang="zh"' not in body_zh:
          sys.stderr.write('CAUSE=html-lang-not-zh -- %s with Cookie: lang=zh did not respond with <html lang="zh">\n' % ROUTE); sys.exit(1)
      if NAV_LABEL_EN in body_zh:
          sys.stderr.write("CAUSE=nav-label-untranslated -- %s with Cookie: lang=zh still renders the literal English nav label %r; this page has not been wired to the zh dictionary yet\n" % (ROUTE, NAV_LABEL_EN)); sys.exit(1)
      title_zh = title_of(body_zh)
      if not title_zh:
          sys.stderr.write("CAUSE=no-title-tag-zh -- zh-cookie %s has no <title> tag to compare against\n" % ROUTE); sys.exit(1)
      if title_zh == title_en:
          sys.stderr.write("CAUSE=title-unchanged -- %s's own <title> (%r) is byte-identical under the zh cookie; only the shared nav bar changed, this page's own chrome (title/heading) was never wired to the locale switch\n" % (ROUTE, title_en)); sys.exit(1)

      print("OK -- %s: en baseline title=%r nav=%r; zh cookie flips <html lang> to zh, drops the literal English nav label, and changes this page's own <title> to %r" % (ROUTE, title_en, NAV_LABEL_EN, title_zh))
      sys.exit(0)
  finally:
      proc.terminate()
      try:
          proc.wait(timeout=5)
      except Exception:
          proc.kill()
  CRIT
expect: "criterion exits 0 once /system's en baseline contains the literal nav
  label 'System', and under Cookie: lang=zh the response is <html lang=\"zh\">,
  the literal English nav label 'System' is gone, and this page's OWN <title>
  text differs from the en baseline's <title> (not just the shared nav bar)."
origin: 人 2026-09-17 讨论裁定：GOAL-024 达成范围 = 全部 15 个 SITE_NAV_ROUTES
  页面之一（/system，nav key 对应标签 'System'）；判据用真实 HTTP 请求差分探测（en 基线 vs zh
  cookie），不是字符串比对/源码 grep（硬规则 2/4）。
---
