// app/api/lookup/[symbol]/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";          // force Node runtime (not Edge)
export const dynamic = "force-dynamic";   // always run on server

type Row = { ticker: string; cik: string; name: string };

const SEC_HEADERS_BASE = {
  "User-Agent": process.env.SEC_USER_AGENT || "EDGARCards/1.0 (support@example.com)",
  "Accept": "application/json",
};

function pad10(cik: string | number) {
  const s = String(cik).replace(/\D/g, "");
  return s.padStart(10, "0");
}

// BRK.B, BRK-B => normalized variants
function norms(sym: string): string[] {
  const u = sym.toUpperCase().trim();
  const noDots = u.replace(/\./g, "");
  const dash = u.replace(/\./g, "-");
  const plain = u.replace(/[-.]/g, "");
  return Array.from(new Set([u, dash, noDots, plain, plain])); // keep plain once
}

let CACHE: Row[] | null = null;
let LAST = 0;
const TTL_MS = 60 * 60 * 1000; // 1 hour

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJSON(url: string, headers: Record<string, string>) {
  let err: any = null;
  let delay = 200;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers, cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } catch (e) {
      err = e;
      await sleep(delay);
      delay *= 2;
    }
  }
  throw err || new Error("fetch_failed");
}

async function loadAll(hostHint?: string): Promise<Row[]> {
  const now = Date.now();
  if (CACHE && now - LAST < TTL_MS) return CACHE;

  // add Referer to be nice to SEC
  const SEC_HEADERS = {
    ...SEC_HEADERS_BASE,
    ...(hostHint ? { Referer: `https://${hostHint}` } : {}),
  };

  // 1) company_tickers.json
  const j1 = await fetchJSON("https://www.sec.gov/files/company_tickers.json", SEC_HEADERS);
  const arr1: Row[] = Object.keys(j1).map((k) => ({
    ticker: String(j1[k].ticker || "").toUpperCase(),
    cik: pad10(j1[k].cik_str),
    name: String(j1[k].title || ""),
  }));

  // 2) company_tickers_exchange.json (broader)
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
    // optional; ignore failures
  }

  // merge + de-dupe (by normalized ticker)
  const byPlain = new Map<string, Row>();
  const push = (r: Row) => {
    for (const n of norms(r.ticker)) {
      const key = n.replace(/[-.]/g, "");
      if (!byPlain.has(key)) byPlain.set(key, r);
    }
  };
  arr2.forEach(push);
  arr1.forEach(push);

  CACHE = Array.from(byPlain.values());
  LAST = now;
  return CACHE;
}

export async function GET(req: Request, { params }: { params: { symbol: string } }) {
  try {
    const host = new URL(req.url).host;
    const list = await loadAll(host);
    const q = (params.symbol || "").trim();
    if (!q) return NextResponse.json({ error: "empty_query" }, { status: 400 });

    // Numeric → treat as CIK
    if (/^\d{1,10}$/.test(q)) {
      const cik = pad10(q);
      const hit = list.find((r) => r.cik === cik);
      if (hit) return NextResponse.json(hit);
    }

    const variants = norms(q);
    const qPlainSet = new Set(variants.map((v) => v.replace(/[-.]/g, "")));

    // 1) Ticker exact/normalized
    let hit =
      list.find((x) => {
        const xs = norms(x.ticker).map((v) => v.replace(/[-.]/g, ""));
        return xs.some((v) => qPlainSet.has(v));
      }) || null;

    // 2) Name starts with
    if (!hit) {
      const Q = q.toUpperCase();
      hit = list.find((x) => x.name.toUpperCase().startsWith(Q)) || null;
    }

    // 3) Name contains
    if (!hit) {
      const Q = q.toUpperCase();
      hit = list.find((x) => x.name.toUpperCase().includes(Q)) || null;
    }

    if (!hit) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(hit);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "lookup_failed" }, { status: 500 });
  }
}

