#!/usr/bin/env bash
# @instrument "After a develop merge, was a FRESH hardware-independent quay .tgz built at the develop tip and delivered+verified (quay serve http_code=200) on the verification machines B/C (DIR-123 每次 merge 后自动 deliver)?"
# develop-deliver-tgz.sh — DIR-123 (人裁定 2026-08-11) deliver mechanism, RE-ANCHORED as the
# LOW-FREQUENCY trigger (gap-deliver-verification-trigger-orphaned-after-land-path-migration): the
# per-merge hook that used to live in integration-batch-merge.sh is RETIRED (the land path moved to
# worker-driver.ts's mechanical fan-in, which never delivers). Invoke THIS script on a low-frequency
# anchor (OS cron / manager); it self-throttles (see --check/--max-age) and delivers a FRESH,
# hardware-independent quay artifact to the verification machines B/C, proving it runs.
#
# WHY .tgz AND NOT SEA (manager 2026-08-11 measured finding + outer verification):
#   quay's NORMAL artifact is hardware-independent: dist/quay.js is pure JS
#   (`file` → "Node.js script executable, ASCII text"), the three packages' dependency trees are
#   zero-native (@modelcontextprotocol/sdk/yaml/zod all pure JS), and package.sh's npm-pack route is
#   literally "universally available with Node.js". SEA is a SEPARATE arch-bound path whose ONLY
#   purpose is a machine with NO Node — but B (orangevps) has nvm v22.23.1/v25.2.0 and C (ad-arm1)
#   has ~/.local/opt/node-current/node v24.19.0, both ≥ the engines floor. ⇒ installing the .tgz with
#   the existing new Node covers aarch64 with ZERO arch-bound build. The "build arm64 SEA on ad-arm1"
#   complexity does not need to exist (node-free aarch64 SEA stays an explicitly-out-of-scope future
#   option, recorded in the DIR-123 task Finding).
#
# FLOW (best-effort — a remote being down must never fail the trigger):
#   1. build quay + quay-native .tgz from a detached worktree AT THE DEVELOP TIP (git worktree add
#      --detach <develop-tip>) — NOT the primary checkout HEAD, which may be integration ahead with
#      untested commits; the delivered artifact must exactly correspond to the merged commit.
#   2. scp both .tgz to B and C.
#   3. on each host: ONE `npm install -g <quay.tgz> <quay-native.tgz>` (single command so
#      quay-native's `quay:*` dep resolves to the local tgz, not the registry), with PATH prepended
#      to the host's Node ≥20.
#   4. verify the SERVED SURFACE (not just "a port is open"): `verify_http_surface` follows the `/`
#      redirect (gap-webui-root-should-show-dashboard: `/` 302s to `/dashboard` since 01437b3e6) and
#      asserts the FINAL code is 200 AND `/dashboard` returns a non-empty body carrying the stable
#      `<title>Dashboard</title>` marker. Separately, AC92 usage-verify runs the TOP-N real-use
#      mechanisms (deliver-verify-usage.sh) — the http signal and the usage_verify signal are kept
#      DISTINCT in state.json (a usage-verify fail must never mask an http pass, nor vice versa).
#   5. write develop-deliver-state.json (lastDelivered commit + per-host http_code + per-host
#      usage_verify + timestamp).
#
# LOW-FREQUENCY TRIGGER (gap-deliver-verification-trigger-orphaned-after-land-path-migration):
#   This script is NOW the low-frequency deliver trigger — the cron anchor entry point — after the
#   land path migrated off integration-batch-merge.sh (DIR-123's per-merge --deliver hook there is
#   RETIRED; nothing on the mechanical fan-in sync path calls this). Invoke it directly (or from a
#   low-frequency OS cron / manager anchor); it self-throttles on direct quantities so a caller can
#   fire it as often as it likes and it only delivers when the develop tip has moved PAST the last
#   delivered commit AND the last deliver is older than --max-age (default 6h). A remote being down
#   must never fail the caller: the deliver is still best-effort (recorded in state.json, retried
#   on the next trigger).
#
# USAGE:
#   bash plugin/scripts/develop-deliver-tgz.sh [--root <repo>] [--hosts "B C"] [--force]
#                                             [--check] [--max-age <seconds>] [--selfcheck]
#     --root       repo root (default: auto-derived from this script's location)
#     --hosts      space-separated host keys (default "B C"; B=orangevps, C=ad-arm1)
#     --force      rebuild + re-deliver even if state.json already shows develop tip delivered
#     --check      compute the trigger decision ONLY (fresh|too-soon|deliver) from direct quantities
#                  and print it (JSON + one line) — do NOT build/scp/install/verify. Exit 0.
#     --max-age    low-frequency hold in seconds: when the develop tip has moved but the last deliver
#                  is younger than this, decision=too-soon (no deliver). Default 21600 (6h).
#     --selfcheck  hermetic positive/negative controls of the verify criterion + state aggregation
#                  (offline, no build/scp/ssh) — the AC3/AC4/AC5 negative controls, exit 0/1
#     --verify-coldstart  cross-host evidence transport (gap-third-party-evidence-no-transport-to-
#                  driving-repo-carrier): build the two .tgz at the develop tip, scp
#                  verify-deliver-coldstart.sh + the two .tgz to each host, run it there with an
#                  explicit --ac89 <remote tmp path>, scp that evidence file back, and append its
#                  lines into <repo>/.quay/productization-verification.jsonl (dedup on
#                  (ts,ac,host,project_root)). A host that produces no evidence ⇒ NOT-EVALUATED +
#                  exit 1 (硬规则 3b). Distinct from the deliver mode (no http/usage surface verify).
#     --verify-upgrade --upgrade-source <rel-to-$HOME>   GOAL-009-AC-238: the SAME transport, but the
#                  remote script runs --upgrade-existing against an ISOLATED COPY of an AGED real
#                  third-party project (already has .quay/config.yml + real tasks/ + an old vendored
#                  .quay/runtime/bin/*) instead of a fresh quay-init target. Only the
#                  ac=GOAL-009-AC-238 record is transported + dedup-appended; a host that produces no
#                  such record ⇒ NOT-EVALUATED + exit 1. ⛔ The source project is only cp -a'd (read),
#                  never written — the live project's backlog is untouched.
#     --ac207-e2e     (with --verify-coldstart) additionally run the GOAL-009-AC-207 end-to-end step
#                  on each host: scp the driving repo's .quay/profiles.yml (so the target project's
#                  worker-default launcher/model/auth derive from the single source of truth), put
#                  ~/.local/bin on the remote PATH, and pass --ac207-e2e + --driving-profiles to the
#                  remote verify. Expensive: the worker-driver spawns a real worker (claude-fjdac -p)
#                  that does a full implementation → fan-in → suite (up to AC207_POLL_SECS).
#                  Under --ac207-e2e the per-host check also judges PAIRING (GOAL-009-AC-240): the
#                  returned evidence must carry AC-203 and AC-207 records sharing ONE project_root.
#                  `expected_acs` alone only checks the SET of ac kinds — AC-203 (driver alive) and
#                  AC-207 (driver produced) may come from two disjoint batches of witnesses (that is
#                  exactly the measured origin reading), so a host with all six kinds but no shared
#                  (host, project_root) pair is PARTIAL with E2E_PAIR_MISSING=1, never a silent ok.
#     --selfcheck-e2e-pairing  hermetic controls of check_e2e_pairing (offline, no build/scp/ssh):
#                  paired records ⇒ exit 0; AC-207-only ⇒ exit 2 + E2E_PAIR_MISSING=1; two records
#                  with different project_roots ⇒ exit 2; empty evidence ⇒ exit 1 (NOT-EVALUATED).
#     --selfcheck-evidence [positive|negative|both]  hermetic controls of the evidence-transport
#                  append/dedup function (offline, no build/scp/ssh) — the AC5 negative/positive
#                  controls of gap-third-party-evidence-…, exit 0/1
#     --selfcheck-transport-closure  hermetic controls of the SHIPPED SET's closure (offline, no
#                  build/scp/ssh): the real set ⇒ 0 violations; drop the checker ⇒ REF-UNSHIPPED;
#                  drop node_modules/yaml ⇒ BARE-UNSHIPPED; drop gate-script-base.ts ⇒
#                  IMPORT-UNSHIPPED. Prints the per-file import face (AC4 产物). This is what makes
#                  the "explicit enumeration" promise mechanical instead of aspirational.
#
# Host table (B/C node paths verified 2026-08-11 by outer ssh probes):
#   B = orangevps.wan.hwang.men   node: ~/.nvm/versions/node/v22.23.1/bin (also v25.2.0)
#   C = ad-arm1.wan.hwang.men     node: ~/.local/opt/node-current/bin (v24.19.0)
# Both reachable BatchMode with the local ~/.ssh/id_ed25519 — zero new secrets (repo has none).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${SCRIPT_DIR}/../.." && pwd)"
verify_port=18091
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=8)

hosts="B C"
force=0
check_only=0
max_age=21600   # low-frequency hold: don't re-deliver within this many seconds of the last deliver (6h)
selfcheck=0
verify_coldstart=0
verify_upgrade=0  # 1 = GOAL-009-AC-238: upgrade an ISOLATED COPY of an AGED third-party project (not a fresh quay-init)
upgrade_source="" # --upgrade-source: path RELATIVE TO $HOME on the remote host of the aged project to copy (read-only)
ac207_e2e=0       # 1 = also run the GOAL-009-AC-207 end-to-end step on each host (expensive: worker-driver spawns a real worker)
selfcheck_evidence=0
selfcheck_evidence_scenario="both"
selfcheck_evidence_completeness=0
selfcheck_e2e_pairing=0   # 1 = hermetic controls of check_e2e_pairing (AC-240 传输侧配对判定)
selfcheck_transport_closure_flag=0  # 1 = hermetic closure controls of the shipped set (AC1..AC4)
while [ $# -gt 0 ]; do
  case "$1" in
    --root) repo_root="$2"; shift 2 ;;
    --hosts) hosts="$2"; shift 2 ;;
    --force) force=1; shift ;;
    --check) check_only=1; shift ;;
    --max-age) max_age="$2"; shift 2 ;;
    --selfcheck) selfcheck=1; shift ;;
    --verify-coldstart) verify_coldstart=1; shift ;;
    --verify-upgrade) verify_upgrade=1; shift ;;
    --upgrade-source) upgrade_source="$2"; shift 2 ;;
    --ac207-e2e) ac207_e2e=1; shift ;;
    --selfcheck-evidence)
      selfcheck_evidence=1
      case "${2:-}" in positive|negative|both) selfcheck_evidence_scenario="$2"; shift 2 ;; *) shift ;; esac
      ;;
    --selfcheck-evidence-completeness) selfcheck_evidence_completeness=1; shift ;;
    --selfcheck-e2e-pairing) selfcheck_e2e_pairing=1; shift ;;
    --selfcheck-transport-closure) selfcheck_transport_closure_flag=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
case "${max_age}" in
  ''|*[!0-9]*) echo "develop-deliver: --max-age must be a non-negative integer: ${max_age}" >&2; exit 2 ;;
esac

# state/worktree paths derive from the FINAL repo_root (--root override must reach them — a fixture
# --check run otherwise reads the script's own .quay/, not the fixture's).
state_file="${repo_root}/.quay/develop-deliver-state.json"
worktree_base="${repo_root}/.quay/deliver-worktree"   # under repo (gitignored .quay/), NOT /tmp (tmpfs)

