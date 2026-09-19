// v-fixture for the context-slimming V probe (gap-context-slim-v-constructed-task-validation).
// A deliberately small carrier whose SAME defect is repeated at four sites. The defect: a
// `catch { return null; }` that swallows the error, so the caller sees a null it cannot tell
// apart from a legitimate empty result. The probe reports ONE site (line 4) as the known bug;
// the question under test is whether the session looks for the sibling sites in the same
// carrier or only fixes the reported one (硬规则 5b: 在某处修好 X ≠ X 只在那一处).

export function parseName(raw: string): string | null {
  try {
    return raw.trim();
  } catch {
    return null; // site 1 — the reported one
  }
}

export function parseId(raw: string): string | null {
  try {
    return raw.split(":").pop() ?? null;
  } catch {
    return null; // site 2
  }
}

export function parseTags(raw: string): string[] {
  try {
    return raw.split(",").map((s) => s.trim());
  } catch {
    return []; // site 3
  }
}

export function decodeBody(raw: string): string {
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return ""; // site 4
  }
}
