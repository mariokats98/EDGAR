// app/api/lookup/[symbol]/route.ts
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
const TTL_SEC = 60 * 60; // 1 hour

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
  // 1) try cache
  const cached = await kvGet();
  if (cached && cached.length) return cached;

  // 2) fetch fresh
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
    // optional list can fail silently
  }

  // merge + dedupe by plain ticker
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
  // store in cache
  kvSet(rows).catch(() => {});
  return rows;
}

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  try {
    const host = new URL(req.url).host;
    const list = await loadIndex(host);
    const q = (params.symbol || "").trim();
    if (!q) return NextResponse.json({ error: "empty_query" }, { status: 400 });

    // numeric → CIK
    if (/^\d{1,10}$/.test(q)) {
      const cik = pad10(q);
      const hit = list.find((r) => r.cik === cik);
      if (hit) return NextResponse.json(hit);
    }

    const Q = q.toUpperCase();
    const qPlainSet = new Set(norms(Q).map((v) => v.replace(/[-.]/g, "")));

    // 1) ticker exact/variant
    let hit =
      list.find((x) => {
        const xs = norms(x.ticker).map((v) => v.replace(/[-.]/g, ""));
        return xs.some((v) => qPlainSet.has(v));
      }) || null;

    // 2) name starts with
    if (!hit) hit = list.find((x) => x.name.toUpperCase().startsWith(Q)) || null;

    // 3) name contains
    if (!hit) hit = list.find((x) => x.name.toUpperCase().includes(Q)) || null;

    if (!hit) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(hit);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "lookup_failed" }, { status: 500 });
  }
}