# ── verify_http_surface <base_url> ──────────────────────────────────────────────────────────────
# gap-develop-deliver-asserts-http-200-but-root-now-302-redirects: the criterion is FOLLOW THE
# REDIRECT AND ASSERT THE FINAL LANDING REALLY SERVES — not "code == 200 on /". Since 01437b3e6,
# `/` 302s to `/dashboard`; `curl -sf` (no -L) read that as a 302 and failed the deliver even though
# the service is fine. The criterion:
#   1. `curl -sL` on `/` → the FINAL http code after following redirects must be 200.
#      (No `-f`: we want the code even for 4xx/5xx so the reason is recorded; a 302→404 chain yields
#      final code 404 ≠ 200 ⇒ fail — a redirect to 404 is NOT accepted, per the task's ⛔ note.)
#   2. `curl -sL` on `/dashboard` → the body must be non-empty AND carry the stable marker
#      `<title>Dashboard</title>` (AC92 spirit: 端口活着 ≠ 面在服务).
# Prints ONE machine-readable verdict line and returns 0 (pass) / 1 (fail). Self-contained: every
# call re-derives its own output (the selfcheck calls it repeatedly) — no inherited state.
verify_http_surface() {
  local base="$1" final_code body
  final_code="$(curl -sL -o /dev/null -w '%{http_code}' "${base}/" 2>/dev/null || echo "000")"
  if [ "${final_code}" != "200" ]; then
    echo "FAIL reason=root-final-code-not-200 code=${final_code}"
    return 1
  fi
  body="$(curl -sL "${base}/dashboard" 2>/dev/null || true)"
  if [ -z "${body}" ]; then
    echo "FAIL reason=dashboard-body-empty code=${final_code}"
    return 1
  fi
  case "${body}" in
    *"<title>Dashboard</title>"*) ;;
    *) echo "FAIL reason=dashboard-marker-missing code=${final_code}"; return 1 ;;
  esac
  echo "OK final_code=${final_code} dashboard=ok"
  return 0
}

# ── build_state_json <http-array> <usage-array> <tip> ───────────────────────────────────────────
# Single source for the state.json record. Reads the two per-host associative arrays by nameref and
# renders lastDelivered + hosts (http) + usage_verify + timestamp. The selfcheck feeds it synthetic
# arrays to prove every host keeps BOTH signals (no missing key) and the failure values stay
# distinct (verify-fail vs not-evaluated) — 硬规则 3b.
build_state_json() {
  local -n hc="$1" uv="$2"
  local tip="$3" json first hk
  json="{\"lastDelivered\":\"${tip}\",\"hosts\":{"
  first=1
  for hk in "${!hc[@]}"; do
    [ "${first}" -eq 0 ] && json="${json},"
    json="${json}\"${hk}\":\"${hc[$hk]}\""
    first=0
  done
  json="${json}},\"usage_verify\":{"
  first=1
  for hk in "${!uv[@]}"; do
    [ "${first}" -eq 0 ] && json="${json},"
    json="${json}\"${hk}\":\"${uv[$hk]}\""
    first=0
  done
  json="${json}},\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
  printf '%s' "${json}"
}

# ── the verify closure — the shipped set, its npm deps, and the mechanical proof that it is COMPLETE ─
# verify-deliver-coldstart.sh resolves its sibling tools by $SCRIPT_DIR. The scp enumeration is
# explicit (not tar'd) ON PURPOSE — "so a new $SCRIPT_DIR dependency is an explicit edit, not a
# silent remote failure". That promise only holds if something MECHANICAL checks the enumeration
# against the consumer. Until 2026-09-11 nothing did, and the promise was broken:
#   `provider-binding-resolvability-check.ts` entered the verify script's own dependency set
#   (e1bdd0292) but NEITHER enumeration ⇒ on the remote `node "$SCRIPT_DIR/provider-binding-…-check.ts"`
#   died MODULE_NOT_FOUND ⇒ binding_state() read "unreadable" for EVERY project, including ones whose
#   binding is perfectly good ⇒ AC-238's gate `[ "$AC238_POST_BINDING" = "path-resolved" ]` was
#   STRUCTURALLY unsatisfiable and the AC-238 record could never be written in production.
# It was invisible locally because --selfcheck runs in THIS repo, where the file (and node_modules)
# exist — 硬规则 4 推论三: a criterion only the fixture can satisfy proves "can produce", never
# "produced".
#
# The second half of the same defect: the checker imports the BARE npm specifier `yaml`, which no
# shipped sibling did before it — and a bare specifier resolves only through a node_modules the
# remote does not have (`NODE_PATH` has no effect on ESM resolution). So adding the file to the scp
# list is NOT sufficient; its dependency must travel too. Both halves are checked mechanically below
# (a hand-verified "I added the line" is exactly the形态 that failed here).

# transport_flat_files — everything shipped to $HOME/ on the remote.
# ⛔ SINGLE SOURCE: BOTH modes (verify_coldstart_mode / verify_upgrade_mode) ship from here, so a new
# dependency is ONE edit. The 2026-09-11 defect was a two-place enumeration updated in neither place
# (硬规则 5b: 修好一个实例 ≠ 该原则只在那一处适用).
transport_flat_files() {
  printf '%s\n' \
    "${SCRIPT_DIR}/verify-deliver-coldstart.sh" \
    "${SCRIPT_DIR}/pane-state-classify.ts" \
    "${SCRIPT_DIR}/quay-init-closure-assertion.ts" \
    "${SCRIPT_DIR}/gate-script-base.ts" \
    "${SCRIPT_DIR}/repo-root.ts" \
    "${SCRIPT_DIR}/runner-state-write.ts" \
    "${SCRIPT_DIR}/write-json-atomic.ts" \
    "${SCRIPT_DIR}/provider-binding-resolvability-check.ts" \
    "${SCRIPT_DIR}/../../orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md"
}

# transport_node_modules_deps — the bare npm specifiers the shipped set imports, shipped to
# $HOME/node_modules/<pkg> so ESM resolution finds them from the scripts' own directory ($HOME).
# ⛔ Derived from $SCRIPT_DIR (never from the --root-overridable ${repo_root}): under an installed
# artifact $SCRIPT_DIR/../.. IS the package root, which already carries its own nested
# node_modules/yaml — so this resolves in both the dev-tree and the installed layouts.
transport_node_modules_deps() {
  printf '%s\n' "${SCRIPT_DIR}/../../node_modules/yaml"
}

# transport_imports_of <file> — every module specifier the file imports AT RUNTIME. `import type` /
# `export type` statements are erased by --experimental-strip-types, so they are not remote
# dependencies (runner-state-write.ts's type-only `./full-suite-runner.ts` is the live example —
# flagging it would be a false positive, and a guard that cries wolf gets switched off).
transport_imports_of() {
  grep -vE '^[[:space:]]*(//|#|\*|/\*)' "$1" 2>/dev/null \
    | grep -vE '^[[:space:]]*(import|export)[[:space:]]+type[[:space:]]' \
    | grep -oE '(from|import)[[:space:]]*"[^"]+"' \
    | sed -E 's/^[a-z]+[[:space:]]*"//; s/"$//' | sort -u
}

# transport_closure_violations <list-file> — print one line per closure violation; return the count.
# A <list-file> is the newline-separated shipped set (flat files AND node_modules package dirs).
#   0 = the enumeration IS complete (every consumer travels, every shipped file is self-sufficient
#       at the remote, every listed path exists locally).
# ⛔ 一个【读不懂输入】的清单（空文件 / 名字全写错）会得到 0 违规——与【合格】同形。调用方必须先
# 断言清单非空（selfcheck_transport_closure 就是这么用的；硬规则 3b）。
transport_closure_violations() {
  local listfile="$1" n=0 f name imp pkg
  local -a shipped=() pkgs=()
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    shipped+=("$f")
    case "$f" in */node_modules/*) pkgs+=("$(basename "$f")") ;; esac
  done < "$listfile"

  in_shipped() { local x; for x in "${shipped[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }
  in_pkgs()    { local x; for x in "${pkgs[@]}";    do [ "$x" = "$1" ] && return 0; done; return 1; }

  # (0) every listed path must exist — a typo in the enumeration is a silent remote failure too.
  for f in "${shipped[@]}"; do
    [ -e "$f" ] || { echo "MISSING-LOCAL: $f (enumerated but not on disk)"; n=$((n + 1)); }
  done

  # (1) REFERENCE closure — every $SCRIPT_DIR sibling the verify script invokes OUTSIDE its own
  #     selfcheck() must travel. selfcheck() runs LOCALLY (--selfcheck), so its extra consumers
  #     (transcript-delivery-check.ts) are legitimately local-only; excluding the function BODY is
  #     what makes that distinction mechanical rather than an exemption list someone can extend.
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    in_shipped "${SCRIPT_DIR}/${name}" \
      || { echo "REF-UNSHIPPED: ${name} — invoked by verify-deliver-coldstart.sh but absent from the shipped set"; n=$((n + 1)); }
  done < <(sed '/^selfcheck() {/,/^}$/d' "${SCRIPT_DIR}/verify-deliver-coldstart.sh" 2>/dev/null \
           | grep -oE '\$\{?SCRIPT_DIR\}?/[A-Za-z0-9._-]+\.(ts|mjs|js|sh)' \
           | sed -E 's#^\$\{?SCRIPT_DIR\}?/##' | sort -u)

  # (2) IMPORT closure — every shipped .ts must be self-sufficient at the remote: node builtins, a
  #     ./ relative import that is itself shipped, or a bare specifier whose package travels under
  #     node_modules/. Anything else is MODULE_NOT_FOUND on the remote.
  for f in "${shipped[@]}"; do
    case "$f" in *.ts) ;; *) continue ;; esac
    while IFS= read -r imp; do
      [ -n "$imp" ] || continue
      case "$imp" in
        node:*) continue ;;
        ./*|../*)
          in_shipped "${SCRIPT_DIR}/${imp#./}" || in_shipped "${SCRIPT_DIR}/${imp#./}.ts" \
            || { echo "IMPORT-UNSHIPPED: $(basename "$f") imports ${imp} — not in the shipped set"; n=$((n + 1)); } ;;
        *)
          pkg="${imp%%/*}"
          case "$imp" in @*/*) pkg="$(printf '%s' "$imp" | cut -d/ -f1,2)" ;; esac
          in_pkgs "$pkg" || { echo "BARE-UNSHIPPED: $(basename "$f") imports bare \"${imp}\" — package \"${pkg}\" does not travel under node_modules/ (NODE_PATH does not apply to ESM)"; n=$((n + 1)); } ;;
      esac
    done < <(transport_imports_of "$f")
  done
  return "${n}"
}

