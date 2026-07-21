// QN-014 (iteration 6): genuinely exercise the DEFAULT_MAX_ISSUES overflow
// throw path in quay-github's paging logic, which iteration 5 deferred
// (view-model.test.mjs's own header comment: "no live large-repo fixture is
// available to test the throw path without network access"). Rather than
// requiring a real 500+-issue GitHub repo (impractical), the paging/overflow
// loop was extracted (QN-014's Plan) into a standalone, injectable
// `pageIssues({ maxIssues, perPage, fetchPage })` function, tested here with
// a synthetic `fetchPage` — the actual runtime throw is caught and asserted,
// not merely inspected by reading code.
//
// Run: node test/pagination.test.mjs
import { pageIssues } from "../src/github-client.ts";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function mkPage(n) {
  return Array.from({ length: n }, (_, i) => ({ number: i, title: `issue ${i}` }));
}

function main() {
  // --- Case 1: natural end reached before the cap (no throw) ---
  {
    // 3 issues total, perPage 100 -> one short page, well under maxIssues.
    const fetchPage = (page, perPage) => (page === 1 ? mkPage(3) : mkPage(0));
    const issues = pageIssues({ maxIssues: 500, perPage: 100, fetchPage });
    assert(issues.length === 3, "natural end before cap: returns exactly the expected concatenated issues, no throw");
  }

  // --- Case 2: overflow — no natural short page within the cap, throws ---
  {
    // maxIssues=250, perPage=100 -> maxPages = ceil(250/100) = 3 full pages
    // of 100 each = 300 issues fetched, >= 250 cap -> must throw.
    let calls = 0;
    const fetchPage = (page, perPage) => {
      calls++;
      return mkPage(perPage); // always a full page — no natural end
    };
    let threw = null;
    try {
      pageIssues({ maxIssues: 250, perPage: 100, fetchPage });
    } catch (err) {
      threw = err;
    }
    assert(threw !== null, "overflow case: pageIssues genuinely throws when the cap is reached without a natural end (real caught exception, not code inspection)");
    assert(threw && />= 250 issues/.test(threw.message), "overflow error message names the cap that was reached (got: " + (threw && threw.message) + ")");
    assert(threw && /QUAY_GITHUB_MAX_ISSUES/.test(threw.message), "overflow error message mentions the override env var, matching the documented shape");
    assert(calls === 3, "overflow case fetched exactly maxPages pages (3) before detecting overflow, got " + calls);
  }

  // --- Case 3: raised cap avoids the throw for the same synthetic fetcher ---
  {
    // Same "always full page" fetcher as case 2, but now maxIssues is raised
    // enough that a natural short page IS reached before the new cap.
    let pageCount = 0;
    const fetchPage = (page, perPage) => {
      pageCount++;
      if (page <= 4) return mkPage(perPage); // 4 full pages = 400 issues
      return mkPage(0); // then a natural end
    };
    const issues = pageIssues({ maxIssues: 1000, perPage: 100, fetchPage });
    assert(issues.length === 400, "raised cap: same fetcher pattern that overflowed at a lower cap now completes without throwing (got " + issues.length + " issues)");
  }

  console.log(failures === 0 ? "All quay-github pagination tests passed" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
