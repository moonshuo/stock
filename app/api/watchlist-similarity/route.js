import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { normalizeCode } from "../../lib/sectorSystem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATA_ROOT = process.cwd();
const FIVE_MINUTE_DIR = path.join(DATA_ROOT, "5分钟数据");
const STOCK_MAP_PATH = path.join(DATA_ROOT, "data", "stock_sector_map.json");
const MIN_COMPLETE_FILE_SIZE = 1_000_000;

function numberValue(value) {
  const number = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(number) ? number : null;
}

function timeSlot(value) {
  const matched = String(value || "").match(/(?:T|\s)(\d{2}:\d{2})/);
  return matched?.[1] || "";
}

function correlation(left, right) {
  if (left.length < 12 || left.length !== right.length) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let index = 0; index < left.length; index += 1) {
    const x = left[index] - leftMean;
    const y = right[index] - rightMean;
    numerator += x * y;
    leftPower += x * x;
    rightPower += y * y;
  }
  if (!leftPower || !rightPower) return null;
  return numerator / Math.sqrt(leftPower * rightPower);
}

function shiftedCorrelation(leader, follower, shift) {
  const left = [];
  const right = [];
  for (let index = 0; index + shift < leader.length; index += 1) {
    left.push(leader[index]);
    right.push(follower[index + shift]);
  }
  return correlation(left, right);
}

async function latestCompleteFiles(limit = 3) {
  const years = await readdir(FIVE_MINUTE_DIR, { withFileTypes: true });
  const candidates = [];
  for (const year of years.filter((item) => item.isDirectory())) {
    const folder = path.join(FIVE_MINUTE_DIR, year.name);
    const files = await readdir(folder, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !/^\d{8}\.parquet$/.test(file.name)) continue;
      const filePath = path.join(folder, file.name);
      const info = await stat(filePath);
      if (info.size >= MIN_COMPLETE_FILE_SIZE) candidates.push({ filePath, date: file.name.slice(0, 8) });
    }
  }
  return candidates.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

async function loadNames() {
  try {
    const payload = JSON.parse(await readFile(STOCK_MAP_PATH, "utf8"));
    return new Map((payload.stocks || []).map((stock) => [normalizeCode(stock.code), stock.name || ""]));
  } catch {
    return new Map();
  }
}

async function loadProfiles(files) {
  const profiles = new Map();
  for (const { filePath, date } of files) {
    const rows = await parquetReadObjects({ file: await asyncBufferFromFile(filePath) });
    for (const row of rows || []) {
      const code = normalizeCode(row.code);
      const close = numberValue(row.close);
      const slot = timeSlot(row.trade_time);
      if (!/^\d{6}$/.test(code) || !Number.isFinite(close) || close <= 0 || !slot) continue;
      if (!profiles.has(code)) profiles.set(code, new Map());
      const byDay = profiles.get(code);
      if (!byDay.has(date)) byDay.set(date, new Map());
      byDay.get(date).set(slot, close);
    }
  }
  return profiles;
}

async function loadDailyKlines(files) {
  const klines = new Map();
  for (const { filePath, date } of files) {
    const rows = await parquetReadObjects({ file: await asyncBufferFromFile(filePath) });
    const latest = new Map();
    for (const row of rows || []) {
      const code = normalizeCode(row.code);
      const close = numberValue(row.close);
      const open = numberValue(row.open);
      const high = numberValue(row.high);
      const low = numberValue(row.low);
      const preClose = numberValue(row.pre_close);
      const slot = timeSlot(row.trade_time);
      if (!/^\d{6}$/.test(code) || !Number.isFinite(close) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(preClose) || preClose <= 0) continue;
      const previous = latest.get(code);
      if (!previous || slot >= previous.slot) latest.set(code, { slot, open, high, low, close, preClose });
    }
    for (const [code, candle] of latest) {
      if (!klines.has(code)) klines.set(code, new Map());
      klines.get(code).set(date, candle);
    }
  }
  return klines;
}

function buildVector(profile, dates, slotsByDate) {
  const vector = [];
  for (const date of dates) {
    const prices = profile?.get(date);
    const slots = slotsByDate.get(date) || [];
    if (!prices || !slots.length) return null;
    const first = prices.get(slots[0]);
    if (!Number.isFinite(first) || first <= 0) return null;
    for (const slot of slots) {
      const price = prices.get(slot);
      if (!Number.isFinite(price)) return null;
      vector.push((price / first - 1) * 100);
    }
  }
  return vector;
}

