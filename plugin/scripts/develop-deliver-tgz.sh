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
#     --ac239-e2e     (with --verify-upgrade) additionally run the GOAL-009-AC-239 step on each host:
#                  after the upgrade has been judged successful ON THAT ROOT, a NEW real defect-fix task
#                  is created in the upgraded copy and driven to done by THAT PROJECT'S OWN drivers, then
#                  an ac=GOAL-009-AC-239 record is written on the SAME project_root as its AC-238 record.
#                  Same two prerequisites as --ac207-e2e (driving .quay/profiles.yml on the remote +
#                  ~/.local/bin on PATH) since a real worker must spawn.
#                  The per-host check then judges SAME-SOURCE (check_upgrade_pairing): an AC-239 record
#                  whose project_root is not one that AC-238 proved upgraded does NOT count — a brand-new
#                  project running the same e2e would produce a field-complete AC-239 otherwise. Such a
#                  host is PARTIAL with UPGRADE_PAIR_MISSING=1, never a silent ok.
#     --selfcheck-upgrade-pairing  hermetic controls of check_upgrade_pairing (offline, no build/scp/ssh):
#                  AC-238+AC-239 on one root ⇒ exit 0; AC-239-only ⇒ exit 2 + UPGRADE_PAIR_MISSING=1;
#                  different project_roots ⇒ exit 2; produced_by_driver=false ⇒ exit 2; empty evidence ⇒
#                  exit 1 (NOT-EVALUATED).
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
#     --verify-takeover --takeover-root <abs-path-on-remote>   GOAL-016-AC-247: the SAME transport,
#                  but the remote script runs --ac247-takeover against a ≥14-day-STALLED legacy quay
#                  project that ALREADY carries real backlog + old history (⛔ not a fresh quay-init
#                  target). Only the ac=GOAL-016-AC-247 record is transported + dedup-appended; a host
#                  that produces no such record ⇒ NOT-EVALUATED + exit 1. ⛔ --takeover-root must be an
#                  ABSOLUTE path on the remote host; ⛔ this mode never CREATES the project (the
#                  criterion's own stale_days≥14 / pre_task_count>0 are the "not freshly built" guards).
#     --selfcheck-takeover-transport  hermetic controls of that transport (offline, no build/scp/ssh):
#                  AC-247 evidence ⇒ appended + COMPLETE (exit 0); evidence carrying only a DIFFERENT
#                  ac ⇒ NOT-EVALUATED (transport success ≠ production success); missing/zero-line
#                  evidence ⇒ NOT-EVALUATED + carrier unchanged; plus a positional control that both
#                  the transport and the completeness call sit inside verify_takeover_mode's body.
#     --verify-adr-flip --target-root <abs-path-on-remote> --task-id <id>   GOAL-016-AC-248: the SAME
#                  transport, but the remote script runs --ac248-adr-flip against a project that quay
#                  ITSELF drove (a task in that project went to done through its own drivers). Only the
#                  ac=GOAL-016-AC-248 record is transported + dedup-appended; a host that produces no
#                  such record ⇒ NOT-EVALUATED + exit 1. ⛔ --target-root must be ABSOLUTE on the remote
#                  (a relative path silently resolves against the remote $HOME ⇒ a DIFFERENT project).
#                  ⛔ --task-id is required (guessing "the newest task" is exactly the AC-207 defect).
#                  ⛔ this mode never DRIVES anything: the evidenced fix was driven out by that project's
#                  own drivers; this mode only reads its product.
#     --selfcheck-adrflip-transport  hermetic controls of that transport (offline, no build/scp/ssh):
#                  AC-248 evidence ⇒ appended + COMPLETE (exit 0); evidence carrying only a DIFFERENT
#                  ac ⇒ NOT-EVALUATED; missing/zero-line evidence ⇒ NOT-EVALUATED + carrier unchanged;
#                  a JSON-BOOL SHAPE control (the two adr_check_*_detects fields must satisfy the
#                  criterion's `is False` / `is True`; `0`/`1` and `"false"`/`"true"` impostors must
#                  BOTH fail); plus a positional control that both the transport and the completeness
#                  call sit inside verify_adr_flip_mode's body.
#     --verify-complete-change --target-root <abs-path-on-remote> --task-id <id>   GOAL-016-AC-249: the
#                  SAME transport again, but the remote script runs --ac249-complete-change: the
#                  evidenced task's `commit_files` (the UNION of every commit filed under that one
#                  task_id, attributed BY POSITION — ⛔ never "the newest commit") must carry BOTH a
#                  code path (`src/`|`scripts/`) AND an ADR-007 doc path (contains `ADR-007`|`docs/adr`).
#                  One side alone is not a complete change ⇒ the remote writes NO record. Only the
#                  ac=GOAL-016-AC-249 record is transported + dedup-appended; a host that produces no
#                  such record ⇒ NOT-EVALUATED + exit 1. Same ⛔ rules as --verify-adr-flip:
#                  --target-root ABSOLUTE on the remote; --task-id required (guessing "the newest task"
#                  is exactly the AC-207 defect); this mode never DRIVES anything.
#                  ⚠️ AC-248 and AC-249 share --target-root/--task-id: both are readings of the SAME
#                  driven-out task (one drive, two independent readings). Running this mode against the
#                  same task that --verify-adr-flip already evidenced = "同一次驱动产出", ⛔ not a second
#                  task filed "for AC-249 to see".
#     --selfcheck-complete-change-transport  hermetic controls of that transport (offline, no
#                  build/scp/ssh): AC-249 evidence ⇒ appended + COMPLETE (exit 0); evidence carrying
#                  only a DIFFERENT ac ⇒ NOT-EVALUATED; missing/zero-line evidence ⇒ NOT-EVALUATED +
#                  carrier unchanged; a COMMIT_FILES-PREDICATE control (a code-only list and a doc-only
#                  list must BOTH fail the criterion's two-path predicate — read with the same python
#                  predicate as the goal criterion, so `one side alone does not count` is falsifiable);
#                  plus a positional control that both the transport and the completeness call sit
#                  inside verify_complete_change_mode's body.
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
ac239_e2e=0       # 1 = with --verify-upgrade: ALSO drive a NEW real defect-fix task to done in the upgraded copy (GOAL-009-AC-239)
verify_takeover=0 # 1 = GOAL-016-AC-247: take over a ≥14-day-STALLED legacy project ON the host and transport only its AC-247 record
takeover_root=""  # --takeover-root: ABSOLUTE path (on the remote host) of the stalled project to take over
verify_adr_flip=0 # 1 = GOAL-016-AC-248: read the target project's OWN adr-checker flip on the host and transport only its AC-248 record
adr_flip_root=""  # --target-root: ABSOLUTE path (on the remote host) of the quay-driven project being evidenced
verify_ac257=0    # 1 = GOAL-018-AC-257: project-scope install + quay-init merge-semantics rerun + a real driven todo→done, ON the host; transport only its AC-257 record
ac257_root=""     # --target-root (shared with AC-248/249, recorded separately): the REAL project the AC-257 record names
build_ref=""      # --build-ref: build the deliverable from THIS ref instead of refs/heads/develop (see the note at the tip resolution)
ac257_task=""     # --ac257-task-id: the REAL defect-fix task in the target project that this run drives to done
ac257_task_body="" # --ac257-task-body: LOCAL path to that task's body file (shipped to the host, ⛔ not hand-typed there)
ac257_plugin_root="" # --ac257-plugin-root: ABSOLUTE path (on the remote host) of the PERSISTENT plugin delivery (…/quay/plugin) the target is bound to
verify_ac258=0    # 1 = GOAL-018-AC-258: user-scope delete-key re-registration + quay-init rerun + a real driven todo→done, ON the host; transport only its AC-258 record
ac258_root=""     # --target-root (shared with AC-257/248/249, recorded separately): the REAL project the AC-258 record names
ac258_task=""     # --ac258-task-id: the REAL task in the target project that this run drives to done
ac258_task_body="" # --ac258-task-body: LOCAL path to that task's body file (shipped to the host, ⛔ not hand-typed there)
ac258_poll_secs="" # --ac258-poll-secs: how long the remote step may poll for the task to reach done (⛔ the verify script's default is 3600s; a real driven todo→done needs its own budget)
# AC-258 前置探测的【谓词】。⛔ 与 verify-deliver-coldstart.sh 的 AC258_WORKER_PROBE_PREDICATE 必须
# 逐字相同 —— 两处由 plugin/test/develop-deliver-tgz-evidence-transport.test.mjs 机械互校（不一致即红），
# 所以它是【一处真源 + 一个检查】，而不是两处各自漂移的副本。
# 为什么本文件也要一份：这台机器上的探测发生在 build 之前（一台起不了 worker 的目标机不该花一次
# develop-tip 构建），而那一刻 verify-deliver-coldstart.sh 还没被 ship 过去 —— 用不了它的函数。
ac258_probe_predicate='claude -p "say ok"'
adr_flip_task=""  # --task-id: the task IN THAT PROJECT whose driven-out fix the record is about
verify_complete_change=0 # 1 = GOAL-016-AC-249: read the SAME task's commit_files UNION (code side AND ADR-007 doc side) and transport only its AC-249 record
selfcheck_evidence=0
selfcheck_evidence_scenario="both"
selfcheck_evidence_completeness=0
selfcheck_e2e_pairing=0   # 1 = hermetic controls of check_e2e_pairing (AC-240 传输侧配对判定)
selfcheck_upgrade_pairing=0  # 1 = hermetic controls of check_upgrade_pairing (AC-239 传输侧同源判定)
selfcheck_transport_closure_flag=0  # 1 = hermetic closure controls of the shipped set (AC1..AC4)
selfcheck_worker_preflight_flag=0   # 1 = hermetic controls of the AC-258 worker-usability preflight (five verdicts + every-host enumeration)
selfcheck_takeover_transport_flag=0 # 1 = hermetic controls of the AC-247 transport (GOAL-016)
selfcheck_adrflip_transport_flag=0  # 1 = hermetic controls of the AC-248 transport (GOAL-016)
selfcheck_complete_change_transport_flag=0 # 1 = hermetic controls of the AC-249 transport (GOAL-016)
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
    --ac239-e2e) ac239_e2e=1; shift ;;
    --verify-takeover) verify_takeover=1; shift ;;
    --takeover-root) takeover_root="$2"; shift 2 ;;
    --verify-adr-flip) verify_adr_flip=1; shift ;;
    # --target-root / --task-id 由 AC-248 与 AC-249 两条 verify 模式【共用】（同一条被驱动任务的两条读数）。
    # AC-257 与 AC-248/249 量的是【两个不同的项目】（前者是被 project-scope 取证的真实本体，后者是
    # 被驱动出修复的那个副本）⇒ 同一个 --target-root 旗标各自记录到各自的名字，⛔ 不互相覆盖语义。
    --target-root) adr_flip_root="$2"; ac257_root="$2"; ac258_root="$2"; shift 2 ;;
    --task-id) adr_flip_task="$2"; shift 2 ;;
    --build-ref) build_ref="$2"; shift 2 ;;
    --verify-ac257) verify_ac257=1; shift ;;
    --ac257-task-id) ac257_task="$2"; shift 2 ;;
    --ac257-task-body) ac257_task_body="$2"; shift 2 ;;
    --ac257-plugin-root) ac257_plugin_root="$2"; shift 2 ;;
    --verify-ac258) verify_ac258=1; shift ;;
    --ac258-task-id) ac258_task="$2"; shift 2 ;;
    --ac258-task-body) ac258_task_body="$2"; shift 2 ;;
    --ac258-poll-secs) ac258_poll_secs="$2"; shift 2 ;;
    --verify-complete-change) verify_complete_change=1; shift ;;
    --selfcheck-evidence)
      selfcheck_evidence=1
      case "${2:-}" in positive|negative|both) selfcheck_evidence_scenario="$2"; shift 2 ;; *) shift ;; esac
      ;;
    --selfcheck-evidence-completeness) selfcheck_evidence_completeness=1; shift ;;
    --selfcheck-e2e-pairing) selfcheck_e2e_pairing=1; shift ;;
    --selfcheck-upgrade-pairing) selfcheck_upgrade_pairing=1; shift ;;
    --selfcheck-transport-closure) selfcheck_transport_closure_flag=1; shift ;;
    --selfcheck-takeover-transport) selfcheck_takeover_transport_flag=1; shift ;;
    --selfcheck-adrflip-transport) selfcheck_adrflip_transport_flag=1; shift ;;
    --selfcheck-complete-change-transport) selfcheck_complete_change_transport_flag=1; shift ;;
    --selfcheck-worker-preflight) selfcheck_worker_preflight_flag=1; shift ;;
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
# Append the non-empty JSON lines of <evidence-file> into <local-carrier>, deduped on the RECORD'S
# OWN content (its full field set) so re-transporting the SAME evidence file is idempotent
# (Plan step 3: repeated transport must not inflate a single record into many — AC-214 freshness).
#
# ⛔ 身份取【记录的全部字段】，⛔ 不是一个人为挑出来的键元组 (ts, ac, host, project_root)。
# 2026-09-13 实测（gap-ac203-two-distinct-kinds-no-production-run）：那个键元组**漏掉 `kind`** ⇒
# 同一次远端运行里 ts/ac/host/project_root 完全相同、【仅 kind 不同】的两条 AC-203 记录签名相同 ⇒
# 第二条被静默丢弃（远端 evidence 文件里两条都在，落到驱动方载体只剩一条）。下游后果是判据级的：
# AC-203 要求「合格记录覆盖 ≥2 个不同的 driver kind」，而**运输层**把第二个 kind 吃掉了 ⇒ 产出侧
# 再怎么补齐、判据再怎么写，载体里也永远只有一种 kind（硬规则 3b 的「读不懂/丢掉 ⇒ 与合格同形」）。
# 按全字段取身份 ⇒ 判据将来再加任何区分维度都自动进入身份，**不需要维护第二份「哪些字段算身份」的
# 清单**——那份清单正是本缺陷的形态（判据加了 kind，运输层的键没跟上，硬规则 5b「缺陷是成簇的」）。
# 幂等性不受影响：同一文件重运 ⇒ 每行逐字段相同 ⇒ 签名相同 ⇒ 仍 appended=0。
# 实证的其它适用点（硬规则 5b 要求的 grep 读数，2026-09-13 在 B 机 10 个 evidence 文件上跑）：
# 仅 1 个文件出现同键碰撞，且 differing_fields 恰为 ['kind']；其余 9 个文件 0 碰撞 ⇒ 今天只有这一处。


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
    # 记录身份 = 全部字段（见上方注释：键元组漏 kind 会把第二条 AC-203 记录静默吃掉）。
    return json.dumps(r, sort_keys=True)
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
  # ⚠️ 为什么用 if-形而不是裸赋值：赋值的退出码来自命令替换里的 python，而 python 在 PARTIAL/
  #    ALL-MISSING 时【故意】非 0 ⇒ 本脚本是 `set -euo pipefail`，裸赋值会让脚本在这一行【静默中止】：
  #    下面那行 `develop-deliver: evidence-completeness …` 与本函数返回的可区分取值都不会出现
  #    （实测 2026-09-12：`--verify-adr-flip` 的负路径只打印到 transport 那一行为止）。⇒ 这不是
  #    「非 0 就够」的场合：本条要求的是【可区分的 NOT-EVALUATED】，静默中止把「判为缺」与「脚本炸了」
  #    又合成同一个形态（硬规则 3b）。
  # ⛔ 也【不】在函数体内 set +e / set -e：试过，它会把调用方的 errexit 提前恢复，于是「函数返回非 0」
  #    在调用方那一行就把调用方杀掉（实测：--selfcheck-evidence-completeness 停在第三条用例）。
  #    if-形不动 errexit 状态，两个方向都安全。
  if result="$(python3 - "${evidence}" "${expected}" <<'PY'
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
)"; then
    pyrc=0
  else
    pyrc=$?
  fi
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

