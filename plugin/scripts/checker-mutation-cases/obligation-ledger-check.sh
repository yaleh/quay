#!/usr/bin/env bash
# Mutation case for obligation-ledger-check (gap-obligation-ledger-mechanization top-level audit).
# Fixture: a correct two-round ledger (derived ids, monotonic age, canClose consistent) → GREEN.
# Inject: flip a round's canClose to true while an obligation is still live+undischarged (the 强行闭轮
# shape) AND hand-write an obligation id (作者写义务集) → the checker MUST go RED.
# Restore: remove both mutations → back to GREEN.
set -u
name="obligation-ledger-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${workdir}"
ledger="${workdir}/obligation-ledger.jsonl"

# ── Fixture: a CORRECT two-round ledger ─────────────────────────────────────────────────────────────
# Round 1: OB-X live (age 1), undischarged ⇒ canClose:false is CORRECT.
cat > "${ledger}" <<'EOF'
{"_kind":"round","round":1,"obligations":[{"id":"OB-X","key":"X","condition":"义务 X","source":"fixture","semantic":false,"live":true,"reading":"r1","first_true_at":1,"ticks_true":1,"discharged_at":null,"discharged_by":null,"defer_reason":null,"unblock_condition":null}],"oldest":{"id":"OB-X","age":1},"ladder":{"escalate":false,"oldest_age":1,"threshold":3},"canClose":false,"at":"t"}
{"_kind":"round","round":2,"obligations":[{"id":"OB-X","key":"X","condition":"义务 X","source":"fixture","semantic":false,"live":true,"reading":"r2","first_true_at":1,"ticks_true":2,"discharged_at":null,"discharged_by":null,"defer_reason":null,"unblock_condition":null}],"oldest":{"id":"OB-X","age":2},"ladder":{"escalate":false,"oldest_age":2,"threshold":3},"canClose":false,"at":"t"}
EOF

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/obligation-ledger-check.ts" --ledger "$1" >/dev/null 2>&1
}

# GREEN baseline: correct ledger → exit 0.
if checker_cmd "${ledger}"; then :; else
  echo "baseline RED on a correct ledger (checker always-red?)" >&2
  exit 4
fi

# ── INJECT 1: 强行闭轮 — round 2 recorded canClose:true while OB-X is live + undischarged ──────────
cp "${ledger}" "${workdir}/mut1.jsonl"
# Rewrite round 2's canClose to true (the violation).
node -e '
const fs=require("fs");
const f=process.argv[1];
const lines=fs.readFileSync(f,"utf8").trim().split("\n").map(JSON.parse);
lines[1].canClose=true;
fs.writeFileSync(f, lines.map((x)=>JSON.stringify(x)).join("\n")+"\n");
' "${workdir}/mut1.jsonl"
if checker_cmd "${workdir}/mut1.jsonl"; then
  echo "STAYED-GREEN — injected canClose:true (强行闭轮) did not redden the checker" >&2
  exit 3
fi

# ── INJECT 2: 作者写义务集 — a hand-written, non-derived obligation id ──────────────────────────────
cp "${ledger}" "${workdir}/mut2.jsonl"
node -e '
const fs=require("fs");
const f=process.argv[1];
const lines=fs.readFileSync(f,"utf8").trim().split("\n").map(JSON.parse);
lines[0].obligations[0].id="OB-HANDWRITTEN"; // derived would be OB-X
fs.writeFileSync(f, lines.map((x)=>JSON.stringify(x)).join("\n")+"\n");
' "${workdir}/mut2.jsonl"
if checker_cmd "${workdir}/mut2.jsonl"; then
  echo "STAYED-GREEN — a hand-written (non-derived) obligation id did not redden the checker" >&2
  exit 3
fi

# ── RESTORE: back to the correct ledger → GREEN ─────────────────────────────────────────────────────
if checker_cmd "${ledger}"; then :; else
  echo "ALWAYS-RED — restored correct ledger still reddens the checker" >&2
  exit 4
fi

exit 0
