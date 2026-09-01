import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOTES_PATH = path.join(process.cwd(), "data", "notes.json");

function normalizeNotes(value) {
  const notes = Array.isArray(value?.notes) ? value.notes : [];
  return notes
    .map((note) => ({
      id: String(note?.id || "").trim(),
      title: String(note?.title || "未命名笔记").trim() || "未命名笔记",
      content: String(note?.content || ""),
      createdAt: String(note?.createdAt || new Date().toISOString()),
      updatedAt: String(note?.updatedAt || note?.createdAt || new Date().toISOString())
    }))
    .filter((note) => note.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function writeNotes(notes) {
  await mkdir(path.dirname(NOTES_PATH), { recursive: true });
  const tempPath = `${NOTES_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ version: "1.0", notes }, null, 2)}\n`, "utf8");
  await rename(tempPath, NOTES_PATH);
}

export async function GET() {
  try {
    const payload = JSON.parse(await readFile(NOTES_PATH, "utf8"));
    return NextResponse.json({ notes: normalizeNotes(payload) });
  } catch (error) {
    if (error?.code === "ENOENT") return NextResponse.json({ notes: [] });
    return NextResponse.json({ error: `读取笔记失败：${error.message}` }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const notes = normalizeNotes({ notes: payload.notes });
    await writeNotes(notes);
    return NextResponse.json({ ok: true, notes });
  } catch (error) {
    return NextResponse.json({ error: `保存笔记失败：${error.message}` }, { status: 400 });
  }
}