# ship_verify_closure <target> [extra-file…] — copy the WHOLE closure to $HOME on <target>.
# Returns 0 on success; ANY leg failing prints a distinguishable line and returns 1 so the caller
# marks that host failed (硬规则 3b — never a silent continue on a partial ship).
ship_verify_closure() {
  local target="$1"; shift
  local -a flat=() deps=() extra=("$@")
  local f
  while IFS= read -r f; do [ -n "$f" ] && flat+=("$f"); done < <(transport_flat_files)
  while IFS= read -r f; do [ -n "$f" ] && deps+=("$f"); done < <(transport_node_modules_deps)

  if ! scp "${ssh_opts[@]}" "${flat[@]}" ${extra[@]+"${extra[@]}"} "${target}:~/" >/dev/null 2>&1; then
    echo "develop-deliver: ${target} — closure scp FAILED (flat set: verify-deliver-coldstart.sh + \$SCRIPT_DIR siblings + SPEC)" >&2
    return 1
  fi
  if [ "${#deps[@]}" -gt 0 ]; then
    # ⛔ scp -r does NOT create missing intermediate dirs (measured 2026-09-11: `scp -r d
    # host:~/a/b/c` fails "path canonicalization failed" when ~/a/b is absent) — make the
    # resolution root first, or the node_modules half silently does not arrive.
    if ! ssh "${ssh_opts[@]}" "${target}" 'mkdir -p "$HOME/node_modules"' >/dev/null 2>&1; then
      echo "develop-deliver: ${target} — closure mkdir \$HOME/node_modules FAILED (node_modules set)" >&2
      return 1
    fi
    if ! scp "${ssh_opts[@]}" -r "${deps[@]}" "${target}:~/node_modules/" >/dev/null 2>&1; then
      echo "develop-deliver: ${target} — closure scp FAILED (node_modules set — a bare specifier the pre-e1bdd0292 sibling set never had)" >&2
      return 1
    fi
  fi
  return 0
}


# ── selfcheck — hermetic positive/negative controls (offline, no build/scp/ssh) ─────────────────
# Proves the verify criterion can take FALSE (404 / redirect-to-404 / empty body / missing marker)
# and TRUE (302→dashboard→200, direct 200), and that the state aggregation keeps every host's two
# signals present + distinct. Uses a throwaway node HTTP stub on an OS-assigned port.
selfcheck() {
  local tmp rc=0
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck: FAIL — cannot create temp dir" >&2; return 1; }
  cat > "${tmp}/stub.mjs" <<'STUB'
import http from "node:http";
const scenario = process.argv[2];
const ok = "<html><head><title>Dashboard</title></head><body>dashboard</body></html>";
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, "http://127.0.0.1").pathname;
  const redirect = () => { res.writeHead(302, { Location: "/dashboard" }); res.end(); };
  const text = (body, code) => { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }); res.end(body); };
  if (scenario === "redirect-ok")     { if (p === "/") return redirect(); return text(ok, 200); }
  if (scenario === "direct-ok")       { return text(ok, 200); }
  if (scenario === "root-404")        { if (p === "/") return text("not found", 404); return text(ok, 200); }
  if (scenario === "redirect-to-404") { if (p === "/") return redirect(); return text("not found", 404); }
  if (scenario === "empty-body")      { if (p === "/") return redirect(); return text("", 200); }
  if (scenario === "no-marker")       { if (p === "/") return redirect(); return text("<html><head><title>Wrong</title></head></html>", 200); }
  return text(ok, 200);
});
srv.listen(0, "127.0.0.1", () => process.stdout.write(String(srv.address().port) + "\n"));
STUB

  # run_one_control <scenario> <expect-ok|expect-fail>
  run_one_control() {
    local scenario="$1" expect="$2" portfile pid port verdict vrc i
    portfile="${tmp}/port.${RANDOM}"
    node "${tmp}/stub.mjs" "${scenario}" > "${portfile}" 2>/dev/null &
    pid=$!
    port=""
    for i in $(seq 1 60); do
      # strip ANSI escape sequences defensively (FORCE_COLOR=3 colourises console.log even to a file)
      port="$(head -1 "${portfile}" 2>/dev/null | sed $'s/\033\[[0-9;]*m//g' | tr -d '\r\n' || echo "")"
      [ -n "${port}" ] && break
      sleep 0.05
    done
    if [ -z "${port}" ]; then
      echo "selfcheck: ${scenario} → STUB FAILED TO START (no port assigned)" >&2
      kill "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
      rm -f "${portfile}"
      rc=1
      return
    fi
    if verdict="$(verify_http_surface "http://127.0.0.1:${port}" 2>/dev/null)"; then
      vrc=0
    else
      vrc=$?
    fi
    kill "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
    rm -f "${portfile}"
    echo "selfcheck: ${scenario} → ${verdict} (rc=${vrc}, expect ${expect})"
    case "${expect}" in
      ok)   [ "${vrc}" -eq 0 ] || rc=1 ;;
      fail) [ "${vrc}" -ne 0 ] || rc=1 ;;
    esac
  }

  run_one_control redirect-ok ok
  run_one_control direct-ok ok
  run_one_control root-404 fail
  run_one_control redirect-to-404 fail
  run_one_control empty-body fail
  run_one_control no-marker fail

  # state-aggregation control (AC4): one host verified-ok, one verify-failed, one never reached —
  # all three appear with BOTH the http and usage_verify signals, and the failure values stay
  # distinct (verify-fail vs not-evaluated, 硬规则 3b) — a single-host failure must not drop a key.
  declare -A sc_http sc_uv
  sc_http[B]="verify-fail"; sc_http[C]="200"; sc_http[D]="not-evaluated"
  sc_uv[B]="not-run";       sc_uv[C]="ok";   sc_uv[D]="not-run"
  local sc_json both_keys=0 distinct=0
  sc_json="$(build_state_json sc_http sc_uv "test-tip")"
  printf '%s' "${sc_json}" | grep -q '"B"' && printf '%s' "${sc_json}" | grep -q '"C"' && both_keys=1
  printf '%s' "${sc_json}" | grep -q '"verify-fail"' \
    && printf '%s' "${sc_json}" | grep -q '"200"' \
    && printf '%s' "${sc_json}" | grep -q '"not-evaluated"' && distinct=1
  echo "selfcheck: state-aggregation both-keys=${both_keys} distinct-values=${distinct} (expect 1/1)"
  [ "${both_keys}" -eq 1 ] || rc=1
  [ "${distinct}" -eq 1 ] || rc=1

  rm -rf "${tmp}"
  if [ "${rc}" -eq 0 ]; then
    echo "selfcheck: PASS — verify_http_surface follows / to a final 200 with a dashboard marker (302→dashboard passes; 404 / 302→404 / empty-body / no-marker fail) and the per-host state record keeps every host's http + usage_verify signals present and distinct"
  else
    echo "selfcheck: FAIL" >&2
  fi
  return "${rc}"
}

# ── transport_evidence_append <local-carrier> <evidence-file> ───────────────────────────────
# Append the non-empty JSON lines of <evidence-file> into <local-carrier>, deduped on the
# (ts, ac, host, project_root) signature so re-transporting the SAME evidence file is idempotent
# (Plan step 3: repeated transport must not inflate a single record into many — AC-214 freshness).
# Returns 0 + prints `EVIDENCE-TRANSPORT appended=N`; returns 1 + prints `NOT-EVALUATED` when
# <evidence-file> is missing / unreadable / has zero non-empty lines (硬规则 3b: 缺值 ≠ 合格,
# and never silent exit 0 on "no evidence").
transport_evidence_append() {
  local carrier="$1" evidence="$2" appended
  if [ ! -f "$evidence" ] || [ ! -r "$evidence" ]; then
    echo "NOT-EVALUATED evidence-file-missing-or-unreadable path=${evidence}"
    return 1
  fi
  if [ "$(grep -c '.' "$evidence" 2>/dev/null || true)" -eq 0 ]; then
    echo "NOT-EVALUATED evidence-file-zero-lines path=${evidence}"
    return 1
  fi
  mkdir -p "$(dirname "$carrier")"
  appended="$(python3 - "$carrier" "$evidence" <<'PY'
import json, sys
carrier, evidence = sys.argv[1], sys.argv[2]
def sig(r):
    return json.dumps([r.get("ts",""), r.get("ac",""), r.get("host",""), r.get("project_root","")], sort_keys=True)
existing = set()
try:
    with open(carrier, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                existing.add(sig(json.loads(line)))
            except Exception:
                pass
except FileNotFoundError:
    pass
appended = 0
with open(carrier, "a", encoding="utf-8") as out, open(evidence, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        s = sig(r)
        if s in existing:
            continue
        existing.add(s)
        out.write(line + "\n")
        appended += 1
print(appended)
PY
)"
  if [ -z "$appended" ]; then
    echo "NOT-EVALUATED evidence-parse-failed path=${evidence}"
    return 1
  fi
  case "$appended" in ''|*[!0-9]*) echo "NOT-EVALUATED evidence-parse-failed path=${evidence}"; return 1 ;; esac
  echo "EVIDENCE-TRANSPORT appended=${appended} carrier=${carrier} evidence=${evidence}"
  return 0
}

# ── check_evidence_completeness <evidence-file> "<expected-ac-list>" ───────────────────────────
# Plan 5 of gap-cross-host-evidence-run-incomplete-…: 声明该次运行【预期】产出的 ac 集合，与实际回传的
# 集合求差，缺失项逐条打印。此前「一次只回传 2 种记录」被当作成功（evidence_lines=4）——部分产出与
# 完全成功同形（硬规则 3b 同族）。三个可区分取值：
#   OK (exit 0)          —— expected 全在 present 里（完整）。
#   NOT-EVALUATED (exit 1) —— evidence 缺/空/零行，或 present∩expected 为空（全缺，与「没证据」同判）。
#   PARTIAL (exit 2)     —— 部分缺（present∩expected 非空但 missing 非空），逐条打印缺失 ac。
# 入参 $2 = 空格分隔的预期 ac 列表（如 "GOAL-009-AC-203 GOAL-009-AC-204 …"）。expected 为空 ⇒ 跳过（exit 0）。
check_evidence_completeness() {
  local evidence="$1" expected="$2" result pyrc
  [ -n "${expected}" ] || { echo "OK completeness skipped (no expected ac set declared)"; return 0; }
  if [ ! -f "${evidence}" ] || [ ! -r "${evidence}" ]; then
    echo "NOT-EVALUATED evidence-file-missing-or-unreadable path=${evidence}"
    return 1
  fi
  if [ "$(grep -c '.' "${evidence}" 2>/dev/null || true)" -eq 0 ]; then
    echo "NOT-EVALUATED evidence-file-zero-lines path=${evidence}"
    return 1
  fi
  result="$(python3 - "${evidence}" "${expected}" <<'PY'
import json, sys
evidence, expected = sys.argv[1], sys.argv[2].split()
present = set()
with open(evidence, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        a = r.get("ac", "")
        if a:
            present.add(a)
exp = set(expected)
have = present & exp
if not have:
    print("ALL-MISSING present=%d" % len(present))
    sys.exit(3)
missing = sorted(exp - present)
if missing:
    print("PARTIAL present=%d missing=%d list=%s" % (len(have), len(missing), ",".join(missing)))
    sys.exit(2)
print("COMPLETE present=%d" % len(have))
sys.exit(0)
PY
)"
  pyrc=$?
  echo "develop-deliver: evidence-completeness ${result}"
  case "$pyrc" in
    0) return 0 ;;
    2) return 2 ;;
    *) return 1 ;;
  esac
}

