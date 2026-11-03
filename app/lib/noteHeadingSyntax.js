// A note line can use #1 through #6 as an unambiguous, keyboard-layout-safe
// heading prefix.  It is expanded into the canonical Markdown form before
// rendering or persisting, so the rest of the editor only handles one format.
export function normalizeNumericHeadingPrefixes(value = "") {
  return String(value).split("\n").map((line) => {
    const match = line.match(/^#([1-6])(?:\s(.*)|$)/);
    if (!match) return line;
    return `${"#".repeat(Number(match[1]))} ${match[2] || ""}`;
  }).join("\n");
}
