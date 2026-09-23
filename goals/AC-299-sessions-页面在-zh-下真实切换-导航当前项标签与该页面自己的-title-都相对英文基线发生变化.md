---
id: AC-299
title: /sessions 页面在 zh 下真实切换——导航当前项标签与该页面自己的 <title> 都相对英文基线发生变化
status: achieved
kind: criterion
goal: GOAL-024
criterion: >-
  ROUTE="/sessions"

  LABEL_EN="Sessions"

  # >>> addr-derivation (this block is run verbatim by
  packages/quay/test/ac299-criterion-address-derivation.test.mjs)

  root=$(git rev-parse --show-toplevel)

  cands=""

  for p in $(pgrep -f 'quay.ts serve' 2>/dev/null); do
    [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$root" ] || continue
    cands="$cands $p"
  done

  argv_addr() {
    tr '\0' '\n' < "/proc/$1/cmdline" 2>/dev/null | awk '{arg[NR]=$0} END{s=0; for(i=1;i<=NR;i++) if(arg[i]=="serve"){s=i; break}; if(s==0){print "argv-no-serve"; exit}; h=""; q=""; for(i=s+1;i<=NR;i++){ if(arg[i]=="--host"&&i<NR) h=arg[i+1]; else if(arg[i]=="--port"&&i<NR) q=arg[i+1]; else if(arg[i]~/^--host=/) h=substr(arg[i],8); else if(arg[i]~/^--port=/) q=substr(arg[i],8)}; if(q==""){print "argv-port-absent"; exit}; if(q+0<1){print "argv-port-kernel-assigned"; exit}; if(h==""){print "argv-host-absent"; exit}; print "addr="h":"(q+0)}'
  }

  carrier_addr() {
    f="$root/.quay/server.json"
    [ -f "$f" ] || { echo "carrier-absent"; return; }
    kill -0 "$1" 2>/dev/null || { echo "candidate-pid-dead"; return; }
    if command -v node >/dev/null 2>&1; then
      o=$(node -e '(()=>{const j=require(process.argv[1]);if(String(j.pid)!==process.argv[2])return console.log("carrier-pid-mismatch");const w=(j.services||[]).filter(x=>x&&x.name==="web");if(!w.length)return console.log("carrier-no-web-service");if(w[0].up!==true)return console.log("carrier-web-down");console.log("addr="+w[0].host+":"+w[0].port)})()' "$f" "$1" 2>/dev/null)
    elif command -v python3 >/dev/null 2>&1; then
      o=$(python3 -c 'import json,sys
  d=json.load(open(sys.argv[1]))

  if str(d.get("pid"))!=sys.argv[2]: print("carrier-pid-mismatch"); sys.exit()

  w=[x for x in (d.get("services") or []) if x.get("name")=="web"]

  if not w: print("carrier-no-web-service"); sys.exit()

  if w[0].get("up") is not True: print("carrier-web-down"); sys.exit()

  print("addr=%s:%s"%(w[0].get("host"),w[0].get("port")))' "$f" "$1"
  2>/dev/null)
    else
      o="carrier-no-json-tool"
    fi
    rc=$?
    if [ -z "$o" ]; then
      if [ "$rc" != 0 ]; then o="carrier-unreadable-rc$rc"; else o="carrier-unreadable"; fi
    fi
    echo "$o"
  }

  fail() { echo "CAUSE=$1" >&2; if [ -n "$cands" ]; then echo "CANDIDATES:$rep"
  >&2; else echo "CANDIDATES: none -- pgrep -f 'quay.ts serve' x cwd=$root
  matched no process" >&2; fi; exit 1; }

  addr=""

  src=""

  rep=""

  for p in $cands; do
    a=""
    c=""
    s=""
    ra=$(argv_addr "$p")
    case "$ra" in addr=*) a="${ra#addr=}"; s="argv" ;; *) c="$ra" ;; esac
    if [ -z "$a" ]; then
      rc2=$(carrier_addr "$p")
      case "$rc2" in addr=*) a="${rc2#addr=}"; s="carrier" ;; *) c="${c:+$c,}$rc2" ;; esac
    fi
    case "$a" in 0.0.0.0:*) a="127.0.0.1:${a#0.0.0.0:}" ;; "*:"*) a="127.0.0.1:${a#*:}" ;; "::"*) a="127.0.0.1:${a#::}" ;; esac
    if [ -n "$a" ]; then
      rep="$rep | pid=$p addr=$a cause=derived-from-$s"
      if [ -z "$addr" ]; then addr="$a"; src="$s"; fi
    else
      rep="$rep | pid=$p addr=- cause=$c"
    fi
  done

  if [ -z "$addr" ]; then
    if [ -z "$cands" ]; then fail "no-running-serve-instance -- no quay.ts serve process with cwd=$root; the locale mechanism cannot be evaluated on a live surface (AC-179 probe pattern)"; fi
    fail "no-derivable-address -- pgrep -f 'quay.ts serve' x cwd=$root matched candidate(s) but none yielded a live web address (an explicit --port >= 1 on the process's own argv, or this root's .quay/server.json naming that pid's web service)"
  fi

  # <<< addr-derivation

  en=$(curl -sf --max-time 10 "http://$addr$ROUTE" 2>/dev/null)

  if [ -z "$en" ]; then fail "en-fetch-failed -- GET http://$addr$ROUTE returned
  nothing (addr=$addr)"; fi

  zh=$(curl -sf --max-time 10 -H 'Cookie: lang=zh' "http://$addr$ROUTE"
  2>/dev/null)

  if [ -z "$zh" ]; then fail "zh-fetch-failed -- GET http://$addr$ROUTE with
  Cookie: lang=zh returned nothing (addr=$addr)"; fi

  nav_en=$(printf '%s' "$en" | tr '\n' ' ' | grep -o '<nav.*</nav>' | head -c
  60000)

  nav_zh=$(printf '%s' "$zh" | tr '\n' ' ' | grep -o '<nav.*</nav>' | head -c
  60000)

  if [ -z "$nav_en" ]; then fail "no-nav-region -- default-locale $ROUTE exposes
  no <nav>...</nav> region to assert on"; fi

  if [ -z "$nav_zh" ]; then fail "no-nav-region-zh -- $ROUTE under Cookie:
  lang=zh exposes no <nav>...</nav> region"; fi

  case "$nav_en" in *"$LABEL_EN"*) ;; *) fail "english-baseline-missing -- the
  default-locale nav region of $ROUTE does not contain \"$LABEL_EN\"; this
  probe's baseline assumption is stale, re-derive it against the live page" ;;
  esac

  title_of() { printf '%s' "$1" | tr '\n' ' ' | grep -oE '<title>[^<]*</title>'
  | head -1 | sed -e 's|^<title>||' -e 's|</title>$||'; }

  t_en=$(title_of "$en")

  if [ -z "$t_en" ]; then fail "no-title-tag -- default-locale $ROUTE has no
  <title> to compare against"; fi

  case "$zh" in *'<html lang="zh"'*) ;; *) fail "html-lang-not-zh -- $ROUTE with
  Cookie: lang=zh did not respond <html lang=\"zh\"> (addr=$addr)" ;; esac

  case "$nav_zh" in *"$LABEL_EN"*) fail "nav-label-untranslated -- the nav
  region of $ROUTE under Cookie: lang=zh still renders the literal English nav
  label \"$LABEL_EN\"; the nav is not wired to the zh dictionary" ;; esac

  t_zh=$(title_of "$zh")

  if [ -z "$t_zh" ]; then fail "no-title-tag-zh -- $ROUTE under Cookie: lang=zh
  has no <title> to compare against"; fi

  if [ "$t_zh" = "$t_en" ]; then fail "title-unchanged -- $ROUTE own <title> is
  byte-identical under the zh cookie (\"$t_en\"); only the shared nav bar
  changed, so this page's own chrome was never wired to the locale switch"; fi

  echo "OK -- $ROUTE: default nav region carries \"$LABEL_EN\" and
  <title>=\"$t_en\"; under Cookie: lang=zh the response is <html lang=zh>, that
  English nav label is gone from the nav region, and this page's own <title>
  became \"$t_zh\""

  exit 0
expect: "criterion exits 0 once the default-locale NAV REGION of /sessions
  carries the literal nav label \"Sessions\", and under Cookie: lang=zh the
  response is <html lang=\"zh\">, that literal is absent from the nav region,
  and this page's OWN <title> differs from its default-locale <title>."
origin: 人 2026-09-17 讨论裁定：GOAL-024 达成范围 = 全部 15 个 SITE_NAV_ROUTES
  页面之一（/sessions，nav 标签 "Sessions"）；断言做在【运行中的服务】上而非源码（硬规则 4 推论三：grep
  源码只证明能产出，不证明已产出）。判据走 AC-179 既定探针形态（探【已在运行】的 quay.ts serve，cwd=仓库根；⛔
  不自己启服务），并在【chrome 作用域】上断言：导航标签只对 `<nav>…</nav>` 区块匹配、页面标题只对 `<title>` 匹配。⛔
  不对整段响应体做子串匹配 —— 2026-09-17 实测两处非 chrome 命中会让判据不可满足：① `/board` 的页内 CSS 注释含
  "Board"（`...and the Board NEW badge. */`），永远不会被翻译；② `/dashboard` 的活动流会渲出含
  "Dashboard"/"Tasks" 的**任务标题**（数据）。操作前提：需有一个 cwd=仓库根的 `quay serve`
  实例在跑；实现落地后须重启该实例。
activatedAt: 2026-09-17T16:13:47.718Z
statusLog:
  - at: 2026-09-17T16:13:47.718Z
    from: draft
    to: active
    actor: user
    reason: 人 2026-09-17 对话中明确指示「创建并激活该 goal」；判据已按人裁定改为 AC-179 探针形态（探已在运行的 serve
      实例），激活动作对应该指示。
  - at: 2026-09-17T23:48:52.667Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T16:13:47.718Z
---