# ── check_e2e_pairing <evidence-file> — (host, project_root) 配对判定 (GOAL-009-AC-240) ───────
# gap-ac240-e2e-closure-same-run-pairing：`expected_acs` 判的是【ac 种类的集合差】——六种齐了就算
# OK，而 AC-203（driver 真活）与 AC-207（driver 产出真实提交）可以来自【互不相交的两批见证】
# （实测 2026-09-11 本仓载体：AC-203 roots={63ee9681,b95bd6f1}、AC-207 roots={a2a5aac0}，交集空）。
# 本函数补上那条缺失的判定：同一 host 上两条记录是否共享同一 project_root。
# 一次远端运行的 evidence 文件就是【同一次运行】的全部记录（远端以显式 --ac89 <该次路径> 收集，
# 回传后整体喂进来）⇒ 在【同一 evidence 文件内】配对即「同一次运行自证」的传输侧同判。
# 三个可区分取值（硬规则 3b：⛔ 不静默按 ok 退出）：
#   OK (exit 0)            —— 至少一个 host 的 AC-203 与 AC-207 共享同一 project_root（打印 E2E-PAIR OK host=…）；
#   PAIR-MISSING (exit 2)  —— 文件可读且有记录，但无一 host 配得上 ⇒ 打印 E2E_PAIR_MISSING=1 + 每个 host
#                             的 AC-203/AC-207 root 集（⛔ 只印「不匹配」等于没说：要有可核的 root 集）；
#   NOT-EVALUATED (exit 1) —— 文件缺/不可读/零行（缺值 ≠ 合格）。
# 判据字段与 AC-240 criterion 逐字一致（has_plugin_dir is False / driver_alive==1 / carrier_records>0；
# task_status=="done" / gate_events>0 / produced_by_driver is True / commit_sha / task_id 非空）——
# ⛔ 本函数不额外放宽也不收紧，它是同一条判据的传输侧实例。
check_e2e_pairing() {
  local evidence="$1" result pyrc
  if [ ! -f "${evidence}" ] || [ ! -r "${evidence}" ]; then
    echo "NOT-EVALUATED evidence-file-missing-or-unreadable path=${evidence}"
    return 1
  fi
  if [ "$(grep -c '.' "${evidence}" 2>/dev/null || true)" -eq 0 ]; then
    echo "NOT-EVALUATED evidence-file-zero-lines path=${evidence}"
    return 1
  fi
  result="$(python3 - "${evidence}" <<'PY'
import json, sys
evidence = sys.argv[1]
a203, a207 = {}, {}
with open(evidence, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        h = str(r.get("host") or "")
        pr = str(r.get("project_root") or "")
        if not h or not pr:
            continue
        try:
            alive = int(r.get("driver_alive") or 0)
            recs = int(r.get("carrier_records") or 0)
            gates = int(r.get("gate_events") or 0)
        except Exception:
            continue
        if (r.get("ac") == "GOAL-009-AC-203" and r.get("has_plugin_dir") is False
                and alive == 1 and recs > 0):
            a203.setdefault(h, set()).add(pr)
        if (r.get("ac") == "GOAL-009-AC-207" and r.get("task_status") == "done"
                and gates > 0 and r.get("produced_by_driver") is True
                and r.get("commit_sha") and r.get("task_id")):
            a207.setdefault(h, set()).add(pr)
hosts = sorted(set(a203) | set(a207))
paired = [h for h in hosts if a203.get(h, set()) & a207.get(h, set())]
if paired:
    print("E2E-PAIR OK host=%s roots=%s" % (",".join(paired),
          ",".join(sorted(set().union(*[a203[h] & a207[h] for h in paired])))))
    sys.exit(0)
# ⛔ 不静默：把两侧的 root 集逐 host 印出来（可核，而不是只说「配不上」）
detail = " ; ".join(
    "host=%s AC203_roots=%s AC207_roots=%s" % (h, sorted(a203.get(h, set())), sorted(a207.get(h, set())))
    for h in hosts) or "no AC-203/AC-207 records at all"
print("PARTIAL E2E_PAIR_MISSING=1 %s" % detail)
sys.exit(2)
PY
)"
  pyrc=$?
  echo "develop-deliver: e2e-pairing ${result}"
  case "$pyrc" in
    0) return 0 ;;
    2) return 2 ;;
    *) return 1 ;;
  esac
}

# ── selfcheck_e2e_pairing — hermetic controls of check_e2e_pairing (AC-240 传输侧, AC3) ────────
# 正控制：同一 host 上 AC-203 与 AC-207 共享同一 project_root ⇒ exit 0（无 PARTIAL 标记、无 E2E_PAIR_MISSING）。
# 负控制①：喂一份【只含 AC-207】的 evidence ⇒ exit 2 且打印 E2E_PAIR_MISSING=1（AC-240 origin 的本来形态）。
# 负控制②：两条都有但 project_root 不同 ⇒ exit 2（判的是【同一 project_root】，⛔ 不是「都有记录」）。
# 未评估：evidence 缺/空 ⇒ exit 1（缺值 ≠ 合格）。
# ⛔ 负控制改的是【判定输入文件】（临时 evidence），⛔ 不往生产载体写记录——本自检不碰 .quay/。
selfcheck_e2e_pairing() {
  local tmp rc=0 out rc_pos rc_neg rc_diff rc_missing
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-e2e-pairing: FAIL — cannot create temp dir" >&2; return 1; }
  local ev_pos="${tmp}/pair-pos.jsonl" ev_neg="${tmp}/pair-neg.jsonl" ev_diff="${tmp}/pair-diff.jsonl" ev_missing="${tmp}/pair-missing.jsonl"
  cat > "${ev_pos}" <<'EVID'
{"ts":"2026-09-11T00:00:00Z","ac":"GOAL-009-AC-203","host":"hostB","project_root":"/home/verify/root-x","has_plugin_dir":false,"driver_alive":1,"carrier_records":3}
{"ts":"2026-09-11T00:00:00Z","ac":"GOAL-009-AC-207","host":"hostB","project_root":"/home/verify/root-x","commit_sha":"1111111111111111111111111111111111111111","commit_files":["e2e-marker.txt"],"task_id":"e2e-verify-207","task_status":"done","gate_events":2,"produced_by_driver":true}
EVID
  cat > "${ev_neg}" <<'EVID'
{"ts":"2026-09-11T00:00:00Z","ac":"GOAL-009-AC-207","host":"hostB","project_root":"/home/verify/root-x","commit_sha":"1111111111111111111111111111111111111111","commit_files":["e2e-marker.txt"],"task_id":"e2e-verify-207","task_status":"done","gate_events":2,"produced_by_driver":true}
EVID
  cat > "${ev_diff}" <<'EVID'
{"ts":"2026-09-11T00:00:00Z","ac":"GOAL-009-AC-203","host":"hostB","project_root":"/home/verify/root-a","has_plugin_dir":false,"driver_alive":1,"carrier_records":3}
{"ts":"2026-09-11T00:00:00Z","ac":"GOAL-009-AC-207","host":"hostB","project_root":"/home/verify/root-b","commit_sha":"1111111111111111111111111111111111111111","commit_files":["e2e-marker.txt"],"task_id":"e2e-verify-207","task_status":"done","gate_events":2,"produced_by_driver":true}
EVID
  : > "${ev_missing}"
  set +e
  out="$(check_e2e_pairing "${ev_pos}" 2>&1)"; rc_pos=$?
  echo "selfcheck-e2e-pairing: positive → rc=${rc_pos} ${out}"
  out="$(check_e2e_pairing "${ev_neg}" 2>&1)"; rc_neg=$?
  echo "selfcheck-e2e-pairing: ac207-only → rc=${rc_neg} ${out}"
  out="$(check_e2e_pairing "${ev_diff}" 2>&1)"; rc_diff=$?
  echo "selfcheck-e2e-pairing: different-roots → rc=${rc_diff} ${out}"
  out="$(check_e2e_pairing "${ev_missing}" 2>&1)"; rc_missing=$?
  echo "selfcheck-e2e-pairing: empty-evidence → rc=${rc_missing} ${out}"
  set -e
  [ "${rc_pos}" = "0" ] || { echo "selfcheck-e2e-pairing: FAIL — paired records must exit 0, got ${rc_pos}" >&2; rc=1; }
  [ "${rc_neg}" = "2" ] || { echo "selfcheck-e2e-pairing: FAIL — AC-207-only must exit 2 (PAIR-MISSING), got ${rc_neg}" >&2; rc=1; }
  [ "${rc_diff}" = "2" ] || { echo "selfcheck-e2e-pairing: FAIL — different roots must exit 2, got ${rc_diff}" >&2; rc=1; }
  [ "${rc_missing}" = "1" ] || { echo "selfcheck-e2e-pairing: FAIL — empty evidence must exit 1 (NOT-EVALUATED), got ${rc_missing}" >&2; rc=1; }
  # 接线控制（AC3：负控制须「该 host 记 PARTIAL」而不只是函数返回 2）——按位置断言 verify_coldstart_mode
  # 函数体里【既调用 check_e2e_pairing，又在它返回 2 时置 partial=1】，且该块受 --ac207-e2e 门控
  # （⛔ 不是无条件跑：非 e2e 模式没有 AC-207 可配，无条件跑会恒报 PARTIAL）。删掉接线此控制即取假。
  local vcm_body vcm_call=0 vcm_partial=0 vcm_gated=0
  vcm_body="$(sed -n '/^verify_coldstart_mode()/,/^}$/p' "$0" 2>/dev/null)"
  case "$vcm_body" in *'check_e2e_pairing "${evidence_local}"'*) vcm_call=1 ;; esac
  case "$vcm_body" in *'pair_rc}" = "2"'*'partial=1'*) vcm_partial=1 ;; esac
  case "$vcm_body" in *'[ "${ac207_e2e}" -eq 1 ]'*'check_e2e_pairing'*) vcm_gated=1 ;; esac
  if [ "${vcm_call}" != "1" ] || [ "${vcm_partial}" != "1" ] || [ "${vcm_gated}" != "1" ]; then rc=1; fi
  echo "selfcheck-e2e-pairing: wiring(in-verify_coldstart_mode) call=${vcm_call} partial=1_on_exit2=${vcm_partial} gated_by_ac207_e2e=${vcm_gated} (expect 1/1/1 — 否则函数返回 2 也没人记 PARTIAL)"
  rm -rf "${tmp}"
  if [ "${rc}" -eq 0 ]; then
    echo "selfcheck-e2e-pairing: PASS (paired ⇒ exit 0; AC-207-only ⇒ exit 2 + E2E_PAIR_MISSING=1; different roots ⇒ exit 2; empty evidence ⇒ exit 1 NOT-EVALUATED; wiring present in verify_coldstart_mode)"
  else
    echo "selfcheck-e2e-pairing: FAIL" >&2
  fi
  return "${rc}"
}

