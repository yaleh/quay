// palindrome.mjs — M28-outcome-eval scenario 3 (native) child A deliverable.
export function isPalindrome(str) {
  const s = String(str ?? "");
  for (let i = 0, j = s.length - 1; i < j; i++, j--) {
    if (s[i] !== s[j]) return false;
  }
  return true;
}
