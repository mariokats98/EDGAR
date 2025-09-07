// app/api/suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { ticker: string; cik: string; name: string };

const SEC_HEADERS_BASE = {
  "User-Agent": process.env.SEC_USER_AGENT || "EDGARCards/1.0 (support@example.com)",
  Accept: "application/json",
};

const KV_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const KV_KEY = "sec:tickerIndex:v1";
const TTL_SEC = 60 * 60;

function pad10(x: string | number) {
  const s = String(x ?? "").replace(/\D/g, "");
  return s.padStart(10, "0");
}
function norms(sym: string): string[] {
  const u = String(sym || "").toUpperCase().trim();
  const nodots = u.replace(/\./g, "");
  const dash = u.replace(/\./g, "-");
  const plain = u.replace(/[-.]/g, "");
  return Array.from(new Set([u, nodots, dash, plain]));
}

async function kvGet(): Promise<Row[] | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(KV_KEY)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j || typeof j.result !== "string") return null;
  try {
    return JSON.parse(j.result);
  } catch {
    return null;
  }
}
async function kvSet(rows: Row[]): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(`${KV_URL}/set/${encodeURIComponent(KV_KEY)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value: JSON.stringify(rows), EX: TTL_SEC }),
  }).catch(() => {});
}

async function fetchJSON(url: string, headers: Record<string, string>) {
  let delay = 200;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers, cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } catch (e) {
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
    }
  }
  throw new Error("fetch_failed");
}

async function loadIndex(hostHint?: string): Promise<Row[]> {
  const cached = await kvGet();
  if (cached && cached.length) return cached;

  const SEC_HEADERS = {
    ...SEC_HEADERS_BASE,
    ...(hostHint ? { Referer: `https://${hostHint}` } : {}),
  };

  const j1 = await fetchJSON("https://www.sec.gov/files/company_tickers.json", SEC_HEADERS);
  const arr1: Row[] = Object.keys(j1).map((k) => ({
    ticker: String(j1[k].ticker || "").toUpperCase(),
    cik: pad10(j1[k].cik_str),
    name: String(j1[k].title || ""),
  }));

  let arr2: Row[] = [];
  try {
    const j2 = await fetchJSON("https://www.sec.gov/files/company_tickers_exchange.json", SEC_HEADERS);
    if (Array.isArray(j2)) {
      arr2 = j2.map((row: any) => ({
        ticker: String(row.ticker || "").toUpperCase(),
        cik: pad10(row.cik),
        name: String(row.title || ""),
      }));
    }
  } catch {
    // optional
  }

  const byPlain = new Map<string, Row>();
  const push = (r: Row) => {
    for (const n of norms(r.ticker)) {
      const key = n.replace(/[-.]/g, "");
      if (!byPlain.has(key)) byPlain.set(key, r);
    }
  };
  arr2.forEach(push);
  arr1.forEach(push);

  const rows = Array.from(byPlain.values());
  kvSet(rows).catch(() => {});
  return rows;
}

function scoreRow(q: string, row: Row): number {
  const Q = q.toUpperCase().trim();
  const qPlain = Q.replace(/[-.]/g, "");
  const tickerVars = norms(row.ticker).map((v) => v.replace(/[-.]/g, ""));

  if (tickerVars.includes(qPlain)) return 100;             // exact ticker
  if (tickerVars.some((t) => t.startsWith(qPlain))) return 90;
  if (tickerVars.some((t) => t.includes(qPlain))) return 75;

  const nameU = row.name.toUpperCase();
  if (nameU.startsWith(Q)) return 65;
  if (nameU.includes(Q)) return 50;

  return 0;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const host = url.host;
    const q = (url.searchParams.get("q") || "").trim();
    const limitParam = Number(url.searchParams.get("limit") || 200);
    const limit = Math.min(300, Math.max(10, limitParam));

    if (!q) return NextResponse.json({ results: [] });

    const list = await loadIndex(host);
    const Q = q.toUpperCase();

    // 1-letter: return all that start with it (ticker OR name)
    if (Q.length === 1) {
      const starts = list
        .filter((r) => r.ticker.startsWith(Q) || r.name.toUpperCase().startsWith(Q))
        .sort((a, b) => a.ticker.localeCompare(b.ticker))
        .slice(0, limit);
      return NextResponse.json({ results: starts });
    }

    // Ranked search for ticker/name
    const scored = list
      .map((row) => ({ row, s: scoreRow(q, row) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(({ row }) => row);

    return NextResponse.json({ results: scored });
  } catch (e: any) {
    // don't 500 the UI — return empty; dropdown shows "No matches"
    return NextResponse.json({ results: [], error: e?.message || "suggest_failed" }, { status: 200 });
  }
}
