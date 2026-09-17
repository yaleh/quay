---
id: AC-289
title: /dashboard 页面在 zh 下真实切换——导航当前项标签与该页面自己的 <title> 都相对英文基线发生变化
status: active
kind: criterion
goal: GOAL-024
criterion: >-
  root=$(git rev-parse --show-toplevel)

  ROUTE="/dashboard"

  LABEL_EN="Dashboard"

  addr=""

  for p in $(pgrep -f 'quay.ts serve' 2>/dev/null); do
    [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$root" ] || continue
    a=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -oE -- '--host [^ ]+ --port [0-9]+' | awk '{print $2":"$4}')
    [ -n "$a" ] || continue
    addr="$a"
    break
  done

  if [ -z "$addr" ]; then echo "CAUSE=no-running-serve-instance -- no quay.ts
  serve process with cwd=$root; $ROUTE cannot be evaluated on a live surface
  (AC-179 probe pattern)" >&2; exit 1; fi

  en=$(curl -sf --max-time 10 "http://$addr$ROUTE" 2>/dev/null)

  if [ -z "$en" ]; then echo "CAUSE=en-fetch-failed -- GET http://$addr$ROUTE
  returned nothing (addr=$addr)" >&2; exit 1; fi

  zh=$(curl -sf --max-time 10 -H 'Cookie: lang=zh' "http://$addr$ROUTE"
  2>/dev/null)

  if [ -z "$zh" ]; then echo "CAUSE=zh-fetch-failed -- GET http://$addr$ROUTE
  with Cookie: lang=zh returned nothing (addr=$addr)" >&2; exit 1; fi

  case "$en" in *"$LABEL_EN"*) ;; *) echo "CAUSE=english-baseline-missing --
  default-locale $ROUTE does not contain the nav label \"$LABEL_EN\" at all;
  this probe's assumption about today's baseline is stale, re-derive it against
  the live page" >&2; exit 1 ;; esac

  title_of() { printf '%s' "$1" | tr '\n' ' ' | grep -oE '<title>[^<]*</title>'
  | head -1 | sed -e 's|^<title>||' -e 's|</title>$||'; }

  t_en=$(title_of "$en")

  if [ -z "$t_en" ]; then echo "CAUSE=no-title-tag -- default-locale $ROUTE has
  no <title> to compare against" >&2; exit 1; fi

  case "$zh" in *'<html lang="zh"'*) ;; *) echo "CAUSE=html-lang-not-zh --
  $ROUTE with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=$addr)"
  >&2; exit 1 ;; esac

  case "$zh" in *"$LABEL_EN"*) echo "CAUSE=nav-label-untranslated -- $ROUTE with
  Cookie: lang=zh still renders the literal English nav label \"$LABEL_EN\";
  this page is not wired to the zh dictionary yet" >&2; exit 1 ;; esac

  t_zh=$(title_of "$zh")

  if [ -z "$t_zh" ]; then echo "CAUSE=no-title-tag-zh -- $ROUTE under Cookie:
  lang=zh has no <title> to compare against" >&2; exit 1; fi

  if [ "$t_zh" = "$t_en" ]; then echo "CAUSE=title-unchanged -- $ROUTE own
  <title> is byte-identical under the zh cookie (\"$t_en\"); only the shared nav
  bar changed, so this page's own chrome was never wired to the locale switch"
  >&2; exit 1; fi

  echo "OK -- $ROUTE: en <title>=\"$t_en\" with nav label \"$LABEL_EN\"; under
  Cookie: lang=zh the response is <html lang=zh>, that literal English nav label
  is gone, and this page's own <title> became \"$t_zh\""

  exit 0
expect: "criterion exits 0 once /dashboard's default-locale response contains
  the literal nav label \"Dashboard\", and under Cookie: lang=zh the response is
  <html lang=\"zh\">, that literal English nav label is absent, and this page's
  OWN <title> text differs from the default-locale <title> (so a change confined
  to the shared nav bar does not satisfy it)."
origin: 人 2026-09-17 讨论裁定：GOAL-024 达成范围 = 全部 15 个 SITE_NAV_ROUTES
  页面之一（/dashboard，nav 标签 "Dashboard"）；断言做在【运行中的服务】上而非源码（硬规则 4 推论三：grep
  源码只证明能产出，不证明已产出）。判据走 AC-179 既定探针形态：从【已在运行】的 `quay.ts serve` 进程（cwd = 仓库根）派生地址再
  curl，⛔ 不自己启服务。2026-09-17 人裁定此设计（选项 A）：原设计每条判据自启 web 服务器（实测 27–60s/条），而
  goal-driver pass 1 对 active GOAL 下每条 AC 每轮无条件执行、meta-driver 再执行一遍同群体，16
  条会让每轮增加 7–16 分钟且付两遍；改为探针后 ~1s/条。操作前提：需有一个 cwd=仓库根的 `quay serve`
  实例在跑；实现落地后须重启该实例才能让判据翻绿。
activatedAt: 2026-09-17T15:49:44.403Z
statusLog:
  - at: 2026-09-17T15:49:44.403Z
    from: draft
    to: active
    actor: user
    reason: 人 2026-09-17 指示激活该 goal（setsid 脱离会话进程组后的复现对照）
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T15:49:44.402Z
---