# ── check_upgrade_pairing <evidence-file> — (host, project_root) 立项判定 (GOAL-009-AC-239) ────
# AC-239 的判据里有一层 AC-238 做不到的事：AC-239 记录必须与 AC-238 的通过记录落在【同一个
# project_root】上——「升级成功了」与「升级之后还能接着干」必须是同一个现场。少了这层，一个全新项目
# 跑一遍 e2e 就能冒充「升级后」，而判据根本看不出来（那正是 criterion 注释里点名的绕过形态）。
# 本函数是那条判据的【传输侧同判】：把远端回传的整份 evidence（= 同一次运行的全部记录）读一遍，
# 看是否有 host 上同时存在【合格】的 AC-238 与 AC-239 且共享同一 project_root。
# ⛔ 不额外放宽也不收紧——两个断言与 goals/AC-239-*.md 的 criterion 逐字同源（⛔ 不重复实现第二套
#    「合格」定义：判据只有一处，这里是它的传输侧实例）。
# 三个可区分取值（硬规则 3b：⛔ 不静默按 ok 退出）：
#   OK (exit 0)            —— 至少一个 host 的合格 AC-238 与合格 AC-239 共享同一 project_root；
#   PAIR-MISSING (exit 2)  —— 文件可读且有记录，但无一 host 配得上（⛔ 逐 host 印两侧 root 集，可核）；
#   NOT-EVALUATED (exit 1) —— 文件缺/不可读/零行（缺值 ≠ 合格）。
check_upgrade_pairing() {
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
a238, a239 = {}, {}
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
        # AC-238 合格 = 与 criterion 逐字同源的四件读数（存量不减 / 旧 runtime 有年龄 / 被换掉 / CLI 读得出）
        if (r.get("ac") == "GOAL-009-AC-238"
                and isinstance(r.get("pre_upgrade_task_count"), int) and r.get("pre_upgrade_task_count") > 0
                and r.get("post_upgrade_task_count") == r.get("pre_upgrade_task_count")
                and isinstance(r.get("pre_upgrade_runtime_age_days"), (int, float))
                and r.get("pre_upgrade_runtime_age_days") >= 1
                and r.get("runtime_replaced") is True
                and r.get("task_list_ok") is True
                and r.get("build_sha")):
            a238.setdefault(h, set()).add(pr)
        # AC-239 合格 = 端到端四件（commit_sha/task_id 非空 ∧ done ∧ gate>0 ∧ 出自 driver）
        try:
            gates = int(r.get("gate_events") or 0)
        except Exception:
            continue
        if (r.get("ac") == "GOAL-009-AC-239" and r.get("task_status") == "done"
                and gates > 0 and r.get("produced_by_driver") is True
                and r.get("commit_sha") and r.get("task_id")):
            a239.setdefault(h, set()).add(pr)
hosts = sorted(set(a238) | set(a239))
paired = [h for h in hosts if a238.get(h, set()) & a239.get(h, set())]
if paired:
    print("UPGRADE-PAIR OK host=%s roots=%s" % (",".join(paired),
          ",".join(sorted(set().union(*[a238[h] & a239[h] for h in paired])))))
    sys.exit(0)
# ⛔ 不静默：把两侧的 root 集逐 host 印出来（可核，而不是只说「配不上」）
detail = " ; ".join(
    "host=%s AC238_roots=%s AC239_roots=%s" % (h, sorted(a238.get(h, set())), sorted(a239.get(h, set())))
    for h in hosts) or "no AC-238/AC-239 records at all"
print("PARTIAL UPGRADE_PAIR_MISSING=1 %s" % detail)
sys.exit(2)
PY
)"
  pyrc=$?
  echo "develop-deliver: upgrade-pairing ${result}"
  case "$pyrc" in
    0) return 0 ;;
    2) return 2 ;;
    *) return 1 ;;
  esac
}

