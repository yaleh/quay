#!/usr/bin/env bash
# Capture + verify Web UI screenshots for all 19 routes (15 exact routes + 4 detail
# routes from serve-handlers.ts's facade dispatcher) against a RUNNING quay serve.
#
# Reuses the AC100 screenshot flow (google-chrome --headless=new) and the AC119 real-
# HTTP assertion approach (fetch page content, assert status + key element — NOT a
# bare curl 200 probe). Every screenshot is pixel-verified non-blank by
# docs/verify-webui-screenshot.mjs (light Modernist bg + dark text + accent token).
#
# ⛔ Dev-tree serve only: `quay serve --host <ip> --port <p>` from the source tree.
#    Packaged-bundle screenshots are NOT valid until gap-webui-modernist-css-missing-in-tgz
#    lands (packaged build renders without the Modernist CSS).
#
# Usage: docs/capture-webui-screenshots.sh [BASE_URL] [OUT_DIR]
#   BASE_URL defaults to http://127.0.0.1:8123
#   OUT_DIR  defaults to <repo-root>/docs/images
# Requires: curl, google-chrome (headless), node.
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8123}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${2:-$ROOT/docs/images}"
mkdir -p "$OUT_DIR"

CHROME="${CHROME:-google-chrome}"
CHROME_BIN="$(command -v "$CHROME" || true)"
if [[ -z "$CHROME_BIN" ]]; then
  echo "capture-webui-screenshots: google-chrome not found on PATH" >&2
  exit 2
fi

MANIFEST="$OUT_DIR/webui-screenshots.tsv"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/webui-capture.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT
: > "$MANIFEST"
FAILED=0

# Route table: path|slug|assert_type|assert_value
#   assert_type = "redirect" (assert 302 + Location value) or "body" (assert HTTP 200
#                 + the regex/value appears in the fetched body).
ROUTES=(
  "/|webui-root|redirect|/dashboard"
  "/dashboard|webui-dashboard|body|<h1>Dashboard</h1>"
  "/tasks|webui-tasks|body|<h1>Quay — task list"
  "/system|webui-system|body|<h1>System — 系统状态</h1>"
  "/manager|webui-manager|body|<h1>Manager / Outer / Inner — 三层状态</h1>"
  "/tests|webui-tests|body|<h1>Tests — 验证轮记录</h1>"
  "/sessions|webui-sessions|body|<h1>Sessions — Manager / Outer / Inner 最近会话</h1>"
  "/architecture|webui-architecture|body|<h1>Architecture — 系统组件图</h1>"
  "/live|webui-live|body|<h1>Live — 循环此刻在做什么</h1>"
  "/journal|webui-journal|body|<h1>Journal — 循环最近记录</h1>"
  "/git-history|webui-git-history|body|<h1>Git History — 提交落地时间轴</h1>"
  "/board|webui-board|body|<h1>Board — 意图 / 执行 / 落地</h1>"
  "/adr|webui-adr|body|<h1>ADRs"
  "/adr/ADR-016|webui-adr-detail|body|<h1>ADR-016"
  "/goal|webui-goal|body|<h1>Goals — 阶段目标与 AC"
  "/goal/AC-100|webui-goal-detail|body|<h1>AC-100"
  "/doc|webui-doc|body|<h1>Managed documents"
  "/doc/DOC-001|webui-doc-detail|body|<h1>DOC-001"
  "/task/gap-docs-t3-webui-doc-and-screenshots|webui-task-detail|body|<h1>gap-docs-t3-webui-doc-and-screenshots"
)

for entry in "${ROUTES[@]}"; do
  IFS='|' read -r path slug atype aval <<<"$entry"
  png="$OUT_DIR/$slug.png"
  echo "── $path ($slug)"

  # ── 1. Real HTTP assertion (AC119) ─────────────────────────────────────────
  http_ok=0
  case "$atype" in
    redirect)
      # assert 302 + Location header (do NOT follow)
      tmp="$SCRATCH/$slug.headers"
      code=$(curl -s -D "$tmp" -o /dev/null -w "%{http_code}" "$BASE_URL$path")
      loc=$(grep -i '^Location:' "$tmp" | tr -d '\r' | sed 's/^Location: *//i')
      if [[ "$code" == "302" && "$loc" == "$aval" ]]; then http_ok=1; fi
      echo "  http: $code -> Location: $loc (want 302 -> $aval) $([ $http_ok = 1 ] && echo PASS || echo FAIL)"
      ;;
    body)
      body="$SCRATCH/$slug.body.html"
      code=$(curl -s -L -o "$body" -w "%{http_code}" "$BASE_URL$path")
      if [[ "$code" == "200" ]] && grep -qF "$aval" "$body"; then http_ok=1; fi
      hits=$(grep -cF "$aval" "$body" 2>/dev/null || true)
      echo "  http: $code, key element '$aval' hits=$hits $([ $http_ok = 1 ] && echo PASS || echo FAIL)"
      ;;
  esac
  if [[ "$http_ok" != "1" ]]; then
    echo "  ✗ HTTP assertion failed for $path" >&2
    FAILED=1
  fi

  # ── 2. Screenshot (AC100 flow) ─────────────────────────────────────────────
  "$CHROME_BIN" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 \
    --virtual-time-budget=3000 --screenshot="$png" "$BASE_URL$path" >/dev/null 2>&1 \
    || { echo "  ✗ chrome screenshot failed for $path" >&2; FAILED=1; }

  # ── 3. Pixel-verify non-blank (AC100) ──────────────────────────────────────
  if [[ -f "$png" ]]; then
    vresult=$(node "$ROOT/docs/verify-webui-screenshot.mjs" "$png" 2>/dev/null || true)
    if [[ -n "$vresult" ]]; then
      verdict=$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.verdict)' "$vresult" 2>/dev/null || echo "ERR")
      echo "  pixel: $vresult"
      if [[ "$verdict" != "non-blank" ]]; then
        echo "  ✗ pixel-verify BLANK for $path" >&2
        FAILED=1
      fi
    else
      echo "  ✗ pixel-verify could not run for $png" >&2
      FAILED=1
    fi
  else
    echo "  ✗ no screenshot produced for $path" >&2
    FAILED=1
  fi

  printf "%s\t%s\t%s\t%s\t%s\n" "$path" "$slug" "$(basename "$png")" "$atype" "$aval" >> "$MANIFEST"
done

echo ""
echo "Manifest: $MANIFEST ($(wc -l < "$MANIFEST") routes)"
if [[ "$FAILED" = "1" ]]; then
  echo "RESULT: FAIL — some routes did not pass HTTP/pixel assertions" >&2
  exit 1
fi
echo "RESULT: PASS — all routes HTTP-asserted and pixel-verified non-blank"
