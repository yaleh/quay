---
id: AC-289
title: /dashboard 页面在 zh 下真实切换——导航当前项标签与该页面自己的 <title> 都相对英文基线发生变化
status: achieved
kind: criterion
goal: GOAL-024
criterion: >-
  root=$(git rev-parse --show-toplevel)


  ROUTE="/dashboard"


  LABEL_EN="Dashboard"


  # ── address derivation (the ONE step this amendment re-anchors)
  ──────────────────────────────

  # WHY IT CHANGED (2026-09-23, gap-ac289-criterion-cmdline-port-literal-stale):
  the launcher default

  # for the web port is now 0 = kernel-assigned ephemeral
  (plugin/scripts/start-drivers.ts), so the

  # "--host H --port N" literal in the cmdline no longer carries the port it
  used to — a live gen-2

  # instance was derived as "host:0" and the probe died with
  CAUSE=en-fetch-failed against a server

  # that was up the whole time (ledger: same criterionHash green at 04:51Z, red
  from 08:21Z, i.e. the

  # CARRIER moved, not the criterion's subject). The real listening port is
  knowable only from the

  # live host's own carrier 活宿主自身的服务状态载体 (writer packages/quay/src/serve.ts;
  read contract

  # packages/quay/src/server-state.ts, which already owns the shape + the
  three-way read outcome).

  # ⛔ No host/port literal is written down here — the value is re-derived on
  every run, so a restart

  # (which binds a different ephemeral port) cannot stale it again. The carrier
  is used ONLY to derive

  # an address; the verdict stays the external HTTP GET below (hard rule 4b).

  ncand=0


  nderived=0


  addr=""


  report=""


  for p in $(pgrep -f 'quay.ts serve' 2>/dev/null); do
    [ -d /proc/$p ] || continue
    [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$root" ] || continue
    ncand=$((ncand + 1))
    a=""
    cause=""
    lit=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -oE -- '--host [^ ]+ --port [0-9]+' | awk '{print $2":"$4}')
    case "$lit" in *:0) lit="" ;; esac
    if [ -n "$lit" ]; then
    a="$lit"
    else
    o=$(node --no-warnings --experimental-strip-types "$root/plugin/scripts/live-web-address.ts" "$root" "$p" 2>&1)
    rc=$?
    if [ "$rc" = 0 ]; then a="$o"; else a=""; case "$rc:$o" in 1:carrier-web-down) cause="carrier-web-down" ;; 3:*) cause="${o:-carrier-unreadable}" ;; *) cause="carrier-helper-unavailable(exit=$rc)" ;; esac; fi
    fi
    case "$a" in 0.0.0.0:*) a="127.0.0.1:${a#0.0.0.0:}" ;; ::*) a="127.0.0.1:${a#::}" ;; esac
    if [ -n "$a" ]; then nderived=$((nderived + 1)); fi
    if [ -z "$a" ]; then report="$report; pid=$p addr=<none> cause=${cause:-not-derivable}"; continue; fi
    if [ -n "$addr" ]; then report="$report; pid=$p addr=$a cause=not-probed -- an earlier candidate already answered"; continue; fi
    curl -sf --max-time 10 -o /dev/null "http://$a$ROUTE" 2>/dev/null
    crc=$?
    if [ "$crc" = 0 ]; then addr="$a"; report="$report; pid=$p addr=$a cause=fetch-answered"; continue; fi
    case "$crc" in 6) cc="host-unresolvable" ;; 7) cc="connection-refused" ;; 22) cc="http-error" ;; 28) cc="timeout" ;; *) cc="curl-exit-$crc" ;; esac
    why=$(curl -sfS --max-time 10 -o /dev/null "http://$a$ROUTE" 2>&1 | tr '\n' ' ')
    report="$report; pid=$p addr=$a cause=fetch-failed($cc) -- ${why:-curl exited $crc with no message}"
  done


  # ── THE THREE UNEVALUABLE BRANCHES BELOW CARRY THE REPO'S NOT-EVALUATED CODE,
  NOT 1 ────────────

  # WHY (2026-09-30, gap-ac289-criterion-carrier-absence-not-evaluated): "no
  live instance", "no

  # derivable address" and "no reachable address" are each "I cannot evaluate
  this HERE", not "this

  # is false". The repo already fixed a value for that state —
  plugin/scripts/live-web-address.ts's

  # header cites the word list verbatim (0=pass / 1=fail / 2=usage /
  3=not-evaluated), and

  # packages/quay/src/gate/acceptance-runner.ts maps only 126/127 to
  not-runnable, so a branch that

  # wants the not-evaluated verdict must carry that code itself. Measured before
  this amendment:

  # goal-driver.ts's runPrefilingRecheck read these branches as
  `confirmed-failing` and filed a gap

  # EVERY round against a live server that was answering. The 10 ASSERTION
  branches below are

  # UNCHANGED and still carry the failure code — a broken page must never read
  as unevaluable.

  if [ "$ncand" = 0 ]; then echo "CAUSE=no-running-serve-instance -- no quay.ts
  serve process with cwd=$root; $ROUTE cannot be evaluated on a live surface
  (AC-179 probe pattern)" >&2; exit 3; fi


  if [ "$nderived" = 0 ]; then printf 'CAUSE=no-derivable-serve-address -- %s
  quay.ts serve candidate(s) with cwd=%s, none yielded a derivable address;
  per-candidate readings:%s\n' "$ncand" "$root" "$report" >&2; exit 3; fi


  if [ -z "$addr" ]; then printf 'CAUSE=no-reachable-serve-address -- %s
  derivable address(es) among %s candidate(s) for cwd=%s, none answered $ROUTE
  (connection refused / timed out / non-2xx); per-candidate readings:%s\n'
  "$nderived" "$ncand" "$root" "$report" >&2; exit 3; fi


  printf 'AC-289 candidate readings (cwd=%s):%s\n' "$root" "$report" >&2


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
expect: "criterion exits 0 once the default-locale NAV REGION of /dashboard
  carries the literal nav label \"Dashboard\", and under Cookie: lang=zh the
  response is <html lang=\"zh\">, that literal is absent from the nav region,
  and this page's OWN <title> differs from its default-locale <title>."
