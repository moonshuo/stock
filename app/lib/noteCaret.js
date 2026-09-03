export function canonicalNoteCaretOffset(rows = [], rowIndex = 0, visibleOffset = 0, headingLevel = 0) {
  if (!rows.length) return 0;
  const safeRowIndex = Math.max(0, Math.min(Number(rowIndex) || 0, rows.length - 1));
  const beforeRows = rows.slice(0, safeRowIndex).join("\n");
  const beforeLength = beforeRows.length + (safeRowIndex ? 1 : 0);
  const safeHeadingLevel = Math.max(0, Number(headingLevel) || 0);
  const headingPrefixLength = safeHeadingLevel + (safeHeadingLevel ? 1 : 0);
  return beforeLength + headingPrefixLength + Math.max(0, Number(visibleOffset) || 0);
}

export function visibleNoteCaretOffset(canonicalPrefix = "") {
  return String(canonicalPrefix).replace(/^#{1,6}\s+/gm, "").length;
}