# ── selfcheck_upgrade_pairing — hermetic controls of check_upgrade_pairing (AC-239 传输侧) ─────
# 正控制：同一 host 上 AC-238 与 AC-239 共享同一 project_root ⇒ exit 0。
# 负控制①：只有 AC-239（没有同 root 的 AC-238）⇒ exit 2 + UPGRADE_PAIR_MISSING=1
#           —— 这正是「另起一个全新项目冒充升级后」在传输侧的形状。判据若只看 AC-239 的四件读数，
#           这一份【会通过】；它必须 here 被挡住。
# 负控制②：AC-238 与 AC-239 的 project_root 不同 ⇒ exit 2（判的是【同一 root】，⛔ 不是「都有记录」）。
# 负控制③：AC-239 记录存在但任务不是 driver 产出的（produced_by_driver=false）⇒ exit 2（不放宽字段）。
# 未评估：evidence 缺/空 ⇒ exit 1（缺值 ≠ 合格）。
# ⛔ 负控制改的是【判定输入文件】（临时 evidence），⛔ 不往生产载体写记录——本自检不碰 .quay/。
selfcheck_upgrade_pairing() {
  local tmp rc=0 out rc_pos rc_neg_a238 rc_neg_root rc_neg_drv rc_missing
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-upgrade-pairing: FAIL — cannot create temp dir" >&2; return 1; }
  local ev_pos="${tmp}/up-pos.jsonl" ev_neg_a238="${tmp}/up-neg-a238.jsonl" \
        ev_neg_root="${tmp}/up-neg-root.jsonl" ev_neg_drv="${tmp}/up-neg-drv.jsonl" \
        ev_missing="${tmp}/up-missing.jsonl"
  local a238='{"ts":"2026-09-11T00:00:00Z","ac":"GOAL-009-AC-238","host":"hostB","project_root":"/home/verify/up-root","pre_upgrade_task_count":102,"post_upgrade_task_count":102,"pre_upgrade_runtime_age_days":21.2,"runtime_replaced":true,"task_list_ok":true,"build_sha":"2222222222222222222222222222222222222222"}'
  local a239='{"ts":"2026-09-11T00:00:00Z","ac":"GOAL-009-AC-239","host":"hostB","project_root":"/home/verify/up-root","commit_sha":"1111111111111111111111111111111111111111","commit_files":["internal/mcp/query/query.go"],"task_id":"ac239-subagent-session-id-scan","task_status":"done","gate_events":1,"produced_by_driver":true}'
  printf '%s\n%s\n' "${a238}" "${a239}" > "${ev_pos}"
  printf '%s\n' "${a239}" > "${ev_neg_a238}"
  printf '%s\n%s\n' "${a238}" \
    "$(printf '%s' "${a239}" | sed 's|/home/verify/up-root|/home/verify/other-root|')" > "${ev_neg_root}"
  printf '%s\n%s\n' "${a238}" \
    "$(printf '%s' "${a239}" | sed 's/"produced_by_driver":true/"produced_by_driver":false/')" > "${ev_neg_drv}"
  : > "${ev_missing}"
  set +e
  out="$(check_upgrade_pairing "${ev_pos}" 2>&1)"; rc_pos=$?
  echo "selfcheck-upgrade-pairing: positive → rc=${rc_pos} ${out}"
  out="$(check_upgrade_pairing "${ev_neg_a238}" 2>&1)"; rc_neg_a238=$?
  echo "selfcheck-upgrade-pairing: ac239-only (no same-root AC-238) → rc=${rc_neg_a238} ${out}"
  out="$(check_upgrade_pairing "${ev_neg_root}" 2>&1)"; rc_neg_root=$?
  echo "selfcheck-upgrade-pairing: different-roots → rc=${rc_neg_root} ${out}"
  out="$(check_upgrade_pairing "${ev_neg_drv}" 2>&1)"; rc_neg_drv=$?
  echo "selfcheck-upgrade-pairing: not-produced-by-driver → rc=${rc_neg_drv} ${out}"
  out="$(check_upgrade_pairing "${ev_missing}" 2>&1)"; rc_missing=$?
  echo "selfcheck-upgrade-pairing: empty-evidence → rc=${rc_missing} ${out}"
  set -e
  [ "${rc_pos}" = "0" ] || { echo "selfcheck-upgrade-pairing: FAIL — paired records must exit 0, got ${rc_pos}" >&2; rc=1; }
  [ "${rc_neg_a238}" = "2" ] || { echo "selfcheck-upgrade-pairing: FAIL — AC-239 without a same-root AC-238 must exit 2, got ${rc_neg_a238}" >&2; rc=1; }
  [ "${rc_neg_root}" = "2" ] || { echo "selfcheck-upgrade-pairing: FAIL — different roots must exit 2, got ${rc_neg_root}" >&2; rc=1; }
  [ "${rc_neg_drv}" = "2" ] || { echo "selfcheck-upgrade-pairing: FAIL — produced_by_driver=false must exit 2, got ${rc_neg_drv}" >&2; rc=1; }
  [ "${rc_missing}" = "1" ] || { echo "selfcheck-upgrade-pairing: FAIL — empty evidence must exit 1 (NOT-EVALUATED), got ${rc_missing}" >&2; rc=1; }
  # 接线控制（同 selfcheck-e2e-pairing 的手法）：负控制须「该 host 记 PARTIAL」而不只是函数返回 2。
  # 按位置断言 verify_upgrade_mode 函数体里【既调用 check_upgrade_pairing，又在它返回 2 时置 partial=1】，
  # 且该块受 --ac239-e2e 门控（⛔ 不是无条件跑：非 ac239 模式没有 AC-239 可配，无条件跑会恒报 PARTIAL）。
  # 删掉接线此控制即取假。
  local vum_body vum_call=0 vum_partial=0 vum_gated=0
  vum_body="$(sed -n '/^verify_upgrade_mode()/,/^}$/p' "$0" 2>/dev/null)"
  case "$vum_body" in *'check_upgrade_pairing "${evidence_local}"'*) vum_call=1 ;; esac
  case "$vum_body" in *'upair_rc}" = "2"'*'partial=1'*) vum_partial=1 ;; esac
  case "$vum_body" in *'[ "${ac239_e2e}" -eq 1 ]'*'check_upgrade_pairing'*) vum_gated=1 ;; esac
  if [ "${vum_call}" != "1" ] || [ "${vum_partial}" != "1" ] || [ "${vum_gated}" != "1" ]; then rc=1; fi
  echo "selfcheck-upgrade-pairing: wiring(in-verify_upgrade_mode) call=${vum_call} partial=1_on_exit2=${vum_partial} gated_by_ac239_e2e=${vum_gated} (expect 1/1/1 — 否则函数返回 2 也没人记 PARTIAL)"
  rm -rf "${tmp}"
  if [ "${rc}" -eq 0 ]; then
    echo "selfcheck-upgrade-pairing: PASS (paired ⇒ exit 0; AC-239-only ⇒ exit 2 + UPGRADE_PAIR_MISSING=1; different roots ⇒ exit 2; not-produced-by-driver ⇒ exit 2; empty evidence ⇒ exit 1; wiring present in verify_upgrade_mode)"
  else
    echo "selfcheck-upgrade-pairing: FAIL" >&2
  fi
  return "${rc}"
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
    # 正控制②（gap-ac203-two-distinct-kinds-no-production-run AC1）：记录身份必须包含判据用来区分
    # 记录的**每一个**维度。实测反例：同一次远端运行写出的两条 AC-203 记录 ts/ac/host/project_root
    # 逐字相同、【仅 kind 不同】——旧 sig 只取那四个键 ⇒ 第二条被静默丢弃 ⇒ 生产载体里永远只有一种
    # kind ⇒ AC-203 的「≥2 个不同 kind」在【运输层】被抵消（硬规则 4c：判据点名的量必须穿过所有
    # 中间层还取得到）。此控制取假条件：把 sig 改回四键元组 ⇒ appended=1 ⇒ rc=1。
    # ⛔ 少了这条，上一条「repeat-append → 0」的绿可以来自「把去重做得更狠」而不是「身份取得对」——
    # 那正是硬规则 3b 的「一个恒绿的检查」形态。反向控制紧随其后（身份正确 ≠ 取消去重）。
    carrier="${tmp}/carrier-kind.jsonl"
    ev="${tmp}/evidence-kind.jsonl"
    cat > "${ev}" <<'EVID'
{"ts":"2026-09-13T00:00:00Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/verify/quay-verify-coldstart-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1,"kind":"promotion"}
{"ts":"2026-09-13T00:00:00Z","ac":"GOAL-009-AC-203","host":"orangevps","project_root":"/home/verify/quay-verify-coldstart-root","has_plugin_dir":false,"driver_alive":1,"carrier_records":1,"kind":"goal"}
EVID
    after="$(transport_evidence_append "${carrier}" "${ev}")" || rc=1
    echo "selfcheck-evidence: kind-dimension (same ts/ac/host/project_root, differing only in kind) → ${after}"
    printf '%s' "${after}" | grep -q 'appended=2' || { echo "selfcheck-evidence: FAIL — two AC-203 records differing only in kind collapsed (expect appended=2)" >&2; rc=1; }
    n="$(grep -c '.' "${carrier}" 2>/dev/null || true)"
    [ -n "${n}" ] || n=0
    echo "selfcheck-evidence: kind-dimension carrier lines=${n}"
    [ "${n}" = "2" ] || { echo "selfcheck-evidence: kind-dimension carrier lines=${n} (expect 2 — both kinds must reach the carrier)" >&2; rc=1; }
    after="$(transport_evidence_append "${carrier}" "${ev}")" || rc=1
    echo "selfcheck-evidence: kind-dimension repeat-append → ${after}"
    printf '%s' "${after}" | grep -q 'appended=0' || { echo "selfcheck-evidence: FAIL — kind-dimension re-transport not idempotent (identity too loose)" >&2; rc=1; }
    [ "${rc}" -eq 0 ] && echo "selfcheck-evidence: positive PASS (2 lines appended; repeat idempotent; kind dimension preserved — 两条仅 kind 不同的 AC-203 记录各自落盘)"
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

# ── selfcheck_takeover_transport — hermetic controls of the AC-247 transport of verify_takeover_mode ──
# 三个可区分取值，逐一钉住（offline：temp dir + python3，无 build/scp/ssh）：
#   ① 正控制：evidence 里有 ac=GOAL-016-AC-247 ⇒ transport 追加进载体 + check_evidence_completeness
#      声明集合 [GOAL-016-AC-247] ⇒ COMPLETE（exit 0），且载体里真的多了那一行。
#   ② 负控制（「回传了别的东西」与「产出并回传」必须不同形）：evidence 只有别的 ac ⇒
#      transport 仍会追加（它只按行搬运），而声明集合求差 ⇒ ALL-MISSING（exit 1 / NOT-EVALUATED）。
#      ⛔ 这一条是本模式最容易退化成的形态：★传输成功★ 被读成 ★产出成功★（硬规则 3b 同族）。
#   ③ 负控制：evidence 缺失 / 零行 ⇒ transport 返回非 0 + NOT-EVALUATED，载体零变化。
# 另含一条【结构性】控制（硬规则 ② 按位置）：verify_takeover_mode 的函数体里必须同时出现
# transport_evidence_append 与 check_evidence_completeness 的调用——把任一个挪走（或删掉）此谓词即取假，
# 否则「传输 + 完整性核对」只是恰好从没缺过，而不是被要求过（同 AC-240 的生成侧控制）。
selfcheck_takeover_transport() {
  local tmp rc=0 carrier ev out n hits
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-takeover-transport: FAIL — cannot create temp dir" >&2; return 1; }
  carrier="${tmp}/carrier.jsonl"

  # ① 正控制
  cat > "${tmp}/ev-ac247.jsonl" <<'EVID'
{"build_sha":"0123456789abcdef0123456789abcdef01234567","ts":"2026-09-12T00:00:00Z","ac":"GOAL-016-AC-247","host":"instance-20221019-1509","project_root":"/home/yale/work/archguard","pre_task_count":61,"post_task_count":61,"stale_days":22.5,"driver_alive":1,"carrier_records":7}
EVID
  if ! out="$(transport_evidence_append "${carrier}" "${tmp}/ev-ac247.jsonl")"; then rc=1; fi
  echo "selfcheck-takeover-transport: positive append → ${out}"
  printf '%s' "${out}" | grep -q 'appended=1' || rc=1
  n="$(grep -c '.' "${carrier}" 2>/dev/null || true)"
  [ -n "${n}" ] || n=0
  [ "${n}" = "1" ] || { echo "selfcheck-takeover-transport: positive carrier lines=${n} (expect 1)" >&2; rc=1; }
  if check_evidence_completeness "${tmp}/ev-ac247.jsonl" "GOAL-016-AC-247"; then
    echo "selfcheck-takeover-transport: positive completeness → COMPLETE (exit 0)"
  else
    echo "selfcheck-takeover-transport: positive completeness FAIL — declared ac set present but not judged COMPLETE" >&2; rc=1
  fi

  # ② 负控制：只有别的 ac ⇒ 传输会追加，但声明集合求差必须判 NOT-EVALUATED
  cat > "${tmp}/ev-other.jsonl" <<'EVID'
{"build_sha":"0123456789abcdef0123456789abcdef01234567","ts":"2026-09-12T00:00:01Z","ac":"GOAL-009-AC-238","host":"instance-20221019-1509","project_root":"/home/yale/work/archguard"}
EVID
  transport_evidence_append "${carrier}" "${tmp}/ev-other.jsonl" >/dev/null 2>&1 || true
  if check_evidence_completeness "${tmp}/ev-other.jsonl" "GOAL-016-AC-247" >/dev/null 2>&1; then
    echo "selfcheck-takeover-transport: negative(other-ac) FAIL — a run that produced the WRONG record was judged complete" >&2; rc=1
  else
    echo "selfcheck-takeover-transport: negative(other-ac) → NOT-EVALUATED (exit non-zero, as required — transport success ≠ production success)"
  fi
  # 空声明集合必须跳过（⛔ 不是判 NOT-EVALUATED：没有声明就无从求差，那是「未要求」不是「缺」）
  if check_evidence_completeness "${carrier}" "" >/dev/null 2>&1; then
    echo "selfcheck-takeover-transport: empty-declared-set → skipped (exit 0)"
  else
    echo "selfcheck-takeover-transport: empty-declared-set FAIL — no declared set must skip, not fail" >&2; rc=1
  fi

  # ③ 负控制：缺失 / 零行证据
  if transport_evidence_append "${carrier}" "${tmp}/missing.jsonl" >/dev/null 2>&1; then
    echo "selfcheck-takeover-transport: negative(missing) FAIL — returned success" >&2; rc=1
  fi
  : > "${tmp}/empty.jsonl"
  if transport_evidence_append "${carrier}" "${tmp}/empty.jsonl" >/dev/null 2>&1; then
    echo "selfcheck-takeover-transport: negative(zero-lines) FAIL — returned success" >&2; rc=1
  fi
  echo "selfcheck-takeover-transport: negative(missing/zero-lines) → NOT-EVALUATED (exit non-zero, as required)"

  # 结构性控制（位置）：传输 + 完整性核对两个调用点都必须在 verify_takeover_mode 函数体内。
  hits="$(sed -n '/^verify_takeover_mode()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//' \
          | grep -c 'transport_evidence_append\|check_evidence_completeness' || true)"
  echo "selfcheck-takeover-transport: write-points(in-verify_takeover_mode) hits=${hits} (expect >=2)"
  [ "${hits:-0}" -ge 2 ] 2>/dev/null || rc=1

  rm -rf "${tmp}"
  if [ "${rc}" -eq 0 ]; then echo "selfcheck-takeover-transport: PASS"; else echo "selfcheck-takeover-transport: FAIL" >&2; fi
  return "${rc}"
}

if [ "${selfcheck_takeover_transport_flag}" -eq 1 ]; then
  selfcheck_takeover_transport
  exit $?
fi

# ── selfcheck_adrflip_transport — hermetic controls of the AC-248 transport of verify_adr_flip_mode ──
# 与 selfcheck_takeover_transport 同形（同一条纪律、同一组原语），⛔ 不复刻一份判定逻辑：
#   ① 正控制：evidence 里有 ac=GOAL-016-AC-248 ⇒ transport 追加进载体 + 声明集合 [GOAL-016-AC-248]
#      ⇒ COMPLETE（exit 0），且载体里真的多了那一行。
#   ② 负控制（★传输成功★ 不得被读成 ★产出成功★）：evidence 只有别的 ac ⇒ 声明集合求差 ⇒
#      ALL-MISSING（exit 1 / NOT-EVALUATED）。
#   ③ 负控制：evidence 缺失 / 零行 ⇒ transport 返回非 0 + NOT-EVALUATED，载体零变化。
# 另含【结构性】控制（硬规则 ② 按位置）：verify_adr_flip_mode 的函数体里必须同时出现
# transport_evidence_append 与 check_evidence_completeness 的调用——把任一个挪走（或删掉）此谓词即取假。
# 再含一条 AC-248 专有的【形态】控制：运输的记录里两个 detects 字段必须是 JSON 布尔（`false`/`true`
# 裸值），⛔ 不是 `0`/`1`、也不是 `"false"`/`"true"` 字符串——判据用 `is False`/`is True`，
# 这两种冒充形态都取不到真；本控制【故意各造一条】证明它真的能取假（⛔ 不是只断言「好输入能过」）。
selfcheck_adrflip_transport() {
  local tmp rc=0 carrier ev out n hits bad_bad bad_str
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-adrflip-transport: FAIL — cannot create temp dir" >&2; return 1; }
  carrier="${tmp}/carrier.jsonl"

  # ① 正控制
  cat > "${tmp}/ev-ac248.jsonl" <<'EVID'
{"build_sha":"0123456789abcdef0123456789abcdef01234567","ts":"2026-09-12T00:00:00Z","ac":"GOAL-016-AC-248","host":"instance-20221019-1509","project_root":"/home/yale/work/archguard","commit_sha":"1111111111111111111111111111111111111111","commit_files":["src/cli/mcp/tools/metric-trend-tools.ts"],"task_id":"TASK-88","task_status":"done","gate_events":3,"produced_by_driver":true,"adr_check_before_detects":false,"adr_check_after_detects":true,"adr_check_probe_tool":"archguard_get_metric_trend"}
EVID
  if ! out="$(transport_evidence_append "${carrier}" "${tmp}/ev-ac248.jsonl")"; then rc=1; fi
  echo "selfcheck-adrflip-transport: positive append → ${out}"
  printf '%s' "${out}" | grep -q 'appended=1' || rc=1
  n="$(grep -c '.' "${carrier}" 2>/dev/null || true)"
  [ -n "${n}" ] || n=0
  [ "${n}" = "1" ] || { echo "selfcheck-adrflip-transport: positive carrier lines=${n} (expect 1)" >&2; rc=1; }
  if check_evidence_completeness "${tmp}/ev-ac248.jsonl" "GOAL-016-AC-248"; then
    echo "selfcheck-adrflip-transport: positive completeness → COMPLETE (exit 0)"
  else
    echo "selfcheck-adrflip-transport: positive completeness FAIL — declared ac set present but not judged COMPLETE" >&2; rc=1
  fi

  # ② 负控制：只有别的 ac ⇒ 传输会追加，但声明集合求差必须判 NOT-EVALUATED
  cat > "${tmp}/ev-other.jsonl" <<'EVID'
{"build_sha":"0123456789abcdef0123456789abcdef01234567","ts":"2026-09-12T00:00:01Z","ac":"GOAL-016-AC-247","host":"instance-20221019-1509","project_root":"/home/yale/work/archguard"}
EVID
  transport_evidence_append "${carrier}" "${tmp}/ev-other.jsonl" >/dev/null 2>&1 || true
  if check_evidence_completeness "${tmp}/ev-other.jsonl" "GOAL-016-AC-248" >/dev/null 2>&1; then
    echo "selfcheck-adrflip-transport: negative(other-ac) FAIL — a run that produced the WRONG record was judged complete" >&2; rc=1
  else
    echo "selfcheck-adrflip-transport: negative(other-ac) → NOT-EVALUATED (exit non-zero, as required — transport success ≠ production success)"
  fi

  # ③ 负控制：缺失 / 零行证据
  if transport_evidence_append "${carrier}" "${tmp}/missing.jsonl" >/dev/null 2>&1; then
    echo "selfcheck-adrflip-transport: negative(missing) FAIL — returned success" >&2; rc=1
  fi
  : > "${tmp}/empty.jsonl"
  if transport_evidence_append "${carrier}" "${tmp}/empty.jsonl" >/dev/null 2>&1; then
    echo "selfcheck-adrflip-transport: negative(zero-lines) FAIL — returned success" >&2; rc=1
  fi
  echo "selfcheck-adrflip-transport: negative(missing/zero-lines) → NOT-EVALUATED (exit non-zero, as required)"

  # ④ AC-248 专有：两个 detects 字段的【JSON 布尔形态】。用 python 按判据的同一谓词读（`is False`/`is True`），
  #    正样本必须过，两条冒充样本（0/1 与字符串）必须【各自】不过 ⇒ 这个谓词不是恒真的。
  bad_bad="$(python3 - "${carrier}" <<'PY'
import json, sys
ok = False
for line in open(sys.argv[1], encoding="utf-8"):
    if not line.strip():
        continue
    r = json.loads(line)
    if r.get("ac") != "GOAL-016-AC-248":
        continue
    ok = (r.get("adr_check_before_detects") is False and r.get("adr_check_after_detects") is True
          and bool(r.get("adr_check_probe_tool")))
print("1" if ok else "0")
PY
)"
  bad_str="$(python3 - "${carrier}" <<'PY'
import json, sys
# 冒充形态：把两个字段换成 0/1 与字符串 —— 同一个谓词必须【两种都不过】。
bad = [dict(), dict()]
n = 0
for line in open(sys.argv[1], encoding="utf-8"):
    if not line.strip():
        continue
    r = json.loads(line)
    if r.get("ac") != "GOAL-016-AC-248":
        continue
    a = dict(r); a["adr_check_before_detects"] = 0; a["adr_check_after_detects"] = 1
    b = dict(r); b["adr_check_before_detects"] = "false"; b["adr_check_after_detects"] = "true"
    bad = [a, b]
    n = 1
def passes(r):
    return (r.get("adr_check_before_detects") is False and r.get("adr_check_after_detects") is True
            and bool(r.get("adr_check_probe_tool")))
print(("0" if any(passes(r) for r in bad) else "1") if n else "0")
PY
)"
  echo "selfcheck-adrflip-transport: json-bool-shape(is-False/is-True) positive=${bad_bad} impostors-refused=${bad_str} (expect 1/1 — 0-1 与字符串两种冒充都必须取不到真)"
  [ "${bad_bad}" = "1" ] || rc=1
  [ "${bad_str}" = "1" ] || rc=1

  # 结构性控制（位置）：传输 + 完整性核对两个调用点都必须在 verify_adr_flip_mode 函数体内。
  hits="$(sed -n '/^verify_adr_flip_mode()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//' \
          | grep -c 'transport_evidence_append\|check_evidence_completeness' || true)"
  echo "selfcheck-adrflip-transport: write-points(in-verify_adr_flip_mode) hits=${hits} (expect >=2)"
  [ "${hits:-0}" -ge 2 ] 2>/dev/null || rc=1

  rm -rf "${tmp}"
  if [ "${rc}" -eq 0 ]; then echo "selfcheck-adrflip-transport: PASS"; else echo "selfcheck-adrflip-transport: FAIL" >&2; fi
  return "${rc}"
}

if [ "${selfcheck_adrflip_transport_flag}" -eq 1 ]; then
  selfcheck_adrflip_transport
  exit $?
fi

