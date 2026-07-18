// wordcount.mjs — M28-outcome-eval scenario 2 scratch deliverable.
// Standalone countWords() helper, motivated by the CLI's `task view` output
// printing the raw body with no length/word-count summary. This module does
// NOT modify any product code under packages/ (out of scope for this
// milestone) — it demonstrates the logic as a standalone, tested unit.

export function countWords(text) {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}