# ── selfcheck_transport_closure — hermetic controls of the shipped-set closure (AC1..AC4 正本) ──
# The whole point of the explicit scp enumeration is that a new $SCRIPT_DIR dependency is an EXPLICIT
# edit. This selfcheck is what makes "explicit" mechanical instead of aspirational.
#   正控制  : the real set (transport_flat_files + transport_node_modules_deps) ⇒ 0 violations.
#   负控制① : drop provider-binding-resolvability-check.ts ⇒ REF-UNSHIPPED (the 2026-09-11 本来形态).
#   负控制② : keep the checker, drop node_modules/yaml ⇒ BARE-UNSHIPPED (the Finding's second half —
#             proves that "只加一行 scp 不够" is mechanically visible, not just asserted).
#   负控制③ : drop gate-script-base.ts ⇒ IMPORT-UNSHIPPED (the general relative-import form).
#   负控制④ : a synthetic shipped file tests the type-erasure boundary — a VALUE ./ import must be
#             flagged, a `import type` one must NOT (flagging it would be a false positive, and a
#             guard that cries wolf gets switched off — runner-state-write.ts is the live case).
#   可读性   : an EMPTY list still yields ≥1 violation — the REFERENCE half is driven by the CONSUMER
#             (verify-deliver-coldstart.sh), not by the list, so an unreadable list cannot masquerade
#             as 合格 (硬规则 3b). The non-empty assertion below is belt-and-braces on top of that.
# Offline: no build/scp/ssh. Reads only this checkout.
selfcheck_transport_closure() {
  local tmp rc=0
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-transport-closure: FAIL — cannot create temp dir" >&2; return 1; }
  { transport_flat_files; transport_node_modules_deps; } > "${tmp}/real.list"

  local n_flat n_dep
  n_flat="$(transport_flat_files | grep -c . || true)"
  n_dep="$(transport_node_modules_deps | grep -c . || true)"
  echo "selfcheck-transport-closure: shipped set = ${n_flat} flat file(s) + ${n_dep} node_modules dep dir(s)"
  # ⛔ 读不懂输入 ⇒ 0 违规（与合格同形）——所以这里先断言清单非空，再谈 0 违规。
  if [ "${n_flat}" -lt 9 ] || [ "${n_dep}" -lt 1 ]; then
    echo "selfcheck-transport-closure: FAIL — the shipped set is unreadable/truncated (${n_flat} flat, ${n_dep} dep); a 0-violation verdict on an empty list is NOT a pass" >&2
    rm -rf "${tmp}"
    return 1
  fi

  # AC4 产物：随行 sibling 的 import 面清单（每个 shipped .ts 实际要解析的模块说明符）。
  local f imp m_face=0 m_self=1
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in *.ts) ;; *) continue ;; esac
    m_face=$((m_face + 1))
    imp="$(transport_imports_of "$f" | tr '\n' ' ')"
    case "${imp}" in *yaml*) m_self=0 ;; esac
    echo "selfcheck-transport-closure: import-face $(basename "$f") -> [${imp% }]"
  done < "${tmp}/real.list"
  if [ "${m_self}" -eq 0 ]; then
    echo "selfcheck-transport-closure: import-face files=${m_face} non-self-sufficient=provider-binding-resolvability-check.ts (bare yaml, shipped under node_modules/)"
  else
    echo "selfcheck-transport-closure: import-face files=${m_face} non-self-sufficient=none"
  fi

  local out rc_real rc_nochecker rc_noyaml rc_nogate rc_empty
  set +e
  out="$(transport_closure_violations "${tmp}/real.list" 2>&1)"; rc_real=$?
  echo "selfcheck-transport-closure: positive → violations=${rc_real} (expect 0)"
  [ -n "${out}" ] && printf '%s\n' "${out}" | sed 's/^/selfcheck-transport-closure:   /'

  grep -v 'provider-binding-resolvability-check\.ts$' "${tmp}/real.list" > "${tmp}/no-checker.list"
  out="$(transport_closure_violations "${tmp}/no-checker.list" 2>&1)"; rc_nochecker=$?
  echo "selfcheck-transport-closure: drop-checker → violations=${rc_nochecker} (expect ≥1, REF-UNSHIPPED)"
  printf '%s\n' "${out}" | sed 's/^/selfcheck-transport-closure:   /'

  grep -v 'node_modules/yaml$' "${tmp}/real.list" > "${tmp}/no-yaml.list"
  out="$(transport_closure_violations "${tmp}/no-yaml.list" 2>&1)"; rc_noyaml=$?
  echo "selfcheck-transport-closure: drop-yaml → violations=${rc_noyaml} (expect ≥1, BARE-UNSHIPPED)"
  printf '%s\n' "${out}" | sed 's/^/selfcheck-transport-closure:   /'

  grep -v 'gate-script-base\.ts$' "${tmp}/real.list" > "${tmp}/no-gate.list"
  out="$(transport_closure_violations "${tmp}/no-gate.list" 2>&1)"; rc_nogate=$?
  echo "selfcheck-transport-closure: drop-gate-script-base → violations=${rc_nogate} (expect ≥1, IMPORT-UNSHIPPED)"
  printf '%s\n' "${out}" | sed 's/^/selfcheck-transport-closure:   /'

  # 负控制④（类型擦除的边界）：一个合成 shipped 文件同时带【值】相对 import（必须报）、【type-only】
  #   相对 import（⛔ 必须不报——--experimental-strip-types 会擦掉它，报它就是假阳性，而假阳性会让
  #   这条守卫被关掉）、一个已随行的裸包和一个 node 内建（都必须不报）。
  local syn_rc=0
  cat > "${tmp}/x.ts" <<'SYN'
import { foo } from "./not-shipped.ts";
import type { Bar } from "./also-not-shipped.ts";
import { parse } from "yaml";
import path from "node:path";
SYN
  cat "${tmp}/real.list" > "${tmp}/synth.list"
  printf '%s\n' "${tmp}/x.ts" >> "${tmp}/synth.list"
  out="$(transport_closure_violations "${tmp}/synth.list" 2>&1)"; syn_rc=$?
  echo "selfcheck-transport-closure: synthetic-type-erasure → violations=${syn_rc} (expect exactly 1: the VALUE relative import)"
  printf '%s\n' "${out}" | sed 's/^/selfcheck-transport-closure:   /'

  : > "${tmp}/empty.list"
  out="$(transport_closure_violations "${tmp}/empty.list" 2>&1)"; rc_empty=$?
  echo "selfcheck-transport-closure: empty-list → violations=${rc_empty} (expect ≥1 — the REFERENCE half is driven by the CONSUMER, not by the list, so an unreadable list cannot masquerade as 合格)"
  printf '%s\n' "${out}" | sed 's/^/selfcheck-transport-closure:   /'
  set -e

  [ "${rc_real}" -eq 0 ] || { echo "selfcheck-transport-closure: FAIL — the REAL shipped set has closure violations" >&2; rc=1; }
  [ "${rc_nochecker}" -ge 1 ] || { echo "selfcheck-transport-closure: FAIL — dropping the checker must be caught (got ${rc_nochecker})" >&2; rc=1; }
  [ "${rc_noyaml}" -ge 1 ] || { echo "selfcheck-transport-closure: FAIL — dropping node_modules/yaml must be caught (got ${rc_noyaml})" >&2; rc=1; }
  [ "${rc_nogate}" -ge 1 ] || { echo "selfcheck-transport-closure: FAIL — dropping a relative-import target must be caught (got ${rc_nogate})" >&2; rc=1; }
  [ "${syn_rc}" -eq 1 ] || { echo "selfcheck-transport-closure: FAIL — the type-erasure boundary must yield EXACTLY 1 violation (value relative import); got ${syn_rc}" >&2; rc=1; }
  [ "${rc_empty}" -ge 1 ] || { echo "selfcheck-transport-closure: FAIL — an unreadable (empty) list must not read as 合格 (got ${rc_empty})" >&2; rc=1; }

  rm -rf "${tmp}"
  if [ "${rc}" -eq 0 ]; then
    echo "selfcheck-transport-closure: PASS (real set ⇒ 0 violations; drop-checker ⇒ REF-UNSHIPPED; drop-yaml ⇒ BARE-UNSHIPPED; drop-gate-script-base ⇒ IMPORT-UNSHIPPED; type-only ./ import NOT flagged, value ./ import flagged 1)"
  else
    echo "selfcheck-transport-closure: FAIL" >&2
  fi
  return "${rc}"
}

# ── selfcheck_evidence [positive|negative|both] — hermetic controls of the transport fn ──────
# AC5 of gap-third-party-evidence-…: ① a fixture evidence file carrying GOAL-009-AC-* lines appends
# into the target carrier and a repeat call appends 0 (idempotent) ② a missing / empty evidence file
# returns a distinguishable NOT-EVALUATED (non-zero) rather than success, and the carrier is unchanged.
selfcheck_evidence() {
  local scenario="${1:-both}" tmp rc=0 carrier ev after n
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-evidence: FAIL — cannot create temp dir" >&2; return 1; }
  if [ "${scenario}" = "positive" ] || [ "${scenario}" = "both" ]; then
    carrier="${tmp}/carrier.jsonl"
    ev="${tmp}/evidence-good.jsonl"
    cat > "${ev}" <<'EVID'
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-206","host":"orangevps","project_root":"/home/verify/quay-verify-coldstart-root","goals_dir_created":true,"tasks_dir_created":true,"goal_store_readable":true,"task_store_readable":true}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/verify/quay-verify-coldstart-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":3}
EVID
    after="$(transport_evidence_append "${carrier}" "${ev}")" || rc=1
    echo "selfcheck-evidence: positive first-append → ${after}"
    printf '%s' "${after}" | grep -q 'appended=2' || rc=1
    after="$(transport_evidence_append "${carrier}" "${ev}")" || rc=1
    echo "selfcheck-evidence: positive repeat-append → ${after}"
    printf '%s' "${after}" | grep -q 'appended=0' || rc=1
    n="$(grep -c '.' "${carrier}" 2>/dev/null || true)"
    [ -n "${n}" ] || n=0
    [ "${n}" = "2" ] || { echo "selfcheck-evidence: carrier lines=${n} (expect 2 — repeat must not duplicate)" >&2; rc=1; }
    [ "${rc}" -eq 0 ] && echo "selfcheck-evidence: positive PASS (2 lines appended; repeat idempotent)"
  fi
  if [ "${scenario}" = "negative" ] || [ "${scenario}" = "both" ]; then
    carrier="${tmp}/carrier-neg.jsonl"
    if transport_evidence_append "${carrier}" "${tmp}/evidence-missing.jsonl"; then
      echo "selfcheck-evidence: negative FAIL — missing evidence returned success" >&2; rc=1
    else
      echo "selfcheck-evidence: negative missing → NOT-EVALUATED (non-zero, as required)"
    fi
    : > "${tmp}/evidence-empty.jsonl"
    if transport_evidence_append "${carrier}" "${tmp}/evidence-empty.jsonl"; then
      echo "selfcheck-evidence: negative FAIL — empty evidence returned success" >&2; rc=1
    else
      echo "selfcheck-evidence: negative empty → NOT-EVALUATED (non-zero, as required)"
    fi
    n="$(grep -c '.' "${carrier}" 2>/dev/null || true)"
    [ -n "${n}" ] || n=0
    echo "selfcheck-evidence: negative carrier lines=${n}"
    [ "${n}" = "0" ] || { echo "selfcheck-evidence: negative FAIL — carrier lines=${n} (expect 0 — carrier unchanged)" >&2; rc=1; }
    [ "${rc}" -eq 0 ] && echo "selfcheck-evidence: negative PASS (missing/empty evidence → NOT-EVALUATED, carrier unchanged)"
  fi
  rm -rf "${tmp}"
  return "${rc}"
}

if [ "${selfcheck}" -eq 1 ]; then
  selfcheck
  exit $?
fi

if [ "${selfcheck_evidence}" -eq 1 ]; then
  selfcheck_evidence "${selfcheck_evidence_scenario}"
  exit $?
fi

