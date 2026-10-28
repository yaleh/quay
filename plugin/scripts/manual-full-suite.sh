#!/usr/bin/env bash
# manual-full-suite.sh — the ONE manual invocation of the FULL suite, exactly as the loop runs it.
#
# ⛔ NOT `scripts/test.sh`: that skips the heavy partition (heavy files run in the main body at nproc,
#    not in the declared heavy tail), the memory policy and the round record. Use THIS for a faithful
#    full-suite verification.
# This wraps full-suite-runner.ts against the MAIN checkout (default = pwd): the runner auto-provisions
# a one-shot worktree off the current branch, runs the FULL suite (heavy bucket at the declared
# concurrency, memory policy applied, round recorded to <main>/.quay/verification-round.jsonl), and
# tears the worktree down. `--sync` waits for the suite to finish; the exit code reflects pass/fail.
#
# Usage:
#   bash plugin/scripts/manual-full-suite.sh            # the main checkout (the repo root)
#   bash plugin/scripts/manual-full-suite.sh /path      # an explicit root
#
# Footguns already handled by full-suite-runner's design (do NOT "fix" them by hand):
#   • the heavy set is computed from <state-dir>/verification-round.jsonl HISTORY — `--root <main>`
#     gives the production history, so the heavy bucket is real. A scratch state-dir would yield an
#     empty heavy set ⇒ heavy partition OFF (the test.sh trap this wrapper exists to avoid).
#   • state lands in <main>/.quay/ (production) — the same place the loop's rounds land.
set -euo pipefail
root="${1:-$(pwd)}"
exec node --no-warnings --experimental-strip-types "$(dirname "$0")/full-suite-runner.ts" --root "$root" --sync
