import { copyFile, mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { applyNoteMutation, normalizeNotes, NoteMutationError } from "../../lib/noteStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOTES_PATH = path.join(process.cwd(), "data", "notes.json");
const NOTES_BACKUP_PATH = path.join(process.cwd(), "data", "notes.backup.json");
let mutationQueue = Promise.resolve();

async function readNotes() {
  try {
    return normalizeNotes(JSON.parse(await readFile(NOTES_PATH, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeNotes(notes) {
  await mkdir(path.dirname(NOTES_PATH), { recursive: true });
  try {
    await copyFile(NOTES_PATH, NOTES_BACKUP_PATH);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const tempPath = `${NOTES_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ version: "1.0", notes }, null, 2)}\n`, "utf8");
  await rename(tempPath, NOTES_PATH);
}

function enqueueMutation(operation) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.catch(() => undefined);
  return result;
}

export async function GET() {
  try {
    return NextResponse.json({ notes: await readNotes() });
  } catch (error) {
    return NextResponse.json({ error: `读取笔记失败：${error.message}` }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    return await enqueueMutation(async () => {
      const notes = applyNoteMutation(await readNotes(), payload);
      await writeNotes(notes);
      return NextResponse.json({ ok: true, notes });
    });
  } catch (error) {
    const status = error instanceof NoteMutationError ? error.status : 400;
    return NextResponse.json({ error: `保存笔记失败：${error.message}` }, { status });
  }
}
