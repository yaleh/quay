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
// A LATER pass of the same routine (finding `lineof-lineat`, runId
// `semantic-dedup-scan-1790028867335`) found the same pattern again in the position/slice family —
// lineOf / lineAt (11 live copies, 2 names), snippetOf / snippetAt, and the one-line relOf wrapper —
// and those now exist here once too (see the second block at the bottom of this file).
//
// ⛔ What this module deliberately does NOT do: give the three comment/region primitives ONE
// semantics. Two of them strip
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

// ── 位置 / 切片原语（第二轮同族抽库）────────────────────────────────────────────────────────────
//
// PROVENANCE: the semantic-dedup-scan routine's next pass (.quay/routine-findings.jsonl, finding
// `lineof-lineat`, runId `semantic-dedup-scan-1790028867335`, suggestedAction `extract`) found FIVE
// byte-identical 1-based newline counters split across TWO names (lineOf x2 / lineAt x3), with the
// same body reaching ELEVEN live copies repo-wide once the `index`-parameter and brace variants are
// counted — including a PRIVATE unexported one in checker-lib.ts, the very module that already
// exports the code-position primitives these counters feed. The family repeats with snippetOf /
// snippetAt and with the one-line `relOf` wrapper.
//
// ⛔ WHY HERE AND NOT checker-lib.ts (the 判定-side primitives library): checker-lib.test.mjs pins
// that module to FOUR primitives, ALL of them 判定-side (matchAtCommandPosition / buildNonCodeMask /
// enumerativeExistence / hasMatchAtCommandPosition); checker-io.ts records the same reading
// (「先读 checker-lib.test.mjs」) as the reason it stayed out. A line number (or a trimmed line of
// context) is not a judgment — it is a PURE SOURCE-TEXT transform, which is exactly this module's
// declared scope. checker-lib.ts imports lineOf/colOf from here for its own hit reports; the edge is
// one-way (this module imports NOTHING), so no import cycle is created.
//
// ⛔ WHAT IS DELIBERATELY *NOT* UNIFIED (same discipline as the two strippers above): the `snippet`
// family is ONE function with an OPTIONAL width bound, not two. `snippetAt(src, idx, len)` and
// `snippetOf(src, idx)` differed ONLY by a truncation the former applied unconditionally; folding
// them required no semantic choice, because `maxLen = Infinity` reproduces the unbounded body
// exactly. ⛔ `Infinity` rather than a large literal — "big enough on this machine" is a
// host-dependent constant, not an absence of a bound (硬规则 4 推论二).

/** `idx` 在 `src` 里的 1-based 行号（按 `\n` 计数；`lineOf` 与历史名 `lineAt` 是同一个量，
 *  只保留一个名字 —— 两个名字本身就是 finding 报出的「rename signal」）。 */
export function lineOf(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** `idx` 在 `src` 里的 1-based 列号（行内偏移，`\n` 自身记为下一行的第 1 列）。 */
export function colOf(src: string, idx: number): number {
  return idx - src.lastIndexOf("\n", idx);
}

/** `idx` 所在整行的 trimmed 文本（报告里给出命中上下文）。
 *  `maxLen` 给定且该行更长时，截断为前 `maxLen - 3` 个字符 + `...`（总长恰为 `maxLen`）；
 *  不传 = 不截断（`Infinity`，结构性无上限，不是某个"够大"的字面量）。 */
export function snippetOf(src: string, idx: number, maxLen = Infinity): string {
  let start = idx;
  while (start > 0 && src[start - 1] !== "\n") start--;
  let end = idx;
  while (end < src.length && src[end] !== "\n") end++;
  const line = src.slice(start, end).trim();
  return line.length > maxLen ? `${line.slice(0, maxLen - 3)}...` : line;
}
