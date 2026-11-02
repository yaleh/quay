#!/usr/bin/env node
// runner-grouping-metadata.mjs — single in-process pass over the canonical test glob's EXPANDED
// file list: fs.realpathSync dedup + in-process `@test-group` header read.
// (gap-suite-metadata-query-subprocess-spawn: scripts/test.sh's metadata modes --list-files /
// --list-groups were ~30s each because build_deduped_files spawned `realpath` per file (~550) and
// group_of/check_group_declarations spawned `grep -m1 | awk` per file (~550 more), for ~1100-1600
// subprocess spawns per metadata query. This helper collapses that to ONE node spawn.)
//
// ⛔ THE CLASSIFIER IS NOT IMPLEMENTED HERE (gap-routine-semantic-dedup-scan-runner-grouping-groupof-copy,
// routine `semantic-dedup-scan`, finding `runner-grouping-groupof-copy`, runId
// `semantic-dedup-scan-1791821278116`). This helper used to carry a PRIVATE copy of `groupOf` +
// `failClosed` + the RECOGNIZED set + the NUL/binary detector — a byte-identical body of
// runner-grouping.ts's `classifyFile` cluster. The copy was justified in this header as "the .mjs
// runs as a standalone test.sh child that cannot import the .ts", and that premise is FALSE: the
// child is spawned as
//   node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/runner-grouping-metadata.mjs" …
// (scripts/test.sh build_deduped_files), and type-stripping applies to the IMPORTED `.ts` module
// exactly as it does to an entry — measured `node -e 'import("./plugin/scripts/runner-grouping.ts")'`
// under the flag resolves and runs. So ONE classifier now lives in runner-grouping.ts and this
// helper IMPORTS it; a group reclassification (or a fifth group, or a fail-closed change) can no
// longer land in one module and silently miss the other.
//
// CONTRACT (byte-compatible with scripts/test.sh build_deduped_files + runner-grouping.ts classifyFile):
//   - argv = the bash glob-EXPANDED test files (relative to repo_root — the SAME array bash's
//     `local glob=(...)` produced). Bash does the expansion so the glob stays the ADR-004 single
//     source in scripts/test.sh AND the output order is byte-identical by construction (no glob
//     re-implementation in node to drift).
//   - stdout: one `realpath<TAB>group` line per deduped file, in argv order, first-wins dedup.
//   - group = classifyFile(realpath) — the file's declared `// @test-group <name>`
//     (product|engine|serial|lowconc); an UNDECLARED file defaults to engine (AC7); an UNKNOWN name
//     is FAIL-CLOSED (exit 3), never silently degraded to engine (the r10 dropped-group regression
//     must stay a hard failure); a NUL byte in the first 32 KiB classifies the file engine, never
//     its (unreachable) declaration — GNU grep's binary-file parity, owned by classifyFile.
//     `governance` is RETIRED (gap-retire-governance-group-merge-into-bucket) — no longer a
//     recognized group, so a file still declaring it hits classifyFile's FAIL-CLOSED branch.

import fs from "node:fs";
import { classifyFile } from "./runner-grouping.ts";

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
    out.push(`${rp}\t${classifyFile(rp)}`);
  }
  process.stdout.write(out.length ? out.join("\n") + "\n" : "");
}

main();
