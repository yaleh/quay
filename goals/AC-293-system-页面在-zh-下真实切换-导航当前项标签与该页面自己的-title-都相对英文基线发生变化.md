---
id: AC-293
title: /system 页面在 zh 下真实切换——导航当前项标签与该页面自己的 <title> 都相对英文基线发生变化
status: achieved
kind: criterion
goal: GOAL-024
criterion: >-
  root=$(git rev-parse --show-toplevel)

  ROUTE="/system"

  LABEL_EN="System"

  addr=""

  for p in $(pgrep -f 'quay.ts serve' 2>/dev/null); do
    [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$root" ] || continue
    a=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -oE -- '--host [^ ]+ --port [0-9]+' | awk '{print $2":"$4}')
    [ -n "$a" ] || continue
    case "$a" in 0.0.0.0:*) a="127.0.0.1:${a#0.0.0.0:}" ;; esac
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

  nav_en=$(printf '%s' "$en" | tr '\n' ' ' | grep -o '<nav.*</nav>' | head -c
  60000)

  nav_zh=$(printf '%s' "$zh" | tr '\n' ' ' | grep -o '<nav.*</nav>' | head -c
  60000)

  if [ -z "$nav_en" ]; then echo "CAUSE=no-nav-region -- default-locale $ROUTE
  exposes no <nav>...</nav> region to assert on" >&2; exit 1; fi

  if [ -z "$nav_zh" ]; then echo "CAUSE=no-nav-region-zh -- $ROUTE under Cookie:
  lang=zh exposes no <nav>...</nav> region" >&2; exit 1; fi

  case "$nav_en" in *"$LABEL_EN"*) ;; *) echo "CAUSE=english-baseline-missing --
  the default-locale nav region of $ROUTE does not contain \"$LABEL_EN\"; this
  probe's baseline assumption is stale, re-derive it against the live page" >&2;
  exit 1 ;; esac

  title_of() { printf '%s' "$1" | tr '\n' ' ' | grep -oE '<title>[^<]*</title>'
  | head -1 | sed -e 's|^<title>||' -e 's|</title>$||'; }

  t_en=$(title_of "$en")

  if [ -z "$t_en" ]; then echo "CAUSE=no-title-tag -- default-locale $ROUTE has
  no <title> to compare against" >&2; exit 1; fi

  case "$zh" in *'<html lang="zh"'*) ;; *) echo "CAUSE=html-lang-not-zh --
  $ROUTE with Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=$addr)"
  >&2; exit 1 ;; esac

  case "$nav_zh" in *"$LABEL_EN"*) echo "CAUSE=nav-label-untranslated -- the nav
  region of $ROUTE under Cookie: lang=zh still renders the literal English nav
  label \"$LABEL_EN\"; the nav is not wired to the zh dictionary" >&2; exit 1 ;;
  esac

  t_zh=$(title_of "$zh")

  if [ -z "$t_zh" ]; then echo "CAUSE=no-title-tag-zh -- $ROUTE under Cookie:
  lang=zh has no <title> to compare against" >&2; exit 1; fi

  if [ "$t_zh" = "$t_en" ]; then echo "CAUSE=title-unchanged -- $ROUTE own
  <title> is byte-identical under the zh cookie (\"$t_en\"); only the shared nav
  bar changed, so this page's own chrome was never wired to the locale switch"
  >&2; exit 1; fi

  echo "OK -- $ROUTE: default nav region carries \"$LABEL_EN\" and
  <title>=\"$t_en\"; under Cookie: lang=zh the response is <html lang=zh>, that
  English nav label is gone from the nav region, and this page's own <title>
  became \"$t_zh\""

  exit 0
expect: "criterion exits 0 once the default-locale NAV REGION of /system carries
  the literal nav label \"System\", and under Cookie: lang=zh the response is
  <html lang=\"zh\">, that literal is absent from the nav region, and this
  page's OWN <title> differs from its default-locale <title>."
origin: 人 2026-09-17 讨论裁定：GOAL-024 达成范围 = 全部 15 个 SITE_NAV_ROUTES
  页面之一（/system，nav 标签 "System"）；断言做在【运行中的服务】上而非源码（硬规则 4 推论三：grep
  源码只证明能产出，不证明已产出）。判据走 AC-179 既定探针形态（探【已在运行】的 quay.ts serve，cwd=仓库根；⛔
  不自己启服务），并在【chrome 作用域】上断言：导航标签只对 `<nav>…</nav>` 区块匹配、页面标题只对 `<title>` 匹配。⛔
  不对整段响应体做子串匹配 —— 2026-09-17 实测两处非 chrome 命中会让判据不可满足：① `/board` 的页内 CSS 注释含
  "Board"（`...and the Board NEW badge. */`），永远不会被翻译；② `/dashboard` 的活动流会渲出含
  "Dashboard"/"Tasks" 的**任务标题**（数据）。操作前提：需有一个 cwd=仓库根的 `quay serve`
  实例在跑；实现落地后须重启该实例。
activatedAt: 2026-09-17T16:01:30.905Z
statusLog:
  - at: 2026-09-17T16:01:30.913Z
    from: draft
    to: active
    actor: user
    reason: 人 2026-09-17 对话中明确指示「创建并激活该 goal」；判据已按人裁定改为 AC-179 探针形态（探已在运行的 serve
      实例），激活动作对应该指示。
  - at: 2026-09-17T23:47:24.236Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T16:01:30.839Z
---
