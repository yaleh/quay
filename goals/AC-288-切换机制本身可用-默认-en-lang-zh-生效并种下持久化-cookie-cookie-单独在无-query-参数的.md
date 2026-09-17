---
id: AC-288
title: 切换机制本身可用——默认 en、?lang=zh 生效并种下持久化 cookie、cookie 单独在无 query 参数的后续请求里继续生效
status: active
kind: criterion
goal: GOAL-024
criterion: >-
  root=$(git rev-parse --show-toplevel)

  addr=""

  for p in $(pgrep -f 'quay.ts serve' 2>/dev/null); do
    [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$root" ] || continue
    a=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -oE -- '--host [^ ]+ --port [0-9]+' | awk '{print $2":"$4}')
    [ -n "$a" ] || continue
    addr="$a"
    break
  done

  if [ -z "$addr" ]; then echo "CAUSE=no-running-serve-instance -- no quay.ts
  serve process with cwd=$root; the locale mechanism cannot be evaluated on a
  live surface (AC-179 probe pattern)" >&2; exit 1; fi

  base="http://$addr/dashboard"

  d=$(curl -sf --max-time 10 "$base" 2>/dev/null)

  if [ -z "$d" ]; then echo "CAUSE=default-fetch-failed -- GET $base returned
  nothing (addr=$addr)" >&2; exit 1; fi

  case "$d" in *'<html lang="en"'*) ;; *) echo 'CAUSE=default-not-en --
  /dashboard with no lang param and no cookie did not respond <html lang="en">'
  >&2; exit 1 ;; esac

  hdr=$(curl -sf --max-time 10 -D - -o /dev/null "$base?lang=zh" 2>/dev/null)

  q=$(curl -sf --max-time 10 "$base?lang=zh" 2>/dev/null)

  if [ -z "$q" ]; then echo "CAUSE=query-param-fetch-failed -- GET $base?lang=zh
  returned nothing" >&2; exit 1; fi

  case "$q" in *'<html lang="zh"'*) ;; *) echo 'CAUSE=query-param-not-honored --
  /dashboard?lang=zh did not respond <html lang="zh">' >&2; exit 1 ;; esac

  case "$hdr" in *[Ll]ang=zh*) ;; *) echo "CAUSE=no-persistence-cookie --
  /dashboard?lang=zh set no cookie carrying lang=zh, so the choice cannot
  survive a later request with no query param; response headers were: $hdr" >&2;
  exit 1 ;; esac

  c=$(curl -sf --max-time 10 -H 'Cookie: lang=zh' "$base" 2>/dev/null)

  if [ -z "$c" ]; then echo "CAUSE=cookie-fetch-failed -- GET $base with Cookie:
  lang=zh returned nothing" >&2; exit 1; fi

  case "$c" in *'<html lang="zh"'*) ;; *) echo
  'CAUSE=cookie-not-honored-without-query-param -- /dashboard with Cookie:
  lang=zh (no ?lang= in the URL) did not respond <html lang="zh">; persistence
  across navigation is broken' >&2; exit 1 ;; esac

  echo "OK -- locale mechanism: default is <html lang=en>; ?lang=zh flips it to
  zh AND sets a persistence cookie; the cookie alone (no query param) keeps
  resolving to zh"

  exit 0
expect: criterion exits 0 once a running quay.ts serve (cwd = repo root) answers
  /dashboard with <html lang="en"> when no lang param/cookie is sent, with
  ?lang=zh flips to <html lang="zh"> AND sets a cookie carrying lang=zh, and
  with only that cookie (no ?lang= in the URL) still resolves to <html
  lang="zh">.
origin: 人 2026-09-17 讨论裁定的切换机制契约（本 AC 本身即该契约的可执行规格）：query 参数名/值 =
  lang=en|zh，cookie 名/值 = lang=en|zh，默认 en。判据走 AC-179 既定探针形态：从【已在运行】的 `quay.ts
  serve` 进程（cwd = 仓库根）派生地址再 curl，⛔ 不自己启服务。2026-09-17 人裁定此设计（选项 A）：原设计每条判据自启 web
  服务器（实测 27–60s/条），而 goal-driver pass 1 对 active GOAL 下每条 AC 每轮无条件执行、meta-driver
  再执行一遍同群体，16 条会让每轮增加 7–16 分钟且付两遍；改为探针后 ~1s/条。操作前提：需有一个 cwd=仓库根的 `quay serve`
  实例在跑；实现落地后须重启该实例才能让判据翻绿。
activatedAt: 2026-09-17T14:48:26.158Z
statusLog:
  - at: 2026-09-17T14:48:26.158Z
    from: draft
    to: active
    actor: user
    reason: 人 2026-09-17 对话中明确指示「创建并激活该 goal」——draft 记录已确认写入并可读，这是该指示对应的激活动作。
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T14:48:26.157Z
---
