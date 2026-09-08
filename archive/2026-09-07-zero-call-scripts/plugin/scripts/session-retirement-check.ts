// session-retirement-check.ts — AC149-1 会话退役语义断言 (gap-ac149-session-retirement-no-dual-source-no-throughput-collapse).
//
// Criterion (manager-phase-goal.md ### AC149, verbatim):
//   AC149-1（真停）: outer / inner 会话停止；其 cron 锚、tick-log、执行核文档按 AC135/AC141/B9 的
//   同一套写法标退役（删除线 + 指针 + 边界条件）。取假：会话停了而文档仍写「每轮必跑」⇒ 假。
//
// Mechanism:
//   The registry below IS the retired-session contract: for each retired session, the execution-core
//   doc must carry the retirement marker (删除线 + 指针 + 边界条件 — a banner the doc is retired and
//   no longer runs every round) AND must NOT still carry a live "并行对照期 / 每轮必跑" claim that is
//   left un-retired. A doc with the banner removed (marker absent) ⇒ RED (retirement reverted). A doc
//   that still carries a live claim (live marker present) ⇒ RED (the B9 drift shape AC149-1 forbids:
//   the session is stopped but the doc still says "run every round").
//   Matching is positional, not keyword-based: each marker is tied to a specific doc AND a specific
//   judgment (retired banner present vs live claim absent) — a keyword anywhere else does not count.
//
// Run:
//   node --no-warnings --experimental-strip-types plugin/scripts/session-retirement-check.ts --root <repo>

import fs from "node:fs";
import path from "node:path";

interface RetiredSessionDoc {
  session: string;          // "outer" | "inner" — the session that must be retired
  doc: string;              // repo-root-relative execution-core doc that must be marked retired
  retiredMarkers: string[]; // MUST be present (the retirement banner: 删除线 + 指针 + 边界条件)
  liveMarkers: string[];    // MUST be absent (a stale live claim — the "每轮必跑 / 并行对照期" shape)
}

// ── retired-session registry (one entry per retired session's execution-core doc) ──
export const REGISTRY: RetiredSessionDoc[] = [
  {
    session: "outer",
    doc: "orchestration/orchestrator-tick-core.md",
    retiredMarkers: [
      "当前状态：已退役（AC149",
      "本核不再每轮执行",
    ],
    liveMarkers: [
      "当前状态:并行对照期",
    ],
  },
  {
    session: "inner",
    doc: "orchestration/fast-mode-tick-core.md",
    retiredMarkers: [
      "当前状态：已退役（AC149",
      "本核不再每轮执行",
    ],
    liveMarkers: [
      "当前状态:并行对照期",
    ],
  },
];

// ── normalization: strip backticks, collapse whitespace, so banners match across line wraps ──
export function norm(s: string): string {
  return s.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

export function hasMarker(content: string, marker: string): boolean {
  return norm(content).includes(norm(marker));
}

function readFile(root: string, rel: string): string {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

export function runCheck(root: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];

  for (const entry of REGISTRY) {
    const text = readFile(root, entry.doc);

    // A missing doc is its own failure: a retired-session contract that cannot be read is NOT green.
    if (text === "") {
      issues.push(`[${entry.session}] DOC-MISSING: ${entry.doc} not found — cannot verify retirement`);
      continue;
    }

    for (const m of entry.retiredMarkers) {
      if (!hasMarker(text, m)) {
        issues.push(`[${entry.session}] NOT-RETIRED: marker "${m}" ABSENT from ${entry.doc} (retirement banner missing or reverted)`);
      }
    }
    for (const m of entry.liveMarkers) {
      if (hasMarker(text, m)) {
        issues.push(`[${entry.session}] STILL-LIVE: marker "${m}" still present in ${entry.doc} (doc still claims the session runs every round — the B9 drift AC149-1 forbids)`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) root = args[i + 1];
  }
  const { ok, issues } = runCheck(root);
  if (ok) {
    console.log(`session-retirement-check: OK — ${REGISTRY.length} retired session(s) marked (banner present, no stale live claim)`);
    process.exit(0);
  }
  console.error(`session-retirement-check: RED (${issues.length} issue(s))`);
  for (const i of issues) console.error(`  - ${i}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