# ── selfcheck_complete_change_transport — hermetic controls of the AC-249 transport ─────────────
# 与 selfcheck_adrflip_transport 同形（同一条纪律、同一组原语），⛔ 不复刻一份判定逻辑：
#   ① 正控制：evidence 里有 ac=GOAL-016-AC-249 ⇒ transport 追加进载体 + 声明集合 [GOAL-016-AC-249]
#      ⇒ COMPLETE（exit 0），且载体里真的多了那一行。
#   ② 负控制（★传输成功★ 不得被读成 ★产出成功★）：evidence 只有别的 ac ⇒ 声明集合求差 ⇒
#      NOT-EVALUATED（exit 1）。
#   ③ 负控制：evidence 缺失 / 零行 ⇒ transport 返回非 0 + NOT-EVALUATED（⛔ 不静默 exit 0）。
#   ④ AC-249 专有【字段谓词】控制：用**与 goal criterion 同一组谓词**（python，逐字同形）读运输回来的
#      记录——正样本必须过；【只代码】与【只文档】两条冒充样本必须【各自】不过，`./src/...` 形态也必须
#      不过 ⇒ 「单边不算」与「前缀必须原样」这两条真的能取假（⛔ 不是只断言「好输入能过」）。
#   ⑤ 结构性（位置）：transport + completeness 两个调用点都必须在 verify_complete_change_mode 函数体内。
selfcheck_complete_change_transport() {
  local tmp rc=0 carrier ev out n hits cc_pos cc_code cc_doc cc_dot
  tmp="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-complete-change-transport: FAIL — cannot create temp dir" >&2; return 1; }
  carrier="${tmp}/carrier.jsonl"

  # ① 正控制：一条同时含代码面与文档面的并集
  cat > "${tmp}/ev-ac249.jsonl" <<'EVID'
{"build_sha":"0123456789abcdef0123456789abcdef01234567","ts":"2026-09-12T00:00:00Z","ac":"GOAL-016-AC-249","host":"instance-20221019-1509","project_root":"/home/yale/work/archguard","task_id":"TASK-89","commit_files":["scripts/check-adr.ts","tests/unit/scripts/check-adr.test.ts","quay-adr/ADR-007.md"]}
EVID
  if ! out="$(transport_evidence_append "${carrier}" "${tmp}/ev-ac249.jsonl")"; then rc=1; fi
  echo "selfcheck-complete-change-transport: positive append → ${out}"
  printf '%s' "${out}" | grep -q 'appended=1' || rc=1
  n="$(grep -c '.' "${carrier}" 2>/dev/null || true)"
  [ -n "${n}" ] || n=0
  [ "${n}" = "1" ] || { echo "selfcheck-complete-change-transport: positive carrier lines=${n} (expect 1)" >&2; rc=1; }
  if check_evidence_completeness "${tmp}/ev-ac249.jsonl" "GOAL-016-AC-249"; then
    echo "selfcheck-complete-change-transport: positive completeness → COMPLETE (exit 0)"
  else
    echo "selfcheck-complete-change-transport: positive completeness FAIL — declared ac set present but not judged COMPLETE" >&2; rc=1
  fi

  # ② 负控制：只有别的 ac
  cat > "${tmp}/ev-other.jsonl" <<'EVID'
{"build_sha":"0123456789abcdef0123456789abcdef01234567","ts":"2026-09-12T00:00:01Z","ac":"GOAL-016-AC-248","host":"instance-20221019-1509","project_root":"/home/yale/work/archguard"}
EVID
  transport_evidence_append "${carrier}" "${tmp}/ev-other.jsonl" >/dev/null 2>&1 || true
  if check_evidence_completeness "${tmp}/ev-other.jsonl" "GOAL-016-AC-249" >/dev/null 2>&1; then
    echo "selfcheck-complete-change-transport: negative(other-ac) FAIL — a run that produced the WRONG record was judged complete" >&2; rc=1
  else
    echo "selfcheck-complete-change-transport: negative(other-ac) → NOT-EVALUATED (exit non-zero, as required — transport success ≠ production success)"
  fi

  # ③ 负控制：缺失 / 零行证据
  if transport_evidence_append "${carrier}" "${tmp}/missing.jsonl" >/dev/null 2>&1; then
    echo "selfcheck-complete-change-transport: negative(missing) FAIL — returned success" >&2; rc=1
  fi
  : > "${tmp}/empty.jsonl"
  if transport_evidence_append "${carrier}" "${tmp}/empty.jsonl" >/dev/null 2>&1; then
    echo "selfcheck-complete-change-transport: negative(zero-lines) FAIL — returned success" >&2; rc=1
  fi
  echo "selfcheck-complete-change-transport: negative(missing/zero-lines) → NOT-EVALUATED (exit non-zero, as required)"

  # ④ 字段谓词控制：同一组谓词（逐字同形于 goal criterion 的那两行 any(...)）读运输回来的记录。
  #    正样本 1 条；三段冒充（只代码 / 只文档 / `./src` 形态）必须【各自】取不到真。
  cc_pos="$(python3 - "${carrier}" <<'PY'
import json, sys
ok = False
for line in open(sys.argv[1], encoding="utf-8"):
    if not line.strip():
        continue
    r = json.loads(line)
    if r.get("ac") != "GOAL-016-AC-249":
        continue
    cf = r.get("commit_files")
    ok = (isinstance(cf, list) and bool(cf)
          and any(str(x).startswith(("src/", "scripts/")) for x in cf)
          and any(("ADR-007" in str(x)) or str(x).startswith("docs/adr") for x in cf)
          and bool(r.get("task_id")))
print("1" if ok else "0")
PY
)"
  cc_code="$(python3 - "${carrier}" <<'PY'
import json, sys
# 冒充形态一：并集只有代码面（一个完美但【不完整】的修复）
ok = False
for line in open(sys.argv[1], encoding="utf-8"):
    if not line.strip():
        continue
    r = json.loads(line)
    if r.get("ac") != "GOAL-016-AC-249":
        continue
    cf = ["scripts/check-adr.ts", "tests/unit/scripts/check-adr.test.ts"]
    ok = (any(str(x).startswith(("src/", "scripts/")) for x in cf)
          and any(("ADR-007" in str(x)) or str(x).startswith("docs/adr") for x in cf))
print("0" if ok else "1")
PY
)"
  cc_doc="$(python3 - "${carrier}" <<'PY'
import json, sys
# 冒充形态二：并集只有文档面（只同步文档、没改代码）
ok = False
for line in open(sys.argv[1], encoding="utf-8"):
    if not line.strip():
        continue
    r = json.loads(line)
    if r.get("ac") != "GOAL-016-AC-249":
        continue
    cf = ["quay-adr/ADR-007.md", "docs/notes.md"]
    ok = (any(str(x).startswith(("src/", "scripts/")) for x in cf)
          and any(("ADR-007" in str(x)) or str(x).startswith("docs/adr") for x in cf))
print("0" if ok else "1")
PY
)"
  cc_dot="$(python3 - "${carrier}" <<'PY'
import json, sys
# 冒充形态三：路径带 `./` 前缀 —— criterion 的 startswith("src/") 分支必须因此取假
ok = False
for line in open(sys.argv[1], encoding="utf-8"):
    if not line.strip():
        continue
    r = json.loads(line)
    if r.get("ac") != "GOAL-016-AC-249":
        continue
    cf = ["./scripts/check-adr.ts", "quay-adr/ADR-007.md"]
    ok = (any(str(x).startswith(("src/", "scripts/")) for x in cf)
          and any(("ADR-007" in str(x)) or str(x).startswith("docs/adr") for x in cf))
print("0" if ok else "1")
PY
)"
  echo "selfcheck-complete-change-transport: commit-files-predicate positive=${cc_pos} impostors-refused(code=${cc_code},doc=${cc_doc},dot-slash=${cc_dot}) (expect 1/1/1/1 — 单边不算 + 前缀必须原样，两种都能取假)"
  [ "${cc_pos}" = "1" ] || rc=1
  [ "${cc_code}" = "1" ] || rc=1
  [ "${cc_doc}" = "1" ] || rc=1
  [ "${cc_dot}" = "1" ] || rc=1

  # 结构性控制（位置）：传输 + 完整性核对两个调用点都必须在 verify_complete_change_mode 函数体内。
  hits="$(sed -n '/^verify_complete_change_mode()/,/^}$/p' "$0" 2>/dev/null | sed 's/#.*//' \
          | grep -c 'transport_evidence_append\|check_evidence_completeness' || true)"
  echo "selfcheck-complete-change-transport: write-points(in-verify_complete_change_mode) hits=${hits} (expect >=2)"
  [ "${hits:-0}" -ge 2 ] 2>/dev/null || rc=1

  rm -rf "${tmp}"
  if [ "${rc}" -eq 0 ]; then echo "selfcheck-complete-change-transport: PASS"; else echo "selfcheck-complete-change-transport: FAIL" >&2; fi
  return "${rc}"
}

if [ "${selfcheck_complete_change_transport_flag}" -eq 1 ]; then
  selfcheck_complete_change_transport
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

if [ "${selfcheck_upgrade_pairing}" -eq 1 ]; then
  selfcheck_upgrade_pairing
  exit $?
fi

# host_key -> (ssh_target, node_path)  — node_path uses $HOME, NOT ~ (tilde does not expand inside
# double quotes in the remote `export PATH="...:..."`); both verified reachable BatchMode 2026-08-11.
declare -A host_target host_node
host_target[B]="orangevps.wan.hwang.men"
host_node[B]="\$HOME/.nvm/versions/node/v22.23.1/bin"
host_target[C]="ad-arm1.wan.hwang.men"
host_node[C]="\$HOME/.local/opt/node-current/bin"

# --build-ref <ref>（缺省 refs/heads/develop）：从哪个 ref 现 build 交付物。
# 存在的理由是一个【真实的排序约束】，不是方便旋钮：AC-257 的判据要求 `quay_version=0.7.0`，而被验的
# 交付物在这一刻还不能在 develop 上 —— 版本 bump 本身就住在这个任务的分支里，develop 要等 fan-in 才
# 拿到它。若本模式硬绑 develop，就会 build 出一个 0.6.1 的 tgz，然后拿它去验一条要求 0.7.0 的判据 ⇒
# 结构上不可能达成（而失败形态会是「记录没写出来」，与「机制坏了」同形，硬规则 3b）。
# ⛔ 缺省值刻意保持 develop：所有既有模式的行为逐字不变；给出时会打印出来，⛔ 不静默改基线。
if [ -n "${build_ref}" ]; then
  develop_tip="$(git -C "${repo_root}" rev-parse "${build_ref}^{commit}" 2>/dev/null || echo "")"
  if [ -z "${develop_tip}" ]; then
    echo "develop-deliver: ERROR — cannot resolve --build-ref '${build_ref}' in ${repo_root}" >&2
    exit 1
  fi
  echo "develop-deliver: --build-ref '${build_ref}' overrides the delivery baseline ⇒ tip=${develop_tip:0:12} (⛔ 不是 refs/heads/develop)"
