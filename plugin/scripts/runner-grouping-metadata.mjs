#!/usr/bin/env node
// runner-grouping-metadata.mjs — single in-process pass over the canonical test glob's EXPANDED
// file list: fs.realpathSync dedup + in-process `@test-group` header read.
// (gap-suite-metadata-query-subprocess-spawn: scripts/test.sh's metadata modes --list-files /
// --list-groups were ~30s each because build_deduped_files spawned `realpath` per file (~550) and
// group_of/check_group_declarations spawned `grep -m1 | awk` per file (~550 more), for ~1100-1600
// subprocess spawns per metadata query. This helper collapses that to ONE node spawn.)
//
// CONTRACT (byte-compatible with scripts/test.sh build_deduped_files + runner-grouping.ts group_of):
//   - argv = the bash glob-EXPANDED test files (relative to repo_root — the SAME array bash's
//     `local glob=(...)` produced). Bash does the expansion so the glob stays the ADR-004 single
//     source in scripts/test.sh AND the output order is byte-identical by construction (no glob
//     re-implementation in node to drift).
//   - stdout: one `realpath<TAB>group` line per deduped file, in argv order, first-wins dedup.
//   - group = the file's declared `// @test-group <name>` (product|engine|governance|serial|lowconc);
//     an UNDECLARED file defaults to engine (AC7); an UNKNOWN name is FAIL-CLOSED (exit 3), never
//     silently degraded to engine (the r10 dropped-group regression must stay a hard failure).

import fs from "node:fs";

const RECOGNIZED = new Set(["product", "engine", "governance", "serial", "lowconc"]);

// groupOf(content) — mirror of runner-grouping.ts group_of's grep|awk:
//   grep -m1 -oE '@test-group[[:space:]]+[a-z]+' "$f" | awk '{print $2}'
// The first match of `@test-group` + inline whitespace + a lowercase word; awk's 2nd whitespace
// field is the group name. POSIX [[:space:]] within a grep line == [ \t\v\f\r] (grep reads a line
// at a time, so \n can never be in the matched span). awk's default FS splits on [ \t]+.
function groupOf(content) {
  const m = content.match(/@test-group[ \t\v\f\r]+[a-z]+/);
  if (!m) return "engine";
  const g = m[0].split(/[ \t]+/)[1];
  return g ?? "engine";
}

function failClosed(file, g) {
  process.stderr.write(
    `scripts/test.sh: FAIL-CLOSED: '${file}' declares unknown @test-group '${g}' — a group was dropped or mis-typed (recognized: product|engine|governance|serial|lowconc); refusing to silently degrade it to engine\n`
  );
  process.exit(3);
}

function main() {
  const files = process.argv.slice(2);
  const seen = new Set();
  const out = [];
  for (const f of files) {
    let rp;
    try {
      rp = fs.realpathSync(f);
    } catch {
      continue; // glob-matched but gone between expansion and read — never happens; skip defensively
    }
    if (seen.has(rp)) continue;
    seen.add(rp);
    let buf;
    try {
      buf = fs.readFileSync(rp);
    } catch {
      buf = Buffer.alloc(0); // unreadable → undeclared (grep 2>/dev/null → empty → engine)
    }
    // Replicate GNU grep's BINARY-file detection: grep scans the first 32 KiB buffer for a NUL
    // byte and, on finding one, prints "binary file matches" to STDERR and NOTHING to stdout —
    // so the old group_of saw an empty grep and defaulted the file to engine (observation.test.mjs
    // is the one real case: 8 NUL bytes at byte ~28 KiB inside a `@test-group product` file). This
    // must stay byte-identical: a binary file is classified engine, never its (unreachable) decl.
    if (buf.subarray(0, 32768).includes(0)) {
      out.push(`${rp}\tengine`);
      continue;
    }
    const g = groupOf(buf.toString("utf8"));
    if (!RECOGNIZED.has(g)) failClosed(rp, g);
    out.push(`${rp}\t${g}`);
  }
  process.stdout.write(out.length ? out.join("\n") + "\n" : "");
}

main();
