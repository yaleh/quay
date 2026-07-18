// titlecase.mjs — M28-outcome-eval scenario 3 (github) child B deliverable.
export function titleCase(str) {
  return String(str ?? "")
    .split(" ")
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
