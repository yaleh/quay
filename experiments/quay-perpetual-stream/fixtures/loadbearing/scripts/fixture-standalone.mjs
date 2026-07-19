// FIXTURE (loadbearing gate) — NOT load-bearing: not imported by anything, not in the fake registry,
// not named as a milestone_counter++ gate. Even though it has no sibling test, the gate must classify
// it N/A (explicitly — never a silent skip). This pins criterion clause 3 of ADR-001 (throwaway /
// one-shot scripts are exempt).
console.log("standalone one-shot fixture — does nothing load-bearing");