origin: 人 2026-09-17 讨论裁定：GOAL-024 达成范围 = 全部 15 个 SITE_NAV_ROUTES
  页面之一（/dashboard，nav 标签 "Dashboard"）；断言做在【运行中的服务】上而非源码（硬规则 4 推论三：grep
  源码只证明能产出，不证明已产出）。判据走 AC-179 既定探针形态（探【已在运行】的 quay.ts serve，cwd=仓库根；⛔
  不自己启服务），并在【chrome 作用域】上断言：导航标签只对 `<nav>…</nav>` 区块匹配、页面标题只对 `<title>` 匹配。⛔
  不对整段响应体做子串匹配 —— 2026-09-17 实测两处非 chrome 命中会让判据不可满足：① `/board` 的页内 CSS 注释含
  "Board"（`...and the Board NEW badge. */`），永远不会被翻译；② `/dashboard` 的活动流会渲出含
  "Dashboard"/"Tasks" 的**任务标题**（数据）。操作前提：需有一个 cwd=仓库根的 `quay serve`
  实例在跑；实现落地后须重启该实例。 【2026-09-23 修订 ·
  gap-ac289-criterion-cmdline-port-literal-stale · 只重锚地址派生那一步】为什么改：判据原先从 `--host
  H --port N` 这个 **cmdline
  字面量**派生地址，而启动器（`plugin/scripts/start-drivers.ts`）已按设计把 web 端口的默认改成 **0 =
  内核分配临时端口**（`ce0f47518`，2026-09-18，`gap-serve-same-root-admission-lock`，done）⇒
  实例的 cmdline 是 `--port 0`，判据派生出 `host:0`，对一台**一直活着**的服务报出
  `CAUSE=en-fetch-failed`。台账两侧的 `criterionHash` 完全相同（`2026-09-23T04:51:13Z` pass
  与 `08:21:12Z` fail 同为 `d5569285de4b0f26`）⇒ 判据文本没变，**是承载体（部署形态）搬了家**；同族的 AC-288
  在同一对时刻同向翻转。⛔ 修法不是把 web 钉回固定端口（那会把 `start-drivers.ts`
  头注释记下的「无关进程占住硬编码端口⇒假绿」重新引入，且正是硬规则 4
  推论二点名的形态），而是把派生那一步移到**真正承载这个角色的地方**：活宿主自己的载体 `活宿主自身的服务状态载体`（写者
  `packages/quay/src/serve.ts`，读契约正本 `packages/quay/src/server-state.ts`；结构化读面
  `quay server status --json`）。载体只用来**派生地址**，判定仍由对 `/dashboard` 的外部 HTTP GET
  作出（硬规则 4b）；`expect`、作用域（仍只遍历 cwd=仓库根的生产 serve）、对 `<nav>` 区块与本页 `<title>`
  的断言**逐字不变**（⛔ 不减强度）；两类部署形态（cmdline 显式端口 / `--port 0` +
  载体）都能解析，且不写死任何宿主字面量（换台机器或重启后仍有效 —— 实测见 AC3）。
activatedAt: 2026-09-17T15:49:44.403Z
statusLog:
  - at: 2026-09-17T15:49:44.403Z
    from: draft
    to: active
    actor: user
    reason: 人 2026-09-17 指示激活该 goal（setsid 脱离会话进程组后的复现对照）
  - at: 2026-09-17T23:44:51.682Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T15:49:44.402Z
---
