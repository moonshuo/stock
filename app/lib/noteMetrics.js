export function countVisibleNoteCharacters(value = "") {
  const visibleText = String(value)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/#(\d{6}|[A-Za-z*\u4e00-\u9fff]+)#/g, "$1")
    .replace(/\s/g, "");
  return Array.from(visibleText).length;
}
