---
id: AC-288
title: 切换机制本身可用——默认 en、?lang=zh 生效并种下持久化 cookie、cookie 单独在无 query 参数的后续请求里继续生效
status: achieved
kind: criterion
goal: GOAL-024
criterion: >-
  # >>> addr-derivation (this block is run verbatim by
  packages/quay/test/ac288-criterion-address-derivation.test.mjs)

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

  base="http://$addr/dashboard"

  d=$(curl -sf --max-time 10 "$base" 2>/dev/null)

  rc=$?

  if [ -z "$d" ]; then
    case "$rc" in
      7) fail "default-fetch-refused -- GET $base got no connection (curl exit 7, connection refused) at addr=$addr" ;;
      28) fail "default-fetch-timeout -- GET $base timed out after 10s at addr=$addr" ;;
      *) fail "default-fetch-failed -- GET $base returned nothing (curl exit $rc, addr=$addr)" ;;
    esac
  fi

  case "$d" in *'<html lang="en"'*) ;; *) fail 'default-not-en -- /dashboard
  with no lang param and no cookie did not respond <html lang="en">
  (addr='"$addr"')' ;; esac

  hdr=$(curl -sf --max-time 10 -D - -o /dev/null "$base?lang=zh" 2>/dev/null)

  q=$(curl -sf --max-time 10 "$base?lang=zh" 2>/dev/null)

  if [ -z "$q" ]; then fail "query-param-fetch-failed -- GET $base?lang=zh
  returned nothing (addr=$addr)"; fi

  case "$q" in *'<html lang="zh"'*) ;; *) fail 'query-param-not-honored --
  /dashboard?lang=zh did not respond <html lang="zh"> (addr='"$addr"')' ;; esac

  case "$hdr" in *[Ll]ang=zh*) ;; *) fail "no-persistence-cookie --
  /dashboard?lang=zh set no cookie carrying lang=zh, so the choice cannot
  survive a later request with no query param; response headers were: $hdr"; ;;
  esac

  c=$(curl -sf --max-time 10 -H 'Cookie: lang=zh' "$base" 2>/dev/null)

  if [ -z "$c" ]; then fail "cookie-fetch-failed -- GET $base with Cookie:
  lang=zh returned nothing (addr=$addr)"; fi

  case "$c" in *'<html lang="zh"'*) ;; *) fail
  'cookie-not-honored-without-query-param -- /dashboard with Cookie: lang=zh (no
  ?lang= in the URL) did not respond <html lang="zh">; persistence across
  navigation is broken' ;; esac

  echo "OK -- locale mechanism: default is <html lang=en>; ?lang=zh flips it to
  zh AND sets a persistence cookie; the cookie alone (no query param) keeps
  resolving to zh (addr=$addr derived-from-$src)"

  exit 0
expect: criterion exits 0 once a running quay.ts serve (cwd = repo root) answers
  /dashboard with <html lang="en"> when no lang param/cookie is sent, with
  ?lang=zh flips to <html lang="zh"> AND sets a cookie carrying lang=zh, and
  with only that cookie (no ?lang= in the URL) still resolves to <html
  lang="zh">.
origin: 人 2026-09-17 讨论裁定的切换机制契约（本 AC 本身即该契约的可执行规格）：query 参数名/值 =
  lang=en|zh，cookie 名/值 = lang=en|zh，默认 en。判据走 AC-179 既定探针形态（探【已在运行】的 quay.ts
  serve，cwd=仓库根；⛔ 不自己启服务），并在【chrome 作用域】上断言：导航标签只对 `<nav>…</nav>` 区块匹配、页面标题只对
  `<title>` 匹配。⛔ 不对整段响应体做子串匹配 —— 2026-09-17 实测两处非 chrome 命中会让判据不可满足：① `/board`
  的页内 CSS 注释含 "Board"（`...and the Board NEW badge. */`），永远不会被翻译；② `/dashboard`
  的活动流会渲出含 "Dashboard"/"Tasks" 的**任务标题**（数据）。操作前提：需有一个 cwd=仓库根的 `quay serve`
  实例在跑；实现落地后须重启该实例。
activatedAt: 2026-09-17T14:48:26.158Z
statusLog:
  - at: 2026-09-17T14:48:26.158Z
    from: draft
    to: active
    actor: user
    reason: 人 2026-09-17 对话中明确指示「创建并激活该 goal」——draft 记录已确认写入并可读，这是该指示对应的激活动作。
  - at: 2026-09-17T23:44:46.995Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-17T14:48:26.157Z
---
