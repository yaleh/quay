---
id: AC-288
title: 切换机制本身可用——默认 en、?lang=zh 生效并种下持久化 cookie、cookie 单独在无 query 参数的后续请求里继续生效
status: draft
kind: criterion
goal: GOAL-024
criterion: >-
  python3 - <<'CRIT'

  import socket, subprocess, sys, time, urllib.request


  def free_port():
      s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
      s.bind(("127.0.0.1", 0))
      p = s.getsockname()[1]
      s.close()
      return p

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
              urllib.request.urlopen(base + "/dashboard", timeout=3)
              up = True
              break
          except Exception:
              time.sleep(1.5)
      if not up:
          sys.stderr.write("CAUSE=server-did-not-come-up -- quay serve on 127.0.0.1:%d never answered /dashboard within 90s\n" % port); sys.exit(1)

      body_default = urllib.request.urlopen(base + "/dashboard", timeout=15).read().decode("utf-8", "replace")
      if '<html lang="en"' not in body_default:
          sys.stderr.write('CAUSE=default-not-en -- /dashboard with no lang param/cookie did not respond <html lang="en">\n'); sys.exit(1)

      req = urllib.request.Request(base + "/dashboard?lang=zh")
      resp = urllib.request.urlopen(req, timeout=10)
      set_cookie = resp.headers.get("Set-Cookie") or ""
      body_qs = resp.read().decode("utf-8", "replace")
      if '<html lang="zh"' not in body_qs:
          sys.stderr.write('CAUSE=query-param-not-honored -- /dashboard?lang=zh did not respond <html lang="zh">\n'); sys.exit(1)
      if "lang=zh" not in set_cookie:
          sys.stderr.write("CAUSE=no-persistence-cookie -- /dashboard?lang=zh did not set a cookie carrying lang=zh (Set-Cookie was: %r), so the choice cannot survive a later request with no query param\n" % set_cookie); sys.exit(1)

      req2 = urllib.request.Request(base + "/dashboard", headers={"Cookie": "lang=zh"})
      body_cookie = urllib.request.urlopen(req2, timeout=10).read().decode("utf-8", "replace")
      if '<html lang="zh"' not in body_cookie:
          sys.stderr.write('CAUSE=cookie-not-honored-without-query-param -- /dashboard with Cookie: lang=zh (no ?lang= in the URL) did not respond <html lang="zh">; persistence across navigation is broken\n'); sys.exit(1)

      print("OK -- lang mechanism: default=en, ?lang=zh flips to zh and sets a persistence cookie, and the cookie alone (no query param) keeps resolving to zh on the next request")
      sys.exit(0)
  finally:
      proc.terminate()
      try:
          proc.wait(timeout=5)
      except Exception:
          proc.kill()
  CRIT
expect: criterion exits 0 once /dashboard defaults to <html lang="en"> with no
  lang param/cookie, ?lang=zh both flips the response to <html lang="zh"> AND
  sets a cookie carrying lang=zh, and a later request that sends ONLY that
  cookie (no ?lang= in the URL) still resolves to <html lang="zh">.
origin: 人 2026-09-17 讨论裁定的切换机制契约（本 AC 本身即该契约的可执行规格）：query 参数名/值 =
  lang=en|zh，cookie 名/值 = lang=en|zh，默认 en；对话见 GOAL-024 origin。
---
