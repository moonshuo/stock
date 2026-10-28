export class NoteMutationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "NoteMutationError";
    this.status = status;
  }
}

export function normalizeNotes(value, now = new Date().toISOString()) {
  const notes = Array.isArray(value?.notes) ? value.notes : [];
  return notes
    .map((note) => ({
      id: String(note?.id || "").trim(),
      title: String(note?.title || "未命名笔记").trim() || "未命名笔记",
      content: String(note?.content || ""),
      createdAt: String(note?.createdAt || now),
      updatedAt: String(note?.updatedAt || note?.createdAt || now),
    }))
    .filter((note) => note.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function applyNoteMutation(currentNotes, payload, now = new Date().toISOString()) {
  const notes = normalizeNotes({ notes: currentNotes }, now);
  const action = String(payload?.action || "").trim();

  if (action === "create") {
    const [note] = normalizeNotes({ notes: [{ ...payload.note, createdAt: now, updatedAt: now }] }, now);
    if (!note) throw new NoteMutationError("新建笔记缺少有效 ID");
    if (notes.some((item) => item.id === note.id)) throw new NoteMutationError("笔记 ID 已存在", 409);
    return normalizeNotes({ notes: [note, ...notes] }, now);
  }

  const id = String(payload?.id || "").trim();
  const index = notes.findIndex((note) => note.id === id);
  if (!id || index < 0) throw new NoteMutationError("没有找到要修改的笔记", 404);

  if (action === "update") {
    const next = [...notes];
    next[index] = {
      ...next[index],
      title: String(payload.values?.title || "未命名笔记").trim() || "未命名笔记",
      content: String(payload.values?.content || ""),
      updatedAt: now,
    };
    return normalizeNotes({ notes: next }, now);
  }

  if (action === "delete") return notes.filter((note) => note.id !== id);
  throw new NoteMutationError("不支持的笔记操作");
}
