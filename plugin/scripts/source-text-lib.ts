// source-text-lib.ts — the shared PURE source-text primitives for plugin/scripts checkers.
//
// Why this module exists: a semantic-dedup-scan pass (.quay/routine-findings.jsonl, finding
// `firstargregion-stripshellcomments`, routine `semantic-dedup-scan`, runId
// `semantic-dedup-scan-1789322638156`) found two functions that had each been written twice with
// IDENTICAL algorithms, differing only in brace layout / parameter order — the byte-size gap that
// made them look diverged was formatting:
//   firstArgRegion      task-file-bypass-check.ts  / test-isolation-check.ts
//   stripShellComments  adr016-screen-use-check.ts / dead-code-after-return-check.ts
// A 硬规则 5b sweep of the same carrier (`plugin/scripts/*.ts`) then found a third pair of the same
// family, byte-identical down to the body (only the doc comments differed):
//   stripComments       registry-bare-filename-scan.ts / runtime-usage-inventory.ts
// All three now exist here once.
//
// ⛔ What this module deliberately does NOT do: give the three ONE semantics. Two of them strip
// comments of two DIFFERENT languages, and that difference is load-bearing, not cosmetic:
//   • stripShellComments — `#`-to-EOL, quote-aware, and NO block comments. Shell only. It must not
//     be pointed at a .ts file: a `//`-comment or a string literal there survives it
//     (adr016-screen-use-check.ts documents that scoping decision) — a checker that judges the
//     wrong positions returns the "pass" shape (硬规则 3b).
//   • stripComments — slash-slash line comments plus slash-star block comments, deliberately NOT
//     quote-aware; it is retained as a cheap pre-filter for import-specifier scanning,
//     where a string literal containing an import clause is an accepted, documented false positive.
//   • firstArgRegion — not a stripper at all: it walks a mask (buildNonCodeMask, checker-lib.ts)
//     plus a balanced region to locate the FIRST argument span of a call site.
// Collapsing any two would silently change WHICH positions a checker judges. See
// plugin/test/source-text-lib.test.mjs for the control that pins the two strippers apart.

/** Strip shell line comments (`#` to end of line) that are outside single/double quotes. A comment
 *  mentioning `capture-pane | md5sum` must never satisfy the detector (same comment-vs-code
 *  principle as test-framework-policy-check's non-code mask). Heredoc bodies are not fully modeled —
 *  the scan excludes checker-mutation-cases (the only place heredocs embed the anti-pattern), so
 *  the residual risk is accepted and documented. */
export function stripShellComments(src: string): string {
  const out: string[] = [];
  for (const rawLine of src.split("\n")) {
    let inS = false;
    let inD = false;
    let outLine = "";
    for (let i = 0; i < rawLine.length; i++) {
      const c = rawLine[i];
      if (inS) {
        outLine += c;
        if (c === "'") inS = false;
        continue;
      }
      if (inD) {
        outLine += c;
        if (c === "\\") { outLine += rawLine[i + 1] ?? ""; i++; continue; }
        if (c === '"') inD = false;
        continue;
      }
      if (c === "'") { inS = true; outLine += c; continue; }
      if (c === '"') { inD = true; outLine += c; continue; }
      if (c === "#" && (i === 0 || /\s/.test(rawLine[i - 1]))) break; // line comment
      outLine += c;
    }
    out.push(outLine);
  }
  return out.join("\n");
}

/** Remove slash-slash line comments and slash-star block comments. NAIVE BY DESIGN — it is not
 *  quote-aware, so a comment marker inside a string literal is treated as a real comment. Callers
 *  use it only as a pre-filter where that is acceptable (import-specifier extraction: a string
 *  literal containing an import clause is an accepted, documented false positive); for
 *  position-sensitive judgment use checker-lib.ts#buildNonCodeMask, which models strings and regex
 *  literals too.
 *
 *  ⛔ Not a substitute for stripShellComments on bash-syntax `.ts` (e.g. runner-static-gate.ts,
 *  `source`d by scripts/test.sh): a `# @static-object …` line whose glob contains a slash-star
 *  sequence is read as a block-comment start and swallows the following line.
 *  registry-bare-filename-scan.ts's maskComments-based `stripCommentsIncludingHash` is the variant
 *  that handles that case. */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

/** Region [start,end) of the FIRST argument of a call whose `(` is at `openIdx` (`region` = the
 *  balanced-paren span of that call, i.e. `src.slice(openIdx, closeIdx + 1)`; `mask` is
 *  buildNonCodeMask(src) and is indexed ABSOLUTELY). Nested parens/brackets/braces are tracked so a
 *  comma inside them never reads as the argument separator, and masked (string/comment) positions
 *  are skipped so a comma inside a string literal never does either. Returns the span up to the
 *  first top-level comma, or up to the closing paren for a single-argument call. */
export function firstArgRegion(src: string, mask: Uint8Array, openIdx: number, region: string): [number, number] {
  const endBound = openIdx + region.length;
  let depth = 0;
  for (let i = openIdx + 1; i < endBound; i++) {
    if (mask[i] !== 0) continue;
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return [openIdx + 1, i];
      depth--;
    } else if (c === "," && depth === 0) return [openIdx + 1, i];
  }
  return [openIdx + 1, endBound - 1];
}