# ── selfcheck_evidence_completeness — hermetic controls of check_evidence_completeness (AC7/AC8) ──
# 两个方向：① 「预期 6 种、实际 2 种」⇒ PARTIAL（exit 2）且逐条列出 4 个缺失 ac；② 全产出 ⇒ COMPLETE
# （exit 0）。另含全缺 ⇒ NOT-EVALUATED（exit 1）。offline：temp dir + python3，无 build/scp/ssh。
selfcheck_evidence_completeness() {
  local tmp rc=0 ev partial_out complete_out rc_partial rc_complete rc_allmissing
  local expected="GOAL-009-AC-203 GOAL-009-AC-204 GOAL-009-AC-205 GOAL-009-AC-206 GOAL-009-AC-232 GOAL-015-AC-234"
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-evidence-completeness: FAIL — cannot create temp dir" >&2; return 1; }

  # ① PARTIAL：evidence 只含 2/6 种（AC-204、AC-206）⇒ exit 2 且逐条列出 4 个缺失。
  ev="${tmp}/evidence-partial.jsonl"
  cat > "${ev}" <<'EVID'
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-204","host":"B","project_root":"/tmp/x","forbidden_count":0,"enable_declared":true}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-206","host":"B","project_root":"/tmp/x","goals_dir_created":true,"tasks_dir_created":true,"goal_store_readable":true,"task_store_readable":true}
EVID
  set +e
  partial_out="$(check_evidence_completeness "${ev}" "${expected}" 2>&1)"
  rc_partial=$?
  set -e
  echo "selfcheck-evidence-completeness: partial → rc=${rc_partial} ${partial_out}"
  [ "${rc_partial}" = "2" ] || { echo "selfcheck-evidence-completeness: FAIL — 2/6 预期种应 exit 2 (PARTIAL), got ${rc_partial}" >&2; rc=1; }
  printf '%s' "${partial_out}" | grep -q 'list=' && printf '%s' "${partial_out}" | grep -q 'missing=4' || { echo "selfcheck-evidence-completeness: FAIL — PARTIAL must print missing=4 + list" >&2; rc=1; }

  # ② COMPLETE：evidence 含全 6 种 ⇒ exit 0。
  ev="${tmp}/evidence-complete.jsonl"
  cat > "${ev}" <<'EVID'
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-203","host":"B","project_root":"/tmp/x","has_plugin_dir":false,"driver_alive":1,"carrier_records":3}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-204","host":"B","project_root":"/tmp/x","forbidden_count":0,"enable_declared":true}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-205","host":"B","project_root":"/tmp/x","shipped_from_installed_artifact":true,"transcript_confirmed":true}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-206","host":"B","project_root":"/tmp/x","goals_dir_created":true,"tasks_dir_created":true,"goal_store_readable":true,"task_store_readable":true}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-009-AC-232","host":"B","project_root":"/tmp/x","goal_write_ok":true,"goal_read_back_ok":true,"goal_records":1}
{"ts":"2026-09-10T00:00:00Z","ac":"GOAL-015-AC-234","host":"B","project_root":"/tmp/x","tasks_rendered":1,"goals_rendered":1,"round_records_rendered":1}
EVID
  set +e
  complete_out="$(check_evidence_completeness "${ev}" "${expected}" 2>&1)"
  rc_complete=$?
  set -e
  echo "selfcheck-evidence-completeness: complete → rc=${rc_complete} ${complete_out}"
  [ "${rc_complete}" = "0" ] || { echo "selfcheck-evidence-completeness: FAIL — 全 6 种应 exit 0 (COMPLETE), got ${rc_complete}" >&2; rc=1; }

  # ③ 全缺（evidence 有非空行但无一预期 ac）⇒ NOT-EVALUATED exit 1。
  ev="${tmp}/evidence-allmissing.jsonl"
  printf '%s\n' '{"ts":"2026-09-10T00:00:00Z","ac":"AC88","ok":true}' > "${ev}"
  set +e
  check_evidence_completeness "${ev}" "${expected}" >/dev/null 2>&1
  rc_allmissing=$?
  set -e
  echo "selfcheck-evidence-completeness: all-missing → rc=${rc_allmissing} (expect 1 — NOT-EVALUATED, 与「没证据」同判)"
  [ "${rc_allmissing}" = "1" ] || { echo "selfcheck-evidence-completeness: FAIL — 全缺应 exit 1 (NOT-EVALUATED), got ${rc_allmissing}" >&2; rc=1; }

  rm -rf "${tmp}"
  if [ "${rc}" -eq 0 ]; then
    echo "selfcheck-evidence-completeness: PASS (partial 2/6 → PARTIAL exit 2 + missing=4 list; complete 6/6 → exit 0; all-missing → NOT-EVALUATED exit 1)"
  else
    echo "selfcheck-evidence-completeness: FAIL" >&2
  fi
  return "${rc}"
}

if [ "${selfcheck_evidence_completeness}" -eq 1 ]; then
  selfcheck_evidence_completeness
  exit $?
fi

if [ "${selfcheck_e2e_pairing}" -eq 1 ]; then
  selfcheck_e2e_pairing
  exit $?
fi

if [ "${selfcheck_transport_closure_flag}" -eq 1 ]; then
  selfcheck_transport_closure
  exit $?
fi

# host_key -> (ssh_target, node_path)  — node_path uses $HOME, NOT ~ (tilde does not expand inside
# double quotes in the remote `export PATH="...:..."`); both verified reachable BatchMode 2026-08-11.
declare -A host_target host_node
host_target[B]="orangevps.wan.hwang.men"
host_node[B]="\$HOME/.nvm/versions/node/v22.23.1/bin"
host_target[C]="ad-arm1.wan.hwang.men"
host_node[C]="\$HOME/.local/opt/node-current/bin"

develop_tip="$(git -C "${repo_root}" rev-parse refs/heads/develop 2>/dev/null || echo "")"
if [ -z "${develop_tip}" ]; then
  echo "develop-deliver: ERROR — cannot resolve refs/heads/develop in ${repo_root}" >&2
  exit 1
fi

# ── trigger decision (direct quantities; can be false) ──────────────────────────────────────────────
#   decision = fresh     lastDelivered == develop_tip  (this exact tip already delivered)
#            = too-soon  lastDelivered != tip but age <= --max-age (low-frequency hold, no deliver)
#            = deliver   state.json absent (never delivered), OR (lastDelivered != tip AND age > max-age)
# --force overrides every branch to deliver. The state comes ONLY from .quay/develop-deliver-state.json
# (the deliver's own record) — never from this script's own recent invocations (硬规则 4b).
read_state_field() {
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get(sys.argv[2],''))" "${state_file}" "$1" 2>/dev/null || echo ""
}

decision="deliver"
last_delivered=""
age_seconds=""
if [ "${force}" -eq 1 ]; then
  decision="deliver"
elif [ -f "${state_file}" ]; then
  last_delivered="$(read_state_field lastDelivered)"
  ts="$(read_state_field timestamp)"
  if [ -n "${ts}" ]; then
    age_seconds="$(python3 -c "import sys,datetime; d=datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')); print(max(0,int((datetime.datetime.now(datetime.timezone.utc)-d).total_seconds())))" "${ts}" 2>/dev/null || echo "")"
  fi
  if [ "${last_delivered}" = "${develop_tip}" ]; then
    decision="fresh"
  elif [ -n "${age_seconds}" ] && [ "${age_seconds}" -le "${max_age}" ]; then
    decision="too-soon"
  else
    decision="deliver"
  fi
else
  decision="deliver"   # state.json absent ⇒ never delivered ⇒ deliver
fi

if [ "${check_only}" -eq 1 ]; then
  printf '{"decision":"%s","lastDelivered":"%s","develop":"%s","age_seconds":%s,"max_age":%s}\n' \
    "${decision}" "${last_delivered}" "${develop_tip}" "${age_seconds:-null}" "${max_age}"
  echo "develop-deliver: check decision=${decision} (develop=${develop_tip:0:8}, lastDelivered=${last_delivered:-<none>}, age_seconds=${age_seconds:-null}, max_age=${max_age})"
  exit 0
fi

if [ "${decision}" != "deliver" ]; then
  echo "develop-deliver: skip — decision=${decision} (develop ${develop_tip:0:8}; pass --force to redo)"
  exit 0
fi

echo "develop-deliver: develop tip = ${develop_tip:0:12} (${develop_tip})"

# ── 1. Build the two .tgz from a detached worktree at develop-tip ──────────────────────────────
# Factored so both the deliver mode and the --verify-coldstart mode build the SAME fresh
# hardware-independent artifact at the develop tip (NOT the primary checkout HEAD). Sets the globals
# quay_tgz / qn_tgz and leaves the build worktree in place (the caller removes it).
build_develop_tgz() {
  wt="${worktree_base}-${develop_tip:0:12}"
  if [ -e "${wt}" ]; then
    git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  fi
  echo "develop-deliver: creating detached worktree at develop tip: ${wt}"
  git -C "${repo_root}" worktree add --detach "${wt}" "${develop_tip}" >/dev/null 2>&1
  # symlink the main checkout's node_modules (hoisted, pure-JS deps) so build-dist/esbuild resolve
  ln -s "${repo_root}/node_modules" "${wt}/node_modules" 2>/dev/null || true

  local build_ok=0
  if [ -f "${wt}/packages/quay/scripts/package.sh" ]; then
    echo "develop-deliver: package.sh (quay .tgz)..."
    if (cd "${wt}" && bash packages/quay/scripts/package.sh) >/dev/null 2>&1; then
      quay_tgz="$(ls -1t "${wt}/packages/quay/"quay-*.tgz 2>/dev/null | head -1 || true)"
      echo "  → ${quay_tgz:-MISSING}"
      if [ -n "${quay_tgz}" ] && [ -f "${quay_tgz}" ]; then
        # quay-native: build-dist + npm pack (no package.sh — files array covers dist/)
        if (cd "${wt}/packages/quay-native" && bash scripts/build-dist.sh && npm pack --pack-destination "${wt}/packages/quay-native/") >/dev/null 2>&1; then
          qn_tgz="$(ls -1t "${wt}/packages/quay-native/"quay-native-*.tgz 2>/dev/null | head -1 || true)"
          echo "  → ${qn_tgz:-MISSING}"
          [ -n "${qn_tgz}" ] && [ -f "${qn_tgz}" ] && build_ok=1
        fi
      fi
    fi
  fi

  if [ "${build_ok}" -eq 0 ]; then
    echo "develop-deliver: BUILD FAILED — see worktree ${wt}" >&2
    git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
    return 1
  fi
  return 0
}

# verify_node_export_for <host-key> — the remote line that puts the host's Node ≥20 floor FIRST on
# PATH. ⛔ Neither verify mode used to do this (only the deliver mode did, via `${node_path}`): the
# verify run therefore inherited the ssh NON-INTERACTIVE PATH, where C's `node` is /usr/bin/node
# v18.19.1 — below the engines floor — so `node --experimental-strip-types` dies with `bad option` and
# binding_state() reads "unreadable" for EVERY project there (measured 2026-09-11 with the transport's
# own probe `ssh C bash -s`: PATH carries no nvm/.local entry; `command -v node` → v18.19.1;
# `--experimental-strip-types -e …` → "bad option"; the host node → v24.19.0, works). That is a
# SECOND, independent reason AC-238 could never be recorded on C — same transport surface, same
# symptom word — i.e. fixing the missing checker alone is NOT sufficient (硬规则 5b).
# Single source: BOTH modes emit this line from here.
verify_node_export_for() {
  printf 'export PATH="%s:$PATH"\n' "${host_node[$1]:-\$PATH}"
}

