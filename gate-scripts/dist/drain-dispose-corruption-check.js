import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/gate-scripts/drain-dispose-corruption-check.ts
import fs from "node:fs";
import { fileURLToPath } from "node:url";
function countRealNewlines(text) {
  if (typeof text !== "string") return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}
function countLiteralEscapes(text) {
  if (typeof text !== "string") return 0;
  const m = text.match(/\\[nt]/g);
  return m ? m.length : 0;
}
function checkBodyIntegrity({ oldLineCount, newText }) {
  const reasons = [];
  const newLineCount = countRealNewlines(newText);
  const literalEscapeCount = countLiteralEscapes(newText);
  if (typeof oldLineCount === "number" && oldLineCount >= 0 && newLineCount < oldLineCount) {
    reasons.push(
      `line-count-shrinkage: DRAIN Dispose is append-only but real line count dropped from ${oldLineCount} to ${newLineCount} \u2014 the write likely replaced the body with corrupted text instead of appending to it.`
    );
  }
  if (literalEscapeCount > newLineCount) {
    reasons.push(
      `literal-escape-sequences: found ${literalEscapeCount} literal "\\n"/"\\t" two-character sequence(s) vs only ${newLineCount} real newline(s) \u2014 this is the confirmed corruption signature (a JSON-escaped body copied through verbatim instead of decoded).`
    );
  }
  return { ok: reasons.length === 0, reasons, newLineCount, literalEscapeCount };
}
function usage() {
  process.stderr.write("Usage: drain-dispose-corruption-check.ts --file <task.md> --min-lines <N>\n");
}
async function main(argv) {
  const args = argv.slice(2);
  let filePath = null;
  let minLines = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file") {
      filePath = args[++i];
      continue;
    }
    if (args[i] === "--min-lines") {
      minLines = Number(args[++i]);
      continue;
    }
    if (args[i] === "--help" || args[i] === "-h") {
      usage();
      return 2;
    }
  }
  if (!filePath || minLines === null || Number.isNaN(minLines)) {
    usage();
    return 2;
  }
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`ERROR: not found: ${filePath}
`);
    return 2;
  }
  let newText;
  try {
    newText = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    process.stderr.write(`ERROR: cannot read ${filePath}: ${e.message}
`);
    return 2;
  }
  const result = checkBodyIntegrity({ oldLineCount: minLines, newText });
  process.stdout.write(JSON.stringify(result) + "\n");
  return result.ok ? 0 : 1;
}
var isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv).then((c) => process.exit(c));
}
export {
  checkBodyIntegrity,
  countLiteralEscapes,
  countRealNewlines,
  main
};