function dailyKSimilarity(targetKlines, candidateKlines, dates) {
  const target = [];
  const candidate = [];
  let sharedDays = 0;
  for (const date of dates) {
    const left = targetKlines?.get(date);
    const right = candidateKlines?.get(date);
    if (!left || !right) continue;
    const toShape = (candle) => [
      (candle.close / candle.preClose - 1) * 100,
      (candle.close - candle.open) / candle.preClose * 100,
      (candle.high - Math.max(candle.open, candle.close)) / candle.preClose * 100,
      (Math.min(candle.open, candle.close) - candle.low) / candle.preClose * 100
    ];
    target.push(...toShape(left));
    candidate.push(...toShape(right));
    sharedDays += 1;
  }
  return sharedDays >= 15 ? correlation(target, candidate) : null;
}

function analyzeTarget(code, profiles, dates, dailyKlines, dailyDates, names) {
  const targetProfile = profiles.get(code);
  if (!targetProfile) return { code, error: "完整分时数据中未找到该股票" };
  const slotsByDate = new Map();
  for (const date of dates) {
    const slots = Array.from(targetProfile.get(date)?.keys() || []).sort();
    if (slots.length < 20) return { code, error: "该股票近 3 个完整交易日的分时数据不足" };
    slotsByDate.set(date, slots);
  }
  const targetVector = buildVector(targetProfile, dates, slotsByDate);
  if (!targetVector) return { code, error: "无法构建该股票的分时曲线" };
  const peers = [];
  for (const [candidateCode, profile] of profiles) {
    if (candidateCode === code) continue;
    const candidateVector = buildVector(profile, dates, slotsByDate);
    if (!candidateVector) continue;
    const similarity = correlation(targetVector, candidateVector);
    if (!Number.isFinite(similarity) || similarity < 0.45) continue;
    const dailySimilarity = dailyKSimilarity(dailyKlines.get(code), dailyKlines.get(candidateCode), dailyDates);
    if (!Number.isFinite(dailySimilarity) || dailySimilarity < 0.35) continue;
    const ahead = [1, 2].map((shift) => shiftedCorrelation(targetVector, candidateVector, shift)).filter(Number.isFinite);
    const behind = [1, 2].map((shift) => shiftedCorrelation(candidateVector, targetVector, shift)).filter(Number.isFinite);
    const leadScore = (ahead.reduce((sum, value) => sum + value, 0) / ahead.length) - (behind.reduce((sum, value) => sum + value, 0) / behind.length);
    peers.push({
      code: candidateCode,
      name: names.get(candidateCode) || "",
      minuteSimilarity: Number((similarity * 100).toFixed(1)),
      dailySimilarity: Number((dailySimilarity * 100).toFixed(1)),
      similarity: Number(((similarity * 0.6 + dailySimilarity * 0.4) * 100).toFixed(1)),
      leadScore: Number((leadScore * 100).toFixed(1))
    });
  }
  peers.sort((a, b) => b.similarity - a.similarity);
  const topPeers = peers.slice(0, 3);
  const avgLeadScore = topPeers.length ? topPeers.reduce((sum, peer) => sum + peer.leadScore, 0) / topPeers.length : 0;
  return {
    code,
    name: names.get(code) || "",
    peers: topPeers,
    leader: topPeers.length === 3 && avgLeadScore >= 6,
    leadScore: Number(avgLeadScore.toFixed(1))
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const codes = Array.from(new Set((body.codes || []).map(normalizeCode).filter((code) => /^\d{6}$/.test(code)))).slice(0, 50);
    if (!codes.length) return NextResponse.json({ error: "请先向观察池添加股票" }, { status: 400 });
    const recentFiles = await latestCompleteFiles(20);
    const files = recentFiles.slice(0, 3);
    if (files.length < 3 || recentFiles.length < 15) return NextResponse.json({ error: "本地完整分时或日 K 数据不足" }, { status: 409 });
    const [profiles, dailyKlines, names] = await Promise.all([loadProfiles(files), loadDailyKlines(recentFiles), loadNames()]);
    return NextResponse.json({
      dates: files.map((file) => `${file.date.slice(0, 4)}-${file.date.slice(4, 6)}-${file.date.slice(6, 8)}`),
      dailyDates: recentFiles.map((file) => `${file.date.slice(0, 4)}-${file.date.slice(4, 6)}-${file.date.slice(6, 8)}`),
      results: codes.map((code) => analyzeTarget(code, profiles, files.map((file) => file.date), dailyKlines, recentFiles.map((file) => file.date), names)),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({ error: `观察池联动分析失败：${error.message}` }, { status: 500 });
  }
}