# ── verify_coldstart_mode — cross-host evidence transport (gap-third-party-evidence-no-transport-…) ──
# Plan step 1: scp verify-deliver-coldstart.sh + the two .tgz to each host, run it there with an
# explicit --ac89 <remote tmp path>, scp that evidence file back, and append its lines into the
# local carrier (dedup on (ts,ac,host,project_root)). Plan step 2: a host that yields no evidence
# file (verify failed before writing / scp-back failed) is NOT-EVALUATED and the run exits non-zero
# (硬规则 3b — never a silent exit 0 on "no evidence").
verify_coldstart_mode() {
  local build_date local_carrier fail partial hk target remote_script out remote_rc remote_evidence remote_lines evidence_local ck_rc ac207_extra ac207_path_export pair_rc
  build_date="$(git -C "${repo_root}" log -1 --format=%cI refs/heads/develop 2>/dev/null || echo "")"
  local_carrier="${repo_root}/.quay/productization-verification.jsonl"
  echo "develop-deliver: --verify-coldstart develop=${develop_tip:0:12} build_date=${build_date} carrier=${local_carrier}"
  # Plan 5：该次跨机运行预期产出的 GOAL 记录集合（6 种）——与 scp 回的 evidence 求差，部分缺 ⇒ PARTIAL。
  # ⛔ 不是硬编码的「6」数字：是本次 verify-coldstart 模式【声明要产出】的 ac 种类（AC-204/203/206/232/234
  # 为默认步骤，AC-205 因 --ac205-session 传入而预期；AC-207 仅 --ac207-e2e 时预期，不在此列）。
  expected_acs="GOAL-009-AC-203 GOAL-009-AC-204 GOAL-009-AC-205 GOAL-009-AC-206 GOAL-009-AC-232 GOAL-015-AC-234"
  fail=0
  partial=0
  for hk in ${hosts}; do
    target="${host_target[$hk]:-}"
    if [ -z "${target}" ]; then
      echo "develop-deliver: ${hk} — unknown host key (NOT-EVALUATED)"
      fail=1
      continue
    fi
    echo "develop-deliver: ${hk} (${target}) — scp verify-deliver-coldstart.sh + its FULL closure (\$SCRIPT_DIR siblings + node_modules deps) + SPEC + both .tgz"
    # The closure (sibling set + npm deps) lives in ONE place — transport_flat_files /
    # transport_node_modules_deps — and is PROVEN complete by transport_closure_violations
    # (`--selfcheck-transport-closure`). ⛔ Do not re-inline the list here: two enumerations is
    # exactly how the 2026-09-11 missing-checker defect stayed invisible in both modes.
    if ! ship_verify_closure "${target}" "${quay_tgz}" "${qn_tgz}"; then
      echo "develop-deliver: ${hk} (${target}) — scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    # --ac207-e2e: the target project's worker must actually spawn, which needs (a) the driving repo's
    # .quay/profiles.yml on the remote so resolve_driving_profiles can derive worker-default
    # launcher/model/auth (single source of truth, 硬规则 4c — ⛔ not a second hardcoded copy here), and
    # (b) ~/.local/bin on PATH so the claude-fjdac/claude wrappers resolve (the ssh non-interactive PATH
    # has neither). Built into the remote script below; both are literal-inserted (single-quoted value,
    # so $HOME/$PATH stay literal and expand on the remote, not here).
    ac207_extra=""
    ac207_path_export=""
    if [ "${ac207_e2e}" -eq 1 ]; then
      if ! scp "${ssh_opts[@]}" "${repo_root}/.quay/profiles.yml" "${target}:~/quay-driving-profiles.yml" >/dev/null 2>&1; then
        echo "develop-deliver: ${hk} (${target}) — driving-profiles scp FAILED (NOT-EVALUATED)"
        fail=1
        continue
      fi
      # AC207_POLL_SECS: the e2e task's first worker attempt can fail the fan-in suite cert (non-inert
      # delta) and need a retry, pushing task-done past the verify script's 1800s default poll window
      # (实测 2026-09-11: done@~30min, poll 1800s 过期 ~19s 早 → 记录未写)。3600s 给足双次尝试余量。
      ac207_path_export='export PATH="$HOME/.local/bin:$PATH"; export AC207_POLL_SECS="${AC207_POLL_SECS:-3600}"'
      ac207_extra=' --ac207-e2e --driving-profiles "$HOME/quay-driving-profiles.yml"'
    fi
    remote_script=$(cat <<REMOTE
$(verify_node_export_for "${hk}")
${ac207_path_export}
EV="\${HOME}/quay-verify-coldstart-evidence-${develop_tip:0:8}.jsonl"
rm -f "\${EV}"
bash "\${HOME}/verify-deliver-coldstart.sh" \
  --tgz "\${HOME}/$(basename "${quay_tgz}")" \
  --tgz-native "\${HOME}/$(basename "${qn_tgz}")" \
  --build-sha "${develop_tip}" \
  --build-date "${build_date}" \
  --host "${hk}" \
  --ac89 "\${EV}" \
  --spec "\${HOME}/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md" \
  --prefix "\${HOME}/quay-verify-coldstart-${develop_tip:0:8}.npm" \
  --project "quay-verify-coldstart-${develop_tip:0:8}" \
  --root "\${HOME}/quay-verify-coldstart-${develop_tip:0:8}-root" \
  --worktree-root "\${HOME}/quay-verify-coldstart-${develop_tip:0:8}-worktrees" \
  --ac205-session${ac207_extra}
RC=\$?
echo "VERIFY-RC \${RC}"
if [ -f "\${EV}" ]; then
  echo "EVIDENCE-PATH \${EV}"
  echo "EVIDENCE-LINES \$(wc -l < "\${EV}")"
else
  echo "EVIDENCE-ABSENT \${EV}"
fi
REMOTE
)
    set +e
    out="$(ssh "${ssh_opts[@]}" "${target}" "bash -s" <<< "${remote_script}" 2>&1)"
    remote_rc=$?
    set -e
    # 持久化远端 stdout（Plan 4，优先做）：out 落成本地日志并在结果里打印路径——此前只 grep 三个标记
    # （VERIFY-RC / EVIDENCE-PATH / EVIDENCE-LINES）其余全丢，fail-closed 的步骤（如 AC-232 的 NOTE 行、
    # AC-203 的 driver_alive 打印行）无从诊断。日志名含 <host>-<tip8> 唯一标识该次运行。
    remote_log="${repo_root}/.quay/verify-coldstart-remote-${hk}-${develop_tip:0:8}.log"
    mkdir -p "$(dirname "${remote_log}")"
    printf '%s\n' "${out}" > "${remote_log}"
    echo "develop-deliver: ${hk} (${target}) remote stdout persisted → ${remote_log} (${remote_rc:+rc=${remote_rc}})"
    remote_evidence="$(printf '%s\n' "${out}" | grep -oE 'EVIDENCE-PATH .*' | tail -1 | sed 's/^EVIDENCE-PATH //' || echo "")"
    remote_lines="$(printf '%s\n' "${out}" | grep -oE 'EVIDENCE-LINES [0-9]+' | tail -1 | sed 's/^EVIDENCE-LINES //' || echo "")"
    echo "develop-deliver: ${hk} (${target}) remote verify rc=${remote_rc} evidence_lines=${remote_lines:-<none>}"
    if [ "${remote_rc}" -ne 0 ]; then printf '%s\n' "${out}" | tail -8; fi
    if [ -z "${remote_evidence}" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (remote produced no evidence path)"
      fail=1
      continue
    fi
    evidence_local="${repo_root}/.quay/verify-coldstart-evidence-${hk}-${develop_tip:0:8}.jsonl"
    rm -f "${evidence_local}"
    echo "develop-deliver: ${hk} (${target}) — scp back: scp ${ssh_opts[*]} ${target}:${remote_evidence} ${evidence_local}"
    if ! scp "${ssh_opts[@]}" "${target}:${remote_evidence}" "${evidence_local}" >/dev/null 2>&1; then
      echo "develop-deliver: ${hk} (${target}) — evidence scp-back FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    if ! transport_evidence_append "${local_carrier}" "${evidence_local}"; then
      echo "develop-deliver: ${hk} (${target}) — evidence NOT-EVALUATED (no transport)"
      rm -f "${evidence_local}"
      fail=1
      continue
    fi
    # Plan 5：按 ac 种类核对回传完整性（transport 成功 ≠ 完整——「部分产出与完全成功同形」是硬规则 3b 同族）。
    check_evidence_completeness "${evidence_local}" "${expected_acs}"
    ck_rc=$?
    if [ "${ck_rc}" = "2" ]; then
      echo "develop-deliver: ${hk} (${target}) — PARTIAL (transport OK but some expected records missing)"
      partial=1
    elif [ "${ck_rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (all expected records absent from evidence)"
      fail=1
    fi
    # AC-240（gap-ac240-e2e-closure-same-run-pairing）：种类齐 ≠ 闭环自证——AC-203 与 AC-207 可以来自
    # 互不相交的两批见证（origin 实测正是如此）。--ac207-e2e 时再判一次配对：同一 host 上两条记录是否
    # 共享同一 project_root（一次远端运行 = 一个 evidence 文件 ⇒ 文件内配对即「同一次运行」）。
    # ⛔ 缺配对 ⇒ 该 host 记 PARTIAL + 打印 E2E_PAIR_MISSING=1（可区分取值），⛔ 不静默按 ok 退出（硬规则 3b）。
    if [ "${ac207_e2e}" -eq 1 ]; then
      set +e
      check_e2e_pairing "${evidence_local}"
      pair_rc=$?
      set -e
      if [ "${pair_rc}" = "2" ]; then
        echo "develop-deliver: ${hk} (${target}) — PARTIAL (E2E_PAIR_MISSING=1: AC-203/AC-207 not paired on one project_root — 闭环不由该 host 的这一次运行自证)"
        partial=1
      elif [ "${pair_rc}" != "0" ]; then
        echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (e2e pairing unreadable/empty evidence)"
        fail=1
      fi
    fi
    rm -f "${evidence_local}"
  done
  # clean up the build worktree (both .tgz already scp'd to every host)
  git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  if [ "${partial}" -eq 1 ]; then
    echo "develop-deliver: --verify-coldstart PARTIAL (some hosts transported evidence but are missing expected records — see per-host lines above)" >&2
    exit 2
  fi
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: --verify-coldstart PARTIAL FAILURE (some hosts NOT-EVALUATED — no transport for those hosts)" >&2
    exit 1
  fi
  echo "develop-deliver: --verify-coldstart OK — evidence transported into ${local_carrier}"
  return 0
}

# ── verify_upgrade_mode — GOAL-009-AC-238：既有旧痕迹项目的升级路径取证 ────────────────────────
# 与 verify_coldstart_mode 的区别是本质的：那条跑远端 ② 的「rm -rf $ROOT 后全新 quay-init」
# （GOAL-009 现有 9 条 AC 的证据全部出自该形态的一次性靶子）；本模式把远端脚本切到
# --upgrade-existing，对一个【已经跑过 quay-native、带真实存量数据 + 旧版本 vendored runtime】的
# 真实第三方项目做【隔离副本】升级，只取回 ac=GOAL-009-AC-238 那一条记录。
# ⛔ upgrade_source 是【远端】路径（相对 $HOME），副本在该主机上创建；源目录只被 cp -a 读，从不写。
verify_upgrade_mode() {
  local build_date local_carrier fail hk target remote_script out remote_rc remote_log remote_evidence evidence_local ck_rc
  build_date="$(git -C "${repo_root}" log -1 --format=%cI refs/heads/develop 2>/dev/null || echo "")"
  local_carrier="${repo_root}/.quay/productization-verification.jsonl"
  echo "develop-deliver: --verify-upgrade develop=${develop_tip:0:12} build_date=${build_date} source=\$HOME/${upgrade_source:-<unset>}"
  if [ -z "${upgrade_source}" ]; then
    echo "develop-deliver: --verify-upgrade requires --upgrade-source <path relative to \$HOME on the remote host>" >&2
    return 2
  fi
  fail=0
  for hk in ${hosts}; do
    target="${host_target[$hk]:-}"
    if [ -z "${target}" ]; then
      echo "develop-deliver: ${hk} — unknown host key (NOT-EVALUATED)"
      fail=1
      continue
    fi
    echo "develop-deliver: ${hk} (${target}) — scp verify-deliver-coldstart.sh + its FULL closure (\$SCRIPT_DIR siblings + node_modules deps) + both .tgz"
    # 同 verify_coldstart_mode：闭集只有一处（transport_flat_files / transport_node_modules_deps），
    # ⛔ 不在此处再抄一份——两份枚举正是 2026-09-11 漏件在两个模式下都不可见的成因。
    if ! ship_verify_closure "${target}" "${quay_tgz}" "${qn_tgz}"; then
      echo "develop-deliver: ${hk} (${target}) — scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    remote_script=$(cat <<REMOTE
$(verify_node_export_for "${hk}")
EV="\${HOME}/quay-verify-upgrade-evidence-${develop_tip:0:8}.jsonl"
rm -f "\${EV}"
bash "\${HOME}/verify-deliver-coldstart.sh" \
  --tgz "\${HOME}/$(basename "${quay_tgz}")" \
  --tgz-native "\${HOME}/$(basename "${qn_tgz}")" \
  --build-sha "${develop_tip}" \
  --build-date "${build_date}" \
  --host "${hk}" \
  --ac89 "\${EV}" \
  --evidence "\${HOME}/quay-verify-upgrade-evidence-${develop_tip:0:8}.json" \
  --prefix "\${HOME}/quay-verify-upgrade-${develop_tip:0:8}.npm" \
  --project "quay-verify-upgrade-${develop_tip:0:8}" \
  --root "\${HOME}/quay-verify-upgrade-${develop_tip:0:8}-root" \
  --upgrade-existing \
  --upgrade-source "\${HOME}/${upgrade_source}"
RC=\$?
echo "VERIFY-RC \${RC}"
if [ -f "\${EV}" ]; then
  echo "EVIDENCE-PATH \${EV}"
  echo "EVIDENCE-LINES \$(wc -l < "\${EV}")"
else
  echo "EVIDENCE-ABSENT \${EV}"
fi
REMOTE
)
    set +e
    out="$(ssh "${ssh_opts[@]}" "${target}" "bash -s" <<< "${remote_script}" 2>&1)"
    remote_rc=$?
    set -e
    remote_log="${repo_root}/.quay/verify-upgrade-remote-${hk}-${develop_tip:0:8}.log"
    mkdir -p "$(dirname "${remote_log}")"
    printf '%s\n' "${out}" > "${remote_log}"
    echo "develop-deliver: ${hk} (${target}) remote stdout persisted → ${remote_log} (rc=${remote_rc})"
    remote_evidence="$(printf '%s\n' "${out}" | grep -oE 'EVIDENCE-PATH .*' | tail -1 | sed 's/^EVIDENCE-PATH //' || echo "")"
    if [ -z "${remote_evidence}" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (remote produced no evidence path)"
      printf '%s\n' "${out}" | tail -12
      fail=1
      continue
    fi
    evidence_local="${repo_root}/.quay/verify-upgrade-evidence-${hk}-${develop_tip:0:8}.jsonl"
    rm -f "${evidence_local}"
    if ! scp "${ssh_opts[@]}" "${target}:${remote_evidence}" "${evidence_local}" >/dev/null 2>&1; then
      echo "develop-deliver: ${hk} (${target}) — evidence scp-back FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    if ! transport_evidence_append "${local_carrier}" "${evidence_local}"; then
      echo "develop-deliver: ${hk} (${target}) — evidence NOT-EVALUATED (no transport)"
      rm -f "${evidence_local}"
      fail=1
      continue
    fi
    # 传输成功 ≠ 产出完整：按 ac 种类核对取回的内容里确有 AC-238 那一条（硬规则 3b 同族）。
    check_evidence_completeness "${evidence_local}" "GOAL-009-AC-238"
    ck_rc=$?
    if [ "${ck_rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (ac=GOAL-009-AC-238 absent from transported evidence)"
      fail=1
    else
      echo "develop-deliver: ${hk} (${target}) — ac=GOAL-009-AC-238 transported into ${local_carrier} ✓"
    fi
    rm -f "${evidence_local}"
  done
  git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: --verify-upgrade FAILED (a host produced no AC-238 record — see per-host lines above)" >&2
    return 1
  fi
  echo "develop-deliver: --verify-upgrade OK — GOAL-009-AC-238 record transported into ${local_carrier}"
  return 0
}

if [ "${verify_upgrade}" -eq 1 ]; then
  if ! build_develop_tgz; then
    exit 1
  fi
  verify_upgrade_mode
  exit $?
fi

if [ "${verify_coldstart}" -eq 1 ]; then
  if ! build_develop_tgz; then
    exit 1
  fi
  verify_coldstart_mode
  exit $?
fi

# ── Deliver mode: build + install + verify the served surface ──────────────────────────────
if ! build_develop_tgz; then
  exit 1
fi

# ── 2+3+4. Deliver + install + verify per host ─────────────────────────────────────────────────
# The loop must NOT abort on a single host's failure: each host records its own http + usage_verify
# signal (distinct failure values), and the run only fails at the END after every host is attempted.
declare -A http_codes usage_verify
deliver_fail=0
for hk in ${hosts}; do
  target="${host_target[$hk]:-}"
  node_path="${host_node[$hk]:-}"
  if [ -z "${target}" ]; then
    echo "develop-deliver: ${hk} — unknown host key (not-evaluated)"
    http_codes[$hk]="not-evaluated"
    usage_verify[$hk]="not-run"
    deliver_fail=1
    continue
  fi
  # scp both tgz
  if ! scp "${ssh_opts[@]}" "${quay_tgz}" "${qn_tgz}" "${target}:~/" >/dev/null 2>&1; then
    echo "develop-deliver: ${hk} (${target}) — scp FAILED (not-evaluated)"
    http_codes[$hk]="not-evaluated"
    usage_verify[$hk]="not-run"
    deliver_fail=1
    continue
  fi
  remote_script=$(cat <<REMOTE
set -euo pipefail
$(declare -f verify_http_surface)
export PATH="${node_path}:\$PATH"   # host's Node ≥20 (default PATH is v18.19.1 < engines floor)
npm install -g --no-audit --no-fund "\${HOME}/$(basename "${quay_tgz}")" "\${HOME}/$(basename "${qn_tgz}")" >/dev/null 2>&1
quay --help >/dev/null 2>&1 || { echo "INSTALL-CHECK-FAIL"; exit 1; }
WS="\${HOME}/quay-deliver-ws"
rm -rf "\$WS"; mkdir -p "\$WS/.quay" "\$WS/tasks"
cat > "\$WS/.quay/config.yml" <<'CFG'
providers:
  native:
    enabled: true
    path: "."
    tasks_dir: "./tasks"
    mcp_entry: ["quay-native", "mcp"]
    env:
      QUAY_NATIVE_TASKS_DIR: "./tasks"
CFG
cd "\$WS"
quay serve --port ${verify_port} >/dev/null 2>&1 &
SERVE_PID=\$!
sleep 3
# verify the served surface (follow the / redirect, assert final 200 + dashboard content). The
# verdict is EMITTED (not swallowed) so the local side can print the actual code + reason.
http_verdict="\$(verify_http_surface "http://localhost:${verify_port}" 2>/dev/null || echo "FAIL reason=verify-criterion-unhandled code=000")"
kill \$SERVE_PID 2>/dev/null || true
wait \$SERVE_PID 2>/dev/null || true
echo "HTTP-VERDICT \${http_verdict}"
# AC92 (tasks/gap-ac92-delivery-verify-usage-intersection): the delivery verification surface must
# INTERSECT the actual usage surface. Kept a SEPARATE signal from http — a usage-verify fail must
# not mask an http pass, nor vice versa (recorded independently by the local side).
UV_SCRIPTS="\$(npm root -g)/quay/plugin/scripts"
if [ -f "\${UV_SCRIPTS}/deliver-verify-usage.sh" ]; then
  if bash "\${UV_SCRIPTS}/deliver-verify-usage.sh" --plugin-scripts "\${UV_SCRIPTS}" --ws "\$WS" --timeout 30 >"\${WS}/deliver-verify-usage.out" 2>&1; then
    echo "USAGE-VERIFY-OK"
  else
    echo "USAGE-VERIFY-FAIL"
    tail -25 "\${WS}/deliver-verify-usage.out" >&2
  fi
else
  # Older installed artifact without the AC92 verification script — report as a skip, not a pass.
  echo "USAGE-VERIFY-SKIP (deliver-verify-usage.sh not in installed package)"
fi
REMOTE
)
  # Capture the remote output WITHOUT `set -e` aborting the whole multi-host loop on the remote's
  # non-zero exit (a verify/install failure is a per-host result, not a reason to skip the rest).
  set +e
  out="$(ssh "${ssh_opts[@]}" "${target}" "bash -s" <<< "${remote_script}" 2>&1)"
  remote_rc=$?
  set -e
  http_verdict="$(printf '%s\n' "${out}" | grep -oE 'HTTP-VERDICT .*' | tail -1 | sed 's/^HTTP-VERDICT //' || echo "")"
  uv_ok="$(printf '%s\n' "${out}" | grep -c 'USAGE-VERIFY-OK' || true)"
  uv_skip="$(printf '%s\n' "${out}" | grep -c 'USAGE-VERIFY-SKIP' || true)"

  # http verdict → final code + pass/fail (the verdict line already carries `final_code=<n>`).
  http_ok=0; http_code=""
  case "${http_verdict}" in
    OK\ *) http_ok=1; http_code="$(printf '%s' "${http_verdict}" | grep -oE 'final_code=[0-9]+' | head -1 | cut -d= -f2)"; ;;
  esac

  # usage-verify state (separate from http): ok / skip / fail / not-run.
  if [ "${uv_ok}" -ge 1 ]; then
    usage_verify[$hk]="ok"
  elif [ "${uv_skip}" -ge 1 ]; then
    usage_verify[$hk]="skip"
  elif [ "${http_ok}" -eq 0 ]; then
    usage_verify[$hk]="not-run"   # serve failed ⇒ the remote aborted before usage-verify
  else
    usage_verify[$hk]="fail"
  fi

  if [ "${http_ok}" -eq 1 ]; then
    echo "develop-deliver: ${hk} (${target}) OK — final_code=${http_code} (follow redirects) + usage-verify=${usage_verify[$hk]}"
    http_codes[$hk]="${http_code}"
  else
    echo "develop-deliver: ${hk} (${target}) VERIFY FAILED — ${http_verdict:-remote-error-no-verdict}"
    if [ -z "${http_verdict}" ]; then
      # remote crashed before emitting a verdict (install/init failure) — surface its stderr.
      printf '%s\n' "${out}" | tail -12
    fi
    http_codes[$hk]="verify-fail"
    deliver_fail=1
  fi
done

# ── 5. Record state + cleanup ──────────────────────────────────────────────────────────────────
state_json="$(build_state_json http_codes usage_verify "${develop_tip}")"
mkdir -p "$(dirname "${state_file}")"
printf '%s\n' "${state_json}" > "${state_file}"
echo "develop-deliver: state written → ${state_file}"

# clean up the build worktree (keep the .tgz copies? no — scp'd already; remove worktree)
git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"

if [ "${deliver_fail}" -eq 1 ]; then
  echo "develop-deliver: PARTIAL FAILURE (some hosts failed) — state recorded; outer tick may retry" >&2
  exit 1
fi
echo "develop-deliver: OK — fresh quay ${quay_tgz##*/} delivered + verified on all hosts"