else
  develop_tip="$(git -C "${repo_root}" rev-parse refs/heads/develop 2>/dev/null || echo "")"
  if [ -z "${develop_tip}" ]; then
    echo "develop-deliver: ERROR — cannot resolve refs/heads/develop in ${repo_root}" >&2
    exit 1
  fi
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
    # ⚠️ if-形（⛔ 不是裸调用 + 下一行 `ck_rc=$?`）：本脚本 set -e，裸调用在非 0 时会让脚本在本行
    #    静默中止 —— 后续那条「NOT-EVALUATED (declared ac set …) 」痕迹与本模式的最终 FAILED 摘要都不会
    #    出现（实测 2026-09-12）。判「缺」必须留下可区分的痕迹，不能与「脚本炸了」同形（硬规则 3b）。
    if check_evidence_completeness "${evidence_local}" "${expected_acs}"; then ck_rc=0; else ck_rc=$?; fi
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
  local build_date local_carrier fail partial hk target remote_script out remote_rc remote_log remote_evidence evidence_local ck_rc upair_rc ac239_extra ac239_path_export ac239_expected
  build_date="$(git -C "${repo_root}" log -1 --format=%cI refs/heads/develop 2>/dev/null || echo "")"
  local_carrier="${repo_root}/.quay/productization-verification.jsonl"
  echo "develop-deliver: --verify-upgrade develop=${develop_tip:0:12} build_date=${build_date} source=\$HOME/${upgrade_source:-<unset>}"
  if [ -z "${upgrade_source}" ]; then
    echo "develop-deliver: --verify-upgrade requires --upgrade-source <path relative to \$HOME on the remote host>" >&2
    return 2
  fi
  fail=0
  partial=0
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
    # --ac239-e2e: 升级【后】的动态闭环（GOAL-009-AC-239）。要能在【升级后的那个项目里】真起 worker，
    # 两件与 --ac207-e2e 同源的前置缺一不可：(a) 驱动方仓库的 .quay/profiles.yml 到远端，让目标项目
    # worker-default 的 launcher/model/auth 从单一真相源派生（硬规则 4c：⛔ 不在这里写第二份字面量）；
    # (b) ~/.local/bin 进 PATH，否则 claude/claude-fjdac 解析不到（ssh 非交互 PATH 两样都没有）。
    # 两者都以【单引号】字面插入远端脚本，使 $HOME/$PATH 在远端展开而不是在本机展开。
    ac239_extra=""
    ac239_path_export=""
    ac239_expected="GOAL-009-AC-238"
    if [ "${ac239_e2e}" -eq 1 ]; then
      if ! scp "${ssh_opts[@]}" "${repo_root}/.quay/profiles.yml" "${target}:~/quay-driving-profiles.yml" >/dev/null 2>&1; then
        echo "develop-deliver: ${hk} (${target}) — driving-profiles scp FAILED (NOT-EVALUATED)"
        fail=1
        continue
      fi
      # AC239_POLL_SECS: 本任务是一条【真实缺陷修复】（定位→改 Go 源码→跑测试→fan-in 全量 suite），
      # 比 AC-207 的 marker 任务重得多；3600s 给足余量，超时即不写记录（fail-closed，⛔ 不无限等）。
      ac239_path_export='export PATH="$HOME/.local/bin:$PATH"; export AC239_POLL_SECS="${AC239_POLL_SECS:-3600}"'
      ac239_extra=' --ac239-e2e --driving-profiles "$HOME/quay-driving-profiles.yml"'
      # 本次运行【声明要产出】的 ac 种类随之加一条：AC-239 缺席即 PARTIAL/NOT-EVALUATED，⛔ 不静默成 ok。
      ac239_expected="GOAL-009-AC-238 GOAL-009-AC-239"
    fi
    remote_script=$(cat <<REMOTE
$(verify_node_export_for "${hk}")
${ac239_path_export}
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
  --upgrade-source "\${HOME}/${upgrade_source}"${ac239_extra}
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
    # 传输成功 ≠ 产出完整：按 ac 种类核对取回的内容里确有 AC-238（--ac239-e2e 时还须有 AC-239）
    # 那一条（硬规则 3b 同族）。expected 集合是【本次运行声明要产出的种类】，不是硬编码的常数。
    # ⚠️ if-形（⛔ 不是裸调用 + 下一行 `ck_rc=$?`）：理由同 verify_adr_flip_mode——set -e 下裸调用
    #    非 0 会静默中止，判「缺」的可区分痕迹就没了。
    if check_evidence_completeness "${evidence_local}" "${ac239_expected}"; then ck_rc=0; else ck_rc=$?; fi
    if [ "${ck_rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (declared ac set [${ac239_expected}] not fully present in transported evidence)"
      fail=1
    else
      echo "develop-deliver: ${hk} (${target}) — declared ac set [${ac239_expected}] transported into ${local_carrier} ✓"
    fi
    # --ac239-e2e：种类齐 ≠ 同源。AC-239 的全部价值在于它的 project_root 是【AC-238 已证明升级成功的
    # 那一个】——另起一个全新项目跑一遍 e2e 也会产出一条字段齐全的 AC-239。此判定必须在此处跑，
    # ⛔ 不能只靠目标机上的判据（那是事后防线，这里是同一次运行的传输侧同判）。
    if [ "${ac239_e2e}" -eq 1 ]; then
      check_upgrade_pairing "${evidence_local}"
      upair_rc=$?
      if [ "${upair_rc}" = "2" ]; then
        echo "develop-deliver: ${hk} (${target}) — PARTIAL (AC-238/AC-239 not on one project_root — UPGRADE_PAIR_MISSING=1)"
        partial=1
      elif [ "${upair_rc}" != "0" ]; then
        echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (upgrade-pairing could not be judged)"
        fail=1
      fi
    fi
    rm -f "${evidence_local}"
  done
  git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: --verify-upgrade FAILED (a host produced no AC-238 record — see per-host lines above)" >&2
    return 1
  fi
  if [ "${partial}" -eq 1 ]; then
    echo "develop-deliver: --verify-upgrade PARTIAL (records transported, but AC-239 does not share AC-238's project_root — AC-239 判据不会翻绿；见 UPGRADE_PAIR_MISSING 行)" >&2
    return 2
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

# validate_takeover_args — the ONE place that decides whether --takeover-root is usable. Returns 0/1 and
# prints a distinguishable reason on refusal. ⛔ Both the dispatch and verify_takeover_mode call THIS
# (the dispatch needs it BEFORE build_develop_tgz: a usage error must cost a usage error, not a full
# develop-tip build — measured 2026-09-12: the check used to live only in the mode, so a bad flag spent
# 26s building first).
# ⛔ ABSOLUTE path required: the root is resolved ON the remote host, so a relative path silently resolves
# against the remote ssh $HOME ⇒ the run would take over / verify a DIFFERENT project than the one the
# criterion will name (and the criterion would then be reading a record about something else entirely).
validate_takeover_args() {
  if [ -z "${takeover_root}" ]; then
    echo "develop-deliver: --verify-takeover requires --takeover-root <absolute path ON the remote host of the ≥14-day-stalled project>" >&2
    return 1
  fi
  case "${takeover_root}" in
    /*) return 0 ;;
    *) echo "develop-deliver: --verify-takeover --takeover-root must be an ABSOLUTE path on the remote host (got: ${takeover_root})" >&2; return 1 ;;
  esac
}

# ── verify_takeover_mode — GOAL-016-AC-247：接管【停摆 ≥14 天】的存量项目取证 ────────────────────
# 与 verify_coldstart_mode 的区别是本质的：那条的远端 ② 是「rm -rf $ROOT 后全新 quay-init」的一次性
# 靶子（GOAL-009 的九条证据全出自该形态）；本模式把远端脚本切到 --ac247-takeover，对一个【本来就带着
# 真实存量与旧历史、且已停摆 ≥14 天】的项目做真安装 + 真接管，只取回 ac=GOAL-016-AC-247 那一条记录。
# ⛔ takeover_root 是【目标机上的绝对路径】，指向存量项目本体（⛔ 不是本模式新造的项目——判据侧的
# stale_days≥14 与 pre_task_count>0 就是「非当天现造」的区分量，本模式一格都不代填）。
# 传输面与另两个 verify 模式同形，用的是同一组原语：ship_verify_closure / transport_evidence_append
# （按 (ts,ac,host,project_root) 去重）/ check_evidence_completeness（声明 ac 集合求差）。
verify_takeover_mode() {
  local build_date local_carrier fail hk target remote_script out remote_rc remote_log remote_evidence evidence_local ck_rc
  build_date="$(git -C "${repo_root}" log -1 --format=%cI refs/heads/develop 2>/dev/null || echo "")"
  local_carrier="${repo_root}/.quay/productization-verification.jsonl"
  echo "develop-deliver: --verify-takeover develop=${develop_tip:0:12} build_date=${build_date} takeover_root=${takeover_root:-<unset>} carrier=${local_carrier}"
  validate_takeover_args || return 2
  # 本次运行【声明要产出】的 ac 种类（⛔ 不硬编码数字，声明的是种类本身）：只有 AC-247 一种。
  local expected_acs="GOAL-016-AC-247"
  fail=0
  for hk in ${hosts}; do
    target="${host_target[$hk]:-}"
    if [ -z "${target}" ]; then
      echo "develop-deliver: ${hk} — unknown host key (NOT-EVALUATED)"
      fail=1
      continue
    fi
    echo "develop-deliver: ${hk} (${target}) — scp verify-deliver-coldstart.sh + its FULL closure (\$SCRIPT_DIR siblings + node_modules deps) + SPEC + both .tgz"
    # ⛔ 闭集的单一真相源在 transport_flat_files / transport_node_modules_deps（由
    # --selfcheck-transport-closure 证完整）；⛔ 不在此处再抄一份清单。
    if ! ship_verify_closure "${target}" "${quay_tgz}" "${qn_tgz}"; then
      echo "develop-deliver: ${hk} (${target}) — scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    remote_script=$(cat <<REMOTE
$(verify_node_export_for "${hk}")
EV="\${HOME}/quay-verify-takeover-evidence-${develop_tip:0:8}.jsonl"
rm -f "\${EV}"
bash "\${HOME}/verify-deliver-coldstart.sh" \
  --tgz "\${HOME}/$(basename "${quay_tgz}")" \
  --tgz-native "\${HOME}/$(basename "${qn_tgz}")" \
  --build-sha "${develop_tip}" \
  --build-date "${build_date}" \
  --host "${hk}" \
  --ac89 "\${EV}" \
  --spec "\${HOME}/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md" \
  --prefix "\${HOME}/quay-verify-takeover-${develop_tip:0:8}.npm" \
  --project "quay-verify-takeover-${develop_tip:0:8}" \
  --root "\${HOME}/quay-verify-takeover-${develop_tip:0:8}-root" \
  --ac247-takeover \
  --takeover-root "${takeover_root}"
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
    remote_log="${repo_root}/.quay/verify-takeover-remote-${hk}-${develop_tip:0:8}.log"
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
    evidence_local="${repo_root}/.quay/verify-takeover-evidence-${hk}-${develop_tip:0:8}.jsonl"
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
    # 传输成功 ≠ 产出完整（硬规则 3b 同族：一个「回传了别的东西」的成功与「产出并回传」同形）。
    # 本条只要一种记录，缺它即 NOT-EVALUATED（⛔ 没有 PARTIAL 这一档：种类集合只有一个元素，
    # 「部分齐」在本模式下不存在——那不是可区分的状态，是自欺）。
    # ⚠️ if-形（⛔ 不是裸调用 + 下一行 `ck_rc=$?`）：本脚本 set -e，裸调用在非 0 时会让脚本在本行
    #    静默中止 —— 后续那条「NOT-EVALUATED (declared ac set …) 」痕迹与本模式的最终 FAILED 摘要都不会
    #    出现（实测 2026-09-12）。判「缺」必须留下可区分的痕迹，不能与「脚本炸了」同形（硬规则 3b）。
    if check_evidence_completeness "${evidence_local}" "${expected_acs}"; then ck_rc=0; else ck_rc=$?; fi
    if [ "${ck_rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (declared ac set [${expected_acs}] not present in transported evidence: rc=${ck_rc})"
      fail=1
    else
      echo "develop-deliver: ${hk} (${target}) — declared ac set [${expected_acs}] transported into ${local_carrier} ✓"
    fi
    rm -f "${evidence_local}"
  done
  git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: --verify-takeover FAILED (a host produced no AC-247 record — see per-host lines above)" >&2
    return 1
  fi
  echo "develop-deliver: --verify-takeover OK — GOAL-016-AC-247 record transported into ${local_carrier}"
  return 0
}

# validate_ac257_args — the ONE place that decides whether the AC-257 transport flags are usable.
# ⛔ 四处都是【远端解析】的路径/以远端为对象的值，因此逐条前置校验（一个坏参数不该花一次 develop-tip 构建）：
#   · --target-root       必须是【目标机上的绝对路径】——被取证的是那里那个真实项目本体（判据读它的
#                         project_root 与它自己的 .claude/settings.json），相对路径会静默落到远端 $HOME。
#   · --ac257-plugin-root 必须是【目标机上的绝对路径】且指向一个 plugin 交付物（…/quay/plugin）——
#                         它同时决定 quay_version 的读处与 project-scope 安装的源，⛔ 不接受一个 PATH 名。
#   · --ac257-task-id     必填：被取证的是【那一条被驱动到 done 的任务】（AC-207 已经踩过「取最新一条」
#                         = 记账提交的坑，这里不重犯）。
#   · --ac257-task-body   必须是【本地存在的文件】：它被 scp 到远端再喂给 task create，⛔ 不在远端手打。
validate_ac257_args() {
  local a
  for a in ac257_root ac257_plugin_root; do
    eval "local v=\${$a}"
    if [ -z "$v" ]; then
      echo "develop-deliver: --verify-ac257 requires --$([ "$a" = ac257_root ] && echo target-root || echo ac257-plugin-root) <absolute path ON the remote host>" >&2
      return 1
    fi
    case "$v" in
      /*) ;;
      *) echo "develop-deliver: --verify-ac257 $a must be an ABSOLUTE path on the remote host (got: $v)" >&2; return 1 ;;
    esac
  done
  if [ -z "${ac257_task}" ]; then
    echo "develop-deliver: --verify-ac257 requires --ac257-task-id <the task in THAT project driven to done>" >&2
    return 1
  fi
  if [ -z "${ac257_task_body}" ] || [ ! -f "${ac257_task_body}" ]; then
    echo "develop-deliver: --verify-ac257 requires --ac257-task-body <local path to that task's body file> (got: ${ac257_task_body:-<empty>})" >&2
    return 1
  fi
  return 0
}

# ── verify_ac257_mode — GOAL-018-AC-257：project scope 安装 + quay-init 重跑（合并语义）+ 真实 todo→done ──
# 与 verify_takeover_mode / verify_adr_flip_mode 同一条纪律、同一组原语（ship_verify_closure /
# transport_evidence_append / check_evidence_completeness），差别在远端脚本切到 --ac257-project-scope
# 并且本模式要先把交付物装到【持久】前缀（判据的 quay_version 与 install_scope 都以此为对象）：
#   $HOME/.local/opt/quay/<tgz 里的 version>       ⛔ 不是 verify-/probe-/tmp- 形态的一次性前缀
# 版本号从 tgz 名解析（⛔ 不另写一份版本真源）。装完 plugin root = <prefix>/lib/node_modules/quay/plugin，
# 它同时是 (a) quay_version 的读处、(b) quay-init --plugin-root、(c) project-scope marketplace 的源。
# 只取回 ac=GOAL-018-AC-257 那一条记录；没有 ⇒ NOT-EVALUATED + 非 0（硬规则 3b）。
verify_ac257_mode() {
  local build_date local_carrier fail hk target remote_script out remote_rc remote_log remote_evidence evidence_local ck_rc
  build_date="$(git -C "${repo_root}" log -1 --format=%cI "${develop_tip}" 2>/dev/null || echo "")"
  local_carrier="${repo_root}/.quay/productization-verification.jsonl"
  echo "develop-deliver: --verify-ac257 tip=${develop_tip:0:12} build_date=${build_date} target_root=${ac257_root} plugin_root=${ac257_plugin_root} task=${ac257_task} carrier=${local_carrier}"
  if ! validate_ac257_args; then return 2; fi
  local expected_acs="GOAL-018-AC-257"
  # 版本号 = tgz 名里的那一段（`quay-<version>.tgz`）——交付物自己携带的版本，⛔ 不另立真源。
  local ac257_ver
  ac257_ver="$(basename "${quay_tgz}")"; ac257_ver="${ac257_ver#quay-}"; ac257_ver="${ac257_ver%.tgz}"
  if [ -z "${ac257_ver}" ]; then
    echo "develop-deliver: --verify-ac257 cannot derive the version from the tgz name ($(basename "${quay_tgz}"))" >&2
    return 2
  fi
  echo "develop-deliver: --verify-ac257 delivery version=${ac257_ver} ⇒ persistent prefix \$HOME/.local/opt/quay/${ac257_ver}"
  fail=0
  for hk in ${hosts}; do
    target="${host_target[$hk]:-}"
    if [ -z "${target}" ]; then
      echo "develop-deliver: ${hk} — unknown host key (NOT-EVALUATED)"
      fail=1
      continue
    fi
    echo "develop-deliver: ${hk} (${target}) — scp verify-deliver-coldstart.sh + its FULL closure + both .tgz + the task body"
    if ! ship_verify_closure "${target}" "${quay_tgz}" "${qn_tgz}"; then
      echo "develop-deliver: ${hk} (${target}) — scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    # ⚠️ 目标路径必须写 `~/`，⛔ 不是 `\$HOME/`：现代 scp 走 SFTP 子系统（本脚本的 ssh 调用即
    # `-s ... sftp`），**远端路径不做 shell 展开** —— `$HOME/...` 会被当成一个字面文件名去创建，
    # scp 直接失败（实测 2026-09-14：整个模式在门口 NOT-EVALUATED，远端根本没有那个文件）。
    # `~` 是 SFTP 协议自己认的，所以本文件其余五处 scp 目标一律写 `:~/`。两条路径在远端是同一个
    # 文件（脚本用 `\${HOME}/ac257-task-body.md` 读它）。
    if ! scp "${ssh_opts[@]}" "${ac257_task_body}" "${target}:~/ac257-task-body.md" >/dev/null 2>&1; then
      echo "develop-deliver: ${hk} (${target}) — task-body scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    remote_script=$(cat <<REMOTE
$(verify_node_export_for "${hk}")
EV="\${HOME}/quay-verify-ac257-evidence-${develop_tip:0:8}.jsonl"
rm -f "\${EV}"
PREFIX="\${HOME}/.local/opt/quay/${ac257_ver}"
mkdir -p "\${PREFIX}"
echo "AC257-INSTALLING-PREFIX \${PREFIX}"
npm install -g --prefix "\${PREFIX}" --no-audit --no-fund "\${HOME}/$(basename "${quay_tgz}")" "\${HOME}/$(basename "${qn_tgz}")" >/dev/null 2>&1
echo "AC257-INSTALL-RC \$?"
PLUGIN_ROOT="\${PREFIX}/lib/node_modules/quay/plugin"
if [ ! -d "\${PLUGIN_ROOT}" ]; then echo "AC257-PLUGIN-ABSENT \${PLUGIN_ROOT}"; exit 1; fi
bash "\${HOME}/verify-deliver-coldstart.sh" \
  --ac257-project-scope \
  --target-root "${ac257_root}" \
  --ac257-plugin-root "\${PLUGIN_ROOT}" \
  --ac257-task-id "${ac257_task}" \
  --ac257-task-body "\${HOME}/ac257-task-body.md" \
  --ac257-host-fqdn "${host_target[$hk]}" \
  --build-sha "${develop_tip}" \
  --ac89 "\${EV}"
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
    # ⚠️ `bash -ls`（【登录】shell），⛔ 不是 `bash -s`：被取证的那一步要用 `claude`，而 ad-arm1 上
    # `claude` 只装在 ~/.local/bin、且【不在非登录 shell 的 PATH 里】（实测：`ssh ad-arm1 'command -v
    # claude'` ⇒ 空，`bash -lc` ⇒ /home/yale/.local/bin/claude）。用非登录 shell 会让 `command -v claude`
    # 取假 ⇒ 项目级安装整段被跳过 ⇒ install_scope 永远读不到 project ⇒ 本 AC 结构上不可能达成，
    # 而失败形态是「记录没写出来」，与「机制坏了」同形（硬规则 3b / 4b：代理量 vs 直接量）。
    out="$(ssh "${ssh_opts[@]}" "${target}" "bash -ls" <<< "${remote_script}" 2>&1)"
    remote_rc=$?
    set -e
    remote_log="${repo_root}/.quay/verify-ac257-remote-${hk}-${develop_tip:0:8}.log"
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
    evidence_local="${repo_root}/.quay/verify-ac257-evidence-${hk}-${develop_tip:0:8}.jsonl"
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
    if check_evidence_completeness "${evidence_local}" "${expected_acs}"; then ck_rc=0; else ck_rc=$?; fi
    if [ "${ck_rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (declared ac set [${expected_acs}] not present in transported evidence: rc=${ck_rc})"
      fail=1
    else
      echo "develop-deliver: ${hk} (${target}) — declared ac set [${expected_acs}] transported into ${local_carrier} ✓"
    fi
    rm -f "${evidence_local}"
  done
  git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: --verify-ac257 FAILED (a host produced no AC-257 record — see per-host lines above)" >&2
    return 1
  fi
  echo "develop-deliver: --verify-ac257 OK — GOAL-018-AC-257 record transported into ${local_carrier}"
  return 0
}

# validate_ac258_args — the ONE place that decides whether the AC-258 transport flags are usable.
# 与 validate_ac257_args 同一条纪律、同样在 build 之前判（⛔ 一个坏参数不该花一次 develop-tip 构建）：
#   · --target-root 必须是【目标机上的绝对路径】：它在远端解析，相对路径会静默落到远端 $HOME ⇒
#     被取证的是【另一个项目】，而判据侧的 project_root 会如实记下那个错的项目。
#   · --ac258-task-id 必填：被取证的是【那一条被驱动到 done 的任务】；让脚本去猜（或取最新一条）正是
#     AC-207 已经踩过的坑（「最新一条提交」= 记账提交）。
#   · --ac258-task-body 必须是【本地存在的文件】：它被 scp 到远端再喂给 task create，⛔ 不在远端手打。
# ⚠️ 与 AC-257 的差别：**没有** --ac258-plugin-root —— 本模式把交付物装到它自己派生的【持久前缀】
# （$HOME/.local/opt/quay/<tgz 版本>），plugin root 由该前缀推出。少一个调用方可以拧错的旋钮
# （「前缀是什么」与「plugin root 是什么」若是两个入参就能互相矛盾，硬规则 3b）。
validate_ac258_args() {
  if [ -z "${ac258_root}" ]; then
    echo "develop-deliver: --verify-ac258 requires --target-root <absolute path ON the remote host of the REAL project>" >&2
    return 1
  fi
  case "${ac258_root}" in
    /*) ;;
    *) echo "develop-deliver: --verify-ac258 --target-root must be an ABSOLUTE path on the remote host (got: ${ac258_root})" >&2; return 1 ;;
  esac
  if [ -z "${ac258_task}" ]; then
    echo "develop-deliver: --verify-ac258 requires --ac258-task-id <the task in THAT project driven to done>" >&2
    return 1
  fi
  if [ -z "${ac258_task_body}" ] || [ ! -f "${ac258_task_body}" ]; then
    echo "develop-deliver: --verify-ac258 requires --ac258-task-body <local path to that task's body file> (got: ${ac258_task_body:-<empty>})" >&2
    return 1
  fi
  return 0
}

# ── ac258_probe_target_worker — 目标机 worker 可用性的【本地侧】前置探测 ─────────────────────────
# 存在的理由见 verify-deliver-coldstart.sh 的 ac258_worker_preflight 头注释（同一个 gap：AC-258 把
# 「目标机能否跑 worker」这个可秒级探测的后置条件排在【三步破坏性且自耗】的动作之后）。本函数是那
# 条纪律的【最早一个】落点：它排在 build_develop_tgz 之前 —— 与 validate_ac258_args 的「一个坏参数
# 不该花一次 develop-tip 构建」完全同一条纪律，只是这里的「坏」是【目标机起不了 worker】。
#
# 与远端那个函数的分工：远端的是【权威】判定（它就在那台机器上跑，且在删键前再判一次，保护直接
# 调用那个脚本的人）；本地这一份多出一个【只有本地能观测】的取值 —— ssh 不可达。
#
# 返回（硬规则 3b：读不懂输入不得返回与【合格】同形的值 ⇒ 每一态各自取值）：
#   0 = usable       探测通过
#   1 = credentials  目标机上的探测跑了但失败（凭据不可用 / 模型不可达 —— 原样输出点名）
#   2 = absent       目标机上没有 `claude`（⛔ 与 1 分开：一个是装没装，一个是登录态）
#   3 = timeout      探测超时（ssh 挂住 或 远端探测挂住；⛔ 与 4 分开：挂住 ≠ 到不了）
#   4 = unreachable  ssh 到不了目标机（连接被拒 / 主机不可达）
# stdout 恒为一枚单行 `AC258-PREFLIGHT <verdict> <detail>`。
ac258_probe_target_worker() {
  local target="${1:?target required}" timeout_secs="${2:-${QUAY_AC258_PROBE_TIMEOUT_SECS:-30}}"
  local probe_cmd="${QUAY_AC258_WORKER_PROBE_CMD:-$ac258_probe_predicate}"
  local out="" rc=0 remote_guard=""
  # (1) 传输层：ssh 到不到得了。⛔ 与「探测失败」分成两个取值 —— 二者的修法完全不同
  #     （一个是网络/主机名，一个是那台机器上的登录态），而合并它们会让运维照着错的线索查。
  set +e
  out="$(timeout "$timeout_secs" ssh "${ssh_opts[@]}" "$target" 'true' 2>&1)"
  rc=$?
  set -e
  if [ "$rc" = "124" ]; then
    echo "AC258-PREFLIGHT timeout ssh connect exceeded ${timeout_secs}s (target=$target)"
    return 3
  fi
  if [ "$rc" != "0" ]; then
    echo "AC258-PREFLIGHT unreachable ssh rc=$rc (target=$target) ⇒ $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
    return 4
  fi
  # (2) 应用层：在那台机器上真的跑一次探测。⚠️ `bash -ls`（【登录】shell）—— 与远端函数同一条理由：
  #     `claude` 常只装在 ~/.local/bin、且不在非登录 shell 的 PATH 里（非登录 ⇒ NO_CLAUDE 伪影，
  #     硬规则 4b）。`command -v claude` 那道闸只对【缺省谓词】成立 —— 调用方显式换了命令时，被探测
  #     的就是它自己指的那个可执行文件。
  if [ -z "${QUAY_AC258_WORKER_PROBE_CMD:-}" ]; then
    remote_guard='command -v claude >/dev/null 2>&1 || { echo "NO_CLAUDE on the LOGIN shell PATH"; exit 42; }'
  fi
  set +e
  out="$(timeout "$timeout_secs" ssh "${ssh_opts[@]}" "$target" "bash -ls" <<REMOTE_PROBE 2>&1
${remote_guard}
${probe_cmd}
REMOTE_PROBE
)"
  rc=$?
  set -e
  if [ "$rc" = "124" ]; then
    echo "AC258-PREFLIGHT timeout remote probe exceeded ${timeout_secs}s (target=$target, partial: $(printf '%s' "$out" | tail -2 | tr '\n' ' '))"
    return 3
  fi
  if [ "$rc" = "0" ]; then
    echo "AC258-PREFLIGHT usable remote probe exited 0 (target=$target) ⇒ $(printf '%s' "$out" | tail -1)"
    return 0
  fi
  if [ "$rc" = "42" ] || [ "$rc" = "127" ]; then
    echo "AC258-PREFLIGHT absent \`claude\` not on the target's LOGIN-shell PATH (rc=$rc, target=$target) ⇒ $(printf '%s' "$out" | tail -2 | tr '\n' ' ')"
    return 2
  fi
  echo "AC258-PREFLIGHT credentials remote probe exited ${rc} (target=$target) ⇒ $(printf '%s' "$out" | tail -3 | tr '\n' ' ')"
  return 1
}

# ── worker_preflight_every_host — 每个目标机都过一遍探测；任一不过 ⇒ 非 0（调用方据此在 build 前退出）──
# 与 validate_ac258_args 的「一个坏参数不该花一次 develop-tip 构建」同一条纪律：一台起不了 worker 的
# 目标机，既不该花一次构建，更不该让三步破坏性步骤跑起来。
# ⚠️ 逐个 host 都判、⛔ 不短路在第一个失败上：多目标运行时「哪几台过不了」本身就是读数（硬规则 3：枚举）。
worker_preflight_every_host() {
  local hk target out rc fail=0
  for hk in ${hosts}; do
    target="${host_target[$hk]:-}"
    if [ -z "${target}" ] || [ "${target}" = "${hk}" ]; then
      # AC-258 首跑实测的缺陷正是【把 host KEY 当成连接名传下去】⇒ 空查与查错在同一处发生（同 verify_ac258_mode）。
      echo "develop-deliver: ${hk} — host_target lookup unusable (got '${target}') (NOT-EVALUATED)"
      fail=1
      continue
    fi
    set +e
    out="$(ac258_probe_target_worker "${target}" 2>&1)"
    rc=$?
    set -e
    printf 'develop-deliver: %s (%s) worker preflight: %s\n' "${hk}" "${target}" "${out}"
    if [ "${rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — worker preflight FAILED (rc=${rc}, verdict=$(printf '%s' "${out}" | awk '{print $2}')) ⇒ ⛔ 一个破坏性步骤都没有执行（未构建、未 ship、未删键、未装、未 quay-init 重跑）" >&2
      fail=1
    fi
  done
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: ABORTED before any destructive step (worker preflight did not pass on every host — see per-host lines above)" >&2
    return 1
  fi
  return 0
}

# ── selfcheck_worker_preflight — AC-258 前置探测的 hermetic 正/负控制 ────────────────────────────
# 全部走【假 ssh】（临时目录里一个脚本，两个阶段的退出码/输出由 $FAKE_STATE 下的文件决定），
# ⛔ 不碰任何真实主机 —— 但被驱动的是【真的】ac258_probe_target_worker / worker_preflight_every_host，
# 判定逻辑一行都没有复刻（夹具只承担「该判据能被证伪」这一半，硬规则 4 推论三）。
# 五种取值都要真的取到、且互不相同：没有独立取值的判定无法区分「查过且合格」与「没查成」（硬规则 3b）。
selfcheck_worker_preflight() {
  local t rc=0 bin out r=0
  t="$(mktemp -d 2>/dev/null)" || { echo "selfcheck-worker-preflight: tmp-unavailable (夹具造不出 ⇒ 本组读数一律取假)" >&2; return 1; }
  bin="$t/bin"; mkdir -p "$bin" "$t/state"
  cat > "$bin/ssh" <<'FAKESSH'
#!/usr/bin/env bash
# 假 ssh：最后一个参数是 `true` ⇒ 传输阶段；否则 ⇒ 应用（探测）阶段。
# 两阶段的退出码/输出由 $FAKE_STATE 下的文件决定 ⇒ 每一例可控、可复现、⛔ 不依赖真实网络。
state="${FAKE_STATE:?FAKE_STATE must be set}"
last="${!#}"
# 两个阶段【各自】可控（含各自的 sleep）—— 因为「ssh 挂住」与「远端探测挂住」在探测函数里是
# 两条不同的代码路径，只测其中一条会让另一条静默无人守（硬规则 5b）。
if [ "$last" = "true" ]; then
  if [ -f "$state/transport.sleep" ]; then sleep "$(cat "$state/transport.sleep")"; fi
  cat "$state/transport.out" 2>/dev/null || true
  exit "$(cat "$state/transport.rc" 2>/dev/null || echo 0)"
fi
if [ -f "$state/probe.sleep" ]; then sleep "$(cat "$state/probe.sleep")"; fi
cat "$state/probe.out" 2>/dev/null || true
exit "$(cat "$state/probe.rc" 2>/dev/null || echo 0)"
FAKESSH
  chmod +x "$bin/ssh"
  printf '%s\n' "$t" > "$t/marker"

  local -a verd_rc=() verd_word=()
  # 每一例：(名字, transport.rc, probe.rc, 期望退出码, 期望 verdict 词)
  local name want_rc want_word tr_rc pr_rc
  for spec in \
      "unreachable:255:0:4:unreachable" \
      "credentials:0:1:1:credentials" \
      "absent:0:42:2:absent" \
      "usable:0:0:0:usable" ; do
    name="${spec%%:*}"; spec="${spec#*:}"
    tr_rc="${spec%%:*}"; spec="${spec#*:}"
    pr_rc="${spec%%:*}"; spec="${spec#*:}"
    want_rc="${spec%%:*}"; want_word="${spec#*:}"
    : > "$t/state/transport.out"; printf '%s' "$tr_rc" > "$t/state/transport.rc"
    : > "$t/state/probe.out";   printf '%s' "$pr_rc" > "$t/state/probe.rc"
    rm -f "$t/state/transport.sleep" "$t/state/probe.sleep"
    case "$name" in
      unreachable) printf '%s\n' "ssh: connect to host example.invalid port 22: Connection refused" > "$t/state/transport.out" ;;
      credentials) printf '%s\n' "Failed to authenticate: OAuth session expired and could not be refreshed" > "$t/state/probe.out" ;;
      absent)      printf '%s\n' "NO_CLAUDE on the LOGIN shell PATH" > "$t/state/probe.out" ;;
      usable)      printf '%s\n' "ok" > "$t/state/probe.out" ;;
    esac
    set +e
    out="$(PATH="$bin:$PATH" FAKE_STATE="$t/state" ac258_probe_target_worker "example.invalid" 2>&1)"
    r=$?
    set -e
    echo "selfcheck: worker-preflight($name) rc=$r verdict='$(printf '%s' "$out" | awk '{print $2}')' (expect rc=$want_rc verdict=$want_word) — '$(printf '%s' "$out" | cut -c1-100)'"
    [ "$r" = "$want_rc" ] || { echo "selfcheck: worker-preflight FAIL — $name expected rc=$want_rc got $r" >&2; rc=1; }
    [ "$(printf '%s' "$out" | awk '{print $2}')" = "$want_word" ] || { echo "selfcheck: worker-preflight FAIL — $name expected verdict=$want_word" >&2; rc=1; }
    verd_rc+=("$r"); verd_word+=("$(printf '%s' "$out" | awk '{print $2}')")
  done
  # 超时【两条路径各一例】，都走【真的】timeout(1)：假 ssh 先睡 5s、外层预算 1s ⇒ 被 SIGTERM ⇒ rc=124。
  # ⚠️ 只测其中一条会让另一条成为无人守的空白（硬规则 5b：兄弟实例常在同一函数里）—— 而它们确实是
  # 两段不同的代码（传输阶段 vs 应用阶段），失败形态却相同（都是 124）。
  for tstage in transport probe; do
    : > "$t/state/transport.out"; printf '0' > "$t/state/transport.rc"; printf '0' > "$t/state/probe.rc"
    rm -f "$t/state/transport.sleep" "$t/state/probe.sleep"
    printf '5' > "$t/state/${tstage}.sleep"
    set +e
    out="$(PATH="$bin:$PATH" FAKE_STATE="$t/state" QUAY_AC258_PROBE_TIMEOUT_SECS=1 ac258_probe_target_worker "example.invalid" 2>&1)"
    r=$?
    set -e
    echo "selfcheck: worker-preflight(timeout, ${tstage} stage) rc=$r verdict='$(printf '%s' "$out" | awk '{print $2}')' (expect rc=3 verdict=timeout — 挂住 ≠ 到不了，也 ≠ 凭据不可用) — '$(printf '%s' "$out" | cut -c1-90)'"
    [ "$r" = "3" ] || { echo "selfcheck: worker-preflight FAIL — ${tstage}-stage timeout expected rc=3 got $r" >&2; rc=1; }
    [ "$(printf '%s' "$out" | awk '{print $2}')" = "timeout" ] || { echo "selfcheck: worker-preflight FAIL — ${tstage}-stage timeout verdict" >&2; rc=1; }
    # 两阶段的超时信息必须【可区分】（一个说 ssh connect，一个说 remote probe）—— 否则运维照着错的线索查。
    tstage_words="ssh connect"; [ "$tstage" = "probe" ] && tstage_words="remote probe"
    case "$out" in
      *"$tstage_words"*) ;;
      *) echo "selfcheck: worker-preflight FAIL — ${tstage}-stage timeout did not name the stage ('$tstage_words')" >&2; rc=1 ;;
    esac
    verd_rc+=("$r"); verd_word+=("$(printf '%s' "$out" | awk '{print $2}')")
  done
  rm -f "$t/state/transport.sleep" "$t/state/probe.sleep"
  # 五态互不相同（⛔ 「不与探测通过共用同一个结构」）。
  local n_words; n_words="$(printf '%s\n' "${verd_word[@]}" | sort -u | wc -l | tr -d ' ')"
  echo "selfcheck: worker-preflight(verdict vocabulary) distinct=$n_words of ${#verd_word[@]} samples (expect 5 distinct — 五态各有独立取值，⛔ 两条超时路径共用 timeout 是对的：对调用方它们是同一件事)"
  [ "$n_words" = "5" ] || { echo "selfcheck: worker-preflight FAIL — verdicts not distinct" >&2; rc=1; }

  # 任一 host 不过 ⇒ 整体非 0；且【逐个 host 都判】（⛔ 不短路在第一个失败上 —— 多目标运行时
  # 「哪几台过不了」本身就是读数，硬规则 3：枚举，不布尔）。
  local saved_hosts="$hosts" saved_b saved_c lines
  saved_b="${host_target[B]:-}"; saved_c="${host_target[C]:-}"
  hosts="B C"; host_target[B]="host-b.invalid"; host_target[C]="host-c.invalid"
  : > "$t/state/transport.out"; printf '0' > "$t/state/transport.rc"; printf '0' > "$t/state/probe.rc"; printf '%s\n' ok > "$t/state/probe.out"
  set +e
  out="$(PATH="$bin:$PATH" FAKE_STATE="$t/state" worker_preflight_every_host 2>&1)"
  r=$?
  set -e
  lines="$(printf '%s\n' "$out" | grep -c 'worker preflight:')"
  echo "selfcheck: worker-preflight(every-host, all pass) rc=$r hosts-reported=$lines (expect 0/2)"
  [ "$r" = "0" ] || { echo "selfcheck: worker-preflight FAIL — all-pass run returned $r" >&2; rc=1; }
  [ "$lines" = "2" ] || { echo "selfcheck: worker-preflight FAIL — not every host was judged ($lines)" >&2; rc=1; }
  printf '1' > "$t/state/probe.rc"; printf '%s\n' "Failed to authenticate: OAuth session expired" > "$t/state/probe.out"
  set +e
  out="$(PATH="$bin:$PATH" FAKE_STATE="$t/state" worker_preflight_every_host 2>&1)"
  r=$?
  set -e
  lines="$(printf '%s\n' "$out" | grep -c 'worker preflight:')"
  echo "selfcheck: worker-preflight(every-host, one fails) rc=$r hosts-reported=$lines aborted-before-destructive=$([ "$r" != "0" ] && echo 1 || echo 0) (expect non-0/2/1 — 且失败的那台被点名)"
  [ "$r" != "0" ] || { echo "selfcheck: worker-preflight FAIL — a failing host did not abort the run" >&2; rc=1; }
  [ "$lines" = "2" ] || { echo "selfcheck: worker-preflight FAIL — enumeration stopped at the first failure ($lines hosts judged)" >&2; rc=1; }
  case "$out" in *'worker preflight FAILED'*) ;; *) echo "selfcheck: worker-preflight FAIL — the failing host was not named" >&2; rc=1 ;; esac
  hosts="$saved_hosts"; host_target[B]="$saved_b"; host_target[C]="$saved_c"

  # 与 verify-deliver-coldstart.sh 的谓词【逐字互校】：两处是同一件事的两端，漂移了必须红 ——
  # 否则一台机器上「能跑」而另一台上「不能跑」会被读成环境差异，而不是这两份副本已经不一致。
  local pred_here pred_there
  pred_here="$(printf '%s' "$ac258_probe_predicate")"
  pred_there="$(grep -m1 "^AC258_WORKER_PROBE_PREDICATE=" "${SCRIPT_DIR}/verify-deliver-coldstart.sh" 2>/dev/null | sed "s/^AC258_WORKER_PROBE_PREDICATE=//; s/^'//; s/'$//")"
  echo "selfcheck: worker-preflight(predicate single-spelling) here='$pred_here' there='$pred_there' (expect 逐字相同)"
  if [ "$pred_here" != "$pred_there" ]; then
    echo "selfcheck: worker-preflight FAIL — the probe predicate drifted between the two scripts" >&2
    rc=1
  fi
  rm -rf "$t"
  return $rc
}

# ── verify_ac258_mode — GOAL-018-AC-258：user scope 删键重注册 + quay-init 重跑 + 真实 todo→done ──
# 与 verify_ac257_mode 同一组原语（ship_verify_closure / transport_evidence_append /
# check_evidence_completeness），差别在**被测对象**：AC-257 量的是目标【项目级】的安装与 settings 合并
# 语义；本模式量的是目标机 **user scope 的注册本身**（三处枚举的删键 + install_scope=user 的可核形态）。
# ⛔ 因此本模式【不】预先安装：把交付物装到持久前缀这件事本身是被测动作的一部分（删键→重注册的前后
# 读数必须在同一个函数体内取），远端脚本切到 --ac258-user-scope 并自己完成三段。
# 版本号从 tgz 名解析（⛔ 不另写一份版本真源）；持久前缀 = $HOME/.local/opt/quay/<ver>。
# 只取回 ac=GOAL-018-AC-258 那一条记录；没有 ⇒ NOT-EVALUATED + 非 0（硬规则 3b）。
verify_ac258_mode() {
  local build_date local_carrier fail hk target remote_script out remote_rc remote_log remote_evidence evidence_local ck_rc
  build_date="$(git -C "${repo_root}" log -1 --format=%cI "${develop_tip}" 2>/dev/null || echo "")"
  local_carrier="${repo_root}/.quay/productization-verification.jsonl"
  echo "develop-deliver: --verify-ac258 tip=${develop_tip:0:12} build_date=${build_date} target_root=${ac258_root} task=${ac258_task} carrier=${local_carrier}"
  if ! validate_ac258_args; then return 2; fi
  local expected_acs="GOAL-018-AC-258"
  local ac258_ver
  ac258_ver="$(basename "${quay_tgz}")"; ac258_ver="${ac258_ver#quay-}"; ac258_ver="${ac258_ver%.tgz}"
  if [ -z "${ac258_ver}" ]; then
    echo "develop-deliver: --verify-ac258 cannot derive the version from the tgz name ($(basename "${quay_tgz}"))" >&2
    return 2
  fi
  echo "develop-deliver: --verify-ac258 delivery version=${ac258_ver} ⇒ persistent prefix \$HOME/.local/opt/quay/${ac258_ver}"
  fail=0
  for hk in ${hosts}; do
    target="${host_target[$hk]:-}"
    if [ -z "${target}" ] || [ "${target}" = "${hk}" ]; then
      # ⚠️ 后半个条件不是多余的：AC-258 首跑实测的缺陷正是【把 host KEY 当成连接名传下去】
      # （`--ac258-host-fqdn "${hk}"` ⇒ 远端读到 'B' ⇒ 解析不出、模式在门口 NOT-EVALUATED，
      # 而失败形态是「记录没写出来」，与「机制坏了」同形，硬规则 3b）。关联数组查空与查错在同一处
      # 发生，而它们同形 ⇒ 这里一次挡住两个（空 = 未知 host key；等于 key = 传错了对象）。
      echo "develop-deliver: ${hk} — host_target lookup unusable (got '${target}') (NOT-EVALUATED)"
      fail=1
      continue
    fi
    echo "develop-deliver: ${hk} (${target}) — scp verify-deliver-coldstart.sh + its FULL closure + both .tgz + the task body"
    # ⛔ 闭集的单一真相源在 transport_flat_files / transport_node_modules_deps（由 selfcheck 证完整）。
    if ! ship_verify_closure "${target}" "${quay_tgz}" "${qn_tgz}"; then
      echo "develop-deliver: ${hk} (${target}) — scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    # ⚠️ scp 目标写 `~/`，⛔ 不是 `\$HOME/`：现代 scp 走 SFTP 子系统，远端路径不做 shell 展开
    # （AC-257 实测过一次：整个模式在门口 NOT-EVALUATED）。
    if ! scp "${ssh_opts[@]}" "${ac258_task_body}" "${target}:~/ac258-task-body.md" >/dev/null 2>&1; then
      echo "develop-deliver: ${hk} (${target}) — task-body scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    remote_script=$(cat <<REMOTE
$(verify_node_export_for "${hk}")
EV="\${HOME}/quay-verify-ac258-evidence-${develop_tip:0:8}.jsonl"
rm -f "\${EV}"
PREFIX="\${HOME}/.local/opt/quay/${ac258_ver}"
echo "AC258-PERSISTENT-PREFIX \${PREFIX}"
bash "\${HOME}/verify-deliver-coldstart.sh" \
  --ac258-user-scope \
  --target-root "${ac258_root}" \
  --ac258-plugin-root "\${PREFIX}/lib/node_modules/quay/plugin" \
  --ac258-tgz "\${HOME}/$(basename "${quay_tgz}")" \
  --ac258-qn-tgz "\${HOME}/$(basename "${qn_tgz}")" \
  --ac258-prefix "\${PREFIX}" \
  --ac258-task-id "${ac258_task}" \
  --ac258-task-body "\${HOME}/ac258-task-body.md" \
  --ac258-poll-secs "${ac258_poll_secs:-2700}" \
  --ac258-host-fqdn "${host_target[$hk]}" \
  --build-sha "${develop_tip}" \
  --ac89 "\${EV}"
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
    # ⚠️ `bash -ls`（【登录】shell）：本模式要跑 `npm install -g` 的 postinstall，而它调 `claude` 去
    # materialize 插件 —— orangevps 上 `claude` 只装在 ~/.local/bin、且【不在非登录 shell 的 PATH 里】
    # （实测：非登录 ⇒ NO_CLAUDE，`bash -lc` ⇒ /home/yale/.local/bin/claude）。用非登录 shell 会让
    # materialization 整段被跳过 ⇒ installed_plugins.json 永远不出现 scope=user 条目 ⇒ 本 AC 结构上
    # 不可能达成，而失败形态是「记录没写出来」，与「机制坏了」同形（硬规则 3b / 4b）。
    out="$(ssh "${ssh_opts[@]}" "${target}" "bash -ls" <<< "${remote_script}" 2>&1)"
    remote_rc=$?
    set -e
    remote_log="${repo_root}/.quay/verify-ac258-remote-${hk}-${develop_tip:0:8}.log"
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
    evidence_local="${repo_root}/.quay/verify-ac258-evidence-${hk}-${develop_tip:0:8}.jsonl"
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
    if check_evidence_completeness "${evidence_local}" "${expected_acs}"; then ck_rc=0; else ck_rc=$?; fi
    if [ "${ck_rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (declared ac set [${expected_acs}] not present in transported evidence: rc=${ck_rc})"
      fail=1
    else
      echo "develop-deliver: ${hk} (${target}) — declared ac set [${expected_acs}] transported into ${local_carrier} ✓"
    fi
    rm -f "${evidence_local}"
  done
  git -C "${repo_root}" worktree remove --force "${wt}" 2>/dev/null || rm -rf "${wt}"
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: --verify-ac258 FAILED (a host produced no AC-258 record — see per-host lines above)" >&2
    return 1
  fi
  echo "develop-deliver: --verify-ac258 OK — GOAL-018-AC-258 record transported into ${local_carrier}"
  return 0
}

# validate_adr_flip_args — the ONE place that decides whether --target-root / --task-id are usable.
# 与 validate_takeover_args 同一条纪律、同样在 build 之前判（⛔ 一个坏参数不该花一次 develop-tip 构建）：
#   · --target-root 必须是【目标机上的绝对路径】：它在远端解析，相对路径会静默落到远端 $HOME ⇒
#     被取证的是【另一个项目】，而判据侧的 host/project_root 会如实记下那个错的项目。
#   · --task-id 必填：被取证的是【那一条被驱动到 done 的任务】的产出；让脚本去猜（或取最新一条）
#     正是 AC-207 已经踩过的坑（「最新一条提交」= 记账提交）。
validate_adr_flip_args() {
  if [ -z "${adr_flip_root}" ]; then
    echo "develop-deliver: --verify-adr-flip requires --target-root <absolute path ON the remote host of the quay-driven project>" >&2
    return 1
  fi
  case "${adr_flip_root}" in
    /*) ;;
    *) echo "develop-deliver: --verify-adr-flip --target-root must be an ABSOLUTE path on the remote host (got: ${adr_flip_root})" >&2; return 1 ;;
  esac
  if [ -z "${adr_flip_task}" ]; then
    echo "develop-deliver: --verify-adr-flip requires --task-id <the task in THAT project whose driven-out fix the record is about>" >&2
    return 1
  fi
  return 0
}

# ── verify_adr_flip_mode — GOAL-016-AC-248：目标项目自己的 ADR 检查器检出行为的前后翻转 ────────────
# 与 verify_takeover_mode 的区别：那条测「当前 build 能不能干净接管一个停摆项目」，本条测「被 quay 的
# driver 驱动出来的那条修复，能不能让【目标项目自己的】机械检查器从看不见变看见一个工具」——
# 正确性判据由目标项目拥有，quay 只搬运读数（⛔ 不在 quay 侧实现任何等价的 ADR-007 判定）。
# ⛔ 本模式【不驱动】任何任务：被取证的任务是由目标项目自己的 drivers 驱动到 done 的，本模式只读产物。
# 传输面与另两个 verify 模式同形，用的是同一组原语：ship_verify_closure / transport_evidence_append
# （按 (ts,ac,host,project_root) 去重）/ check_evidence_completeness（声明 ac 集合求差）。
verify_adr_flip_mode() {
  local build_date local_carrier fail hk target remote_script out remote_rc remote_log remote_evidence evidence_local ck_rc
  build_date="$(git -C "${repo_root}" log -1 --format=%cI refs/heads/develop 2>/dev/null || echo "")"
  local_carrier="${repo_root}/.quay/productization-verification.jsonl"
  echo "develop-deliver: --verify-adr-flip develop=${develop_tip:0:12} build_date=${build_date} target_root=${adr_flip_root:-<unset>} task_id=${adr_flip_task:-<unset>} carrier=${local_carrier}"
  validate_adr_flip_args || return 2
  # 本次运行【声明要产出】的 ac 种类（⛔ 不硬编码数字，声明的是种类本身）：只有 AC-248 一种。
  local expected_acs="GOAL-016-AC-248"
  fail=0
  for hk in ${hosts}; do
    target="${host_target[$hk]:-}"
    if [ -z "${target}" ]; then
      echo "develop-deliver: ${hk} — unknown host key (NOT-EVALUATED)"
      fail=1
      continue
    fi
    echo "develop-deliver: ${hk} (${target}) — scp verify-deliver-coldstart.sh + its FULL closure (\$SCRIPT_DIR siblings + node_modules deps) + SPEC + both .tgz"
    # ⛔ 闭集的单一真相源在 transport_flat_files / transport_node_modules_deps（由
    # --selfcheck-transport-closure 证完整）；⛔ 不在此处再抄一份清单。
    if ! ship_verify_closure "${target}" "${quay_tgz}" "${qn_tgz}"; then
      echo "develop-deliver: ${hk} (${target}) — scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    remote_script=$(cat <<REMOTE
$(verify_node_export_for "${hk}")
EV="\${HOME}/quay-verify-adrflip-evidence-${develop_tip:0:8}.jsonl"
rm -f "\${EV}"
bash "\${HOME}/verify-deliver-coldstart.sh" \
  --tgz "\${HOME}/$(basename "${quay_tgz}")" \
  --tgz-native "\${HOME}/$(basename "${qn_tgz}")" \
  --build-sha "${develop_tip}" \
  --build-date "${build_date}" \
  --host "${hk}" \
  --ac89 "\${EV}" \
  --spec "\${HOME}/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md" \
  --prefix "\${HOME}/quay-verify-adrflip-${develop_tip:0:8}.npm" \
  --project "quay-verify-adrflip-${develop_tip:0:8}" \
  --root "\${HOME}/quay-verify-adrflip-${develop_tip:0:8}-root" \
  --ac248-adr-flip \
  --target-root "${adr_flip_root}" \
  --task-id "${adr_flip_task}"
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
    remote_log="${repo_root}/.quay/verify-adrflip-remote-${hk}-${develop_tip:0:8}.log"
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
    evidence_local="${repo_root}/.quay/verify-adrflip-evidence-${hk}-${develop_tip:0:8}.jsonl"
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
    # 传输成功 ≠ 产出完整（硬规则 3b 同族：一个「回传了别的东西」的成功与「产出并回传」同形）。
    # ⚠️ if-形（⛔ 不是裸调用 + 下一行 `ck_rc=$?`）：本脚本 set -e，裸调用在非 0 时会让脚本在本行
    #    静默中止 —— 后续那条「NOT-EVALUATED (declared ac set …) 」痕迹与本模式的最终 FAILED 摘要都不会
    #    出现（实测 2026-09-12）。判「缺」必须留下可区分的痕迹，不能与「脚本炸了」同形（硬规则 3b）。
    if check_evidence_completeness "${evidence_local}" "${expected_acs}"; then ck_rc=0; else ck_rc=$?; fi
    if [ "${ck_rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (declared ac set [${expected_acs}] not present in transported evidence: rc=${ck_rc})"
      fail=1
    else
      echo "develop-deliver: ${hk} (${target}) — declared ac set [${expected_acs}] transported into ${local_carrier} ✓"
    fi
    rm -f "${evidence_local}"
  done
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: --verify-adr-flip FAILED (a host produced no AC-248 record — see per-host lines above)" >&2
    return 1
  fi
  echo "develop-deliver: --verify-adr-flip OK — GOAL-016-AC-248 record transported into ${local_carrier}"
  return 0
}

# validate_complete_change_args — 与 validate_adr_flip_args 同一条纪律（同两个共用旋钮，同一组理由）：
#   · --target-root 必须是【目标机上的绝对路径】（相对路径会静默落到远端 $HOME ⇒ 被取证的是另一个项目）；
#   · --task-id 必填（让脚本去猜 / 取最新一条，正是 AC-207 已经踩过的坑）。
validate_complete_change_args() {
  if [ -z "${adr_flip_root}" ]; then
    echo "develop-deliver: --verify-complete-change requires --target-root <absolute path ON the remote host of the quay-driven project>" >&2
    return 1
  fi
  case "${adr_flip_root}" in
    /*) ;;
    *) echo "develop-deliver: --verify-complete-change --target-root must be an ABSOLUTE path on the remote host (got: ${adr_flip_root})" >&2; return 1 ;;
  esac
  if [ -z "${adr_flip_task}" ]; then
    echo "develop-deliver: --verify-complete-change requires --task-id <the task in THAT project whose driven-out complete change the record is about>" >&2
    return 1
  fi
  return 0
}

# ── verify_complete_change_mode — GOAL-016-AC-249：同一任务的改动必须【成套】────────────────────
# 与 verify_adr_flip_mode / verify_takeover_mode 的区别：本条量的是**同一个 task_id 名下全部提交的
# 文件并集**是否**同时**含代码面（`src/`|`scripts/`）与 ADR-007 文档面（含 `ADR-007`|`docs/adr`）。
# ⛔ 与 AC-248 的两条读数绑在【同一次驱动产出】上：两条读的是同一个被驱动任务，各自能独立 pass/fail，
# 记录也各写各的（⛔ 不互相冒充——一个只改 `src/` 的完美修复满足 AC-248、不满足 AC-249）。
# ⛔ 本模式【不驱动】任何任务：被取证的任务由目标项目自己的 drivers 驱动到 done，本模式只读产物。
verify_complete_change_mode() {
  local build_date local_carrier fail hk target remote_script out remote_rc remote_log remote_evidence evidence_local ck_rc
  build_date="$(git -C "${repo_root}" log -1 --format=%cI refs/heads/develop 2>/dev/null || echo "")"
  local_carrier="${repo_root}/.quay/productization-verification.jsonl"
  echo "develop-deliver: --verify-complete-change develop=${develop_tip:0:12} build_date=${build_date} target_root=${adr_flip_root:-<unset>} task_id=${adr_flip_task:-<unset>} carrier=${local_carrier}"
  validate_complete_change_args || return 2
  # 本次运行【声明要产出】的 ac 种类（⛔ 不硬编码数字，声明的是种类本身）：只有 AC-249 一种。
  local expected_acs="GOAL-016-AC-249"
  fail=0
  for hk in ${hosts}; do
    target="${host_target[$hk]:-}"
    if [ -z "${target}" ]; then
      echo "develop-deliver: ${hk} — unknown host key (NOT-EVALUATED)"
      fail=1
      continue
    fi
    echo "develop-deliver: ${hk} (${target}) — scp verify-deliver-coldstart.sh + its FULL closure (\$SCRIPT_DIR siblings + node_modules deps) + SPEC + both .tgz"
    if ! ship_verify_closure "${target}" "${quay_tgz}" "${qn_tgz}"; then
      echo "develop-deliver: ${hk} (${target}) — scp FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    remote_script=$(cat <<REMOTE
$(verify_node_export_for "${hk}")
EV="\${HOME}/quay-verify-completechange-evidence-${develop_tip:0:8}.jsonl"
rm -f "\${EV}"
bash "\${HOME}/verify-deliver-coldstart.sh" \
  --tgz "\${HOME}/$(basename "${quay_tgz}")" \
  --tgz-native "\${HOME}/$(basename "${qn_tgz}")" \
  --build-sha "${develop_tip}" \
  --build-date "${build_date}" \
  --host "${hk}" \
  --ac89 "\${EV}" \
  --spec "\${HOME}/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md" \
  --prefix "\${HOME}/quay-verify-completechange-${develop_tip:0:8}.npm" \
  --project "quay-verify-completechange-${develop_tip:0:8}" \
  --root "\${HOME}/quay-verify-completechange-${develop_tip:0:8}-root" \
  --ac249-complete-change \
  --target-root "${adr_flip_root}" \
  --task-id "${adr_flip_task}"
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
    remote_log="${repo_root}/.quay/verify-completechange-remote-${hk}-${develop_tip:0:8}.log"
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
    evidence_local="${repo_root}/.quay/verify-completechange-evidence-${hk}-${develop_tip:0:8}.jsonl"
    rm -f "${evidence_local}"
    if ! scp "${ssh_opts[@]}" "${target}:${remote_evidence}" "${evidence_local}" >/dev/null 2>&1; then
      echo "develop-deliver: ${hk} (${target}) — evidence scp-back FAILED (NOT-EVALUATED)"
      fail=1
      continue
    fi
    # ⚠️ 证据缺失/不可读/零行 ⇒ transport_evidence_append 自己返回非 0 + NOT-EVALUATED（⛔ 不静默 exit 0）。
    if ! transport_evidence_append "${local_carrier}" "${evidence_local}"; then
      echo "develop-deliver: ${hk} (${target}) — evidence NOT-EVALUATED (no transport)"
      rm -f "${evidence_local}"
      fail=1
      continue
    fi
    # ⚠️ if-形（⛔ 不是裸调用 + 下一行 `ck_rc=$?`）：本脚本 set -e，裸调用在非 0 时会让脚本在本行静默
    #    中止 —— 后续那条 NOT-EVALUATED 痕迹与本模式的最终 FAILED 摘要都不会出现（同 AC-248 实测）。
    if check_evidence_completeness "${evidence_local}" "${expected_acs}"; then ck_rc=0; else ck_rc=$?; fi
    if [ "${ck_rc}" != "0" ]; then
      echo "develop-deliver: ${hk} (${target}) — NOT-EVALUATED (declared ac set [${expected_acs}] not present in transported evidence: rc=${ck_rc})"
      fail=1
    else
      echo "develop-deliver: ${hk} (${target}) — declared ac set [${expected_acs}] transported into ${local_carrier} ✓"
    fi
    rm -f "${evidence_local}"
  done
  if [ "${fail}" -eq 1 ]; then
    echo "develop-deliver: --verify-complete-change FAILED (a host produced no AC-249 record — see per-host lines above)" >&2
    return 1
  fi
  echo "develop-deliver: --verify-complete-change OK — GOAL-016-AC-249 record transported into ${local_carrier}"
  return 0
}

if [ "${verify_complete_change}" -eq 1 ]; then
  # ⛔ 用法错误在 build 之前判（一个坏参数必须只花一次用法错误的代价，⛔ 不是一次 develop-tip 构建）。
  validate_complete_change_args || exit 2
  if ! build_develop_tgz; then
    exit 1
  fi
  verify_complete_change_mode
  exit $?
fi

if [ "${selfcheck_worker_preflight_flag}" -eq 1 ]; then
  selfcheck_worker_preflight
  exit $?
fi

if [ "${verify_ac257}" -eq 1 ]; then
  # ⛔ 用法错误在 build 之前判（一个坏参数必须只花一次用法错误的代价，⛔ 不是一次 develop-tip 构建）。
  validate_ac257_args || exit 2
  # 目标机 worker 可用性前置探测 —— 与上面同一条纪律，且必须【早于任何不可逆的事】。
  # AC-257 与 AC-258 共用同一段步骤序（破坏性的 quay-init 重跑 + 安装排在「真实 todo→done」之前），
  # 所以它也要这一道（gap-ac258-pipeline-destructive-steps-before-worker-preflight 的 DoD 逐字：
  # 「及同族的 --verify-ac257，若共用同一段步骤序」）。
  if ! worker_preflight_every_host; then
    exit 1
  fi
  if ! build_develop_tgz; then
    exit 1
  fi
  verify_ac257_mode
  exit $?
fi

if [ "${verify_ac258}" -eq 1 ]; then
  # ⛔ 用法错误在 build 之前判（一个坏参数必须只花一次用法错误的代价，⛔ 不是一次 develop-tip 构建）。
  validate_ac258_args || exit 2
  # 目标机 worker 可用性前置探测（本 gap 的主对象）—— 位置就是判据：它在 build 之前、在任何 ssh
  # 破坏性动作之前。失败 ⇒ 连交付物都不构建、不 ship，更不碰目标机的三处注册。
  if ! worker_preflight_every_host; then
    exit 1
  fi
  if ! build_develop_tgz; then
    exit 1
  fi
  verify_ac258_mode
  exit $?
fi

if [ "${verify_adr_flip}" -eq 1 ]; then
  # ⛔ 用法错误在 build 之前判（一个坏参数必须只花一次用法错误的代价，⛔ 不是一次 develop-tip 构建）。
  validate_adr_flip_args || exit 2
  if ! build_develop_tgz; then
    exit 1
  fi
  verify_adr_flip_mode
  exit $?
fi

if [ "${verify_takeover}" -eq 1 ]; then
  # ⛔ 用法错误在 build 之前判（一个坏参数必须只花一次用法错误的代价，⛔ 不是一次 develop-tip 构建）。
  validate_takeover_args || exit 2
  if ! build_develop_tgz; then
    exit 1
  fi
  verify_takeover_mode
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
