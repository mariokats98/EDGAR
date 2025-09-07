// app/api/suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";          // force Node runtime
export const dynamic = "force-dynamic";

type Row = { ticker: string; cik: string; name: string };

const SEC_HEADERS_BASE = {
  "User-Agent": process.env.SEC_USER_AGENT || "EDGARCards/1.0 (support@example.com)",
  "Accept": "application/json",
};

function pad10(cik: string | number) {
  const s = String(cik).replace(/\D/g, "");
  return s.padStart(10, "0");
}

function norms(sym: string): string[] {
  const u = sym.toUpperCase().trim();
  const noDots = u.replace(/\./g, "");
  const dash = u.replace(/\./g, "-");
  const plain = u.replace(/[-.]/g, "");
  return Array.from(new Set([u, dash, noDots, plain]));
}

let CACHE: Row[] | null = null;
let LAST = 0;
const TTL_MS = 60 * 60 * 1000;

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
    // optional; ignore failures
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

  CACHE = Array.from(byPlain.values());
  LAST = now;
  return CACHE;
}

function scoreRow(q: string, row: Row): number {
  const Q = q.toUpperCase().trim();
  const qPlain = Q.replace(/[-.]/g, "");
  const tickerVars = norms(row.ticker).map((v) => v.replace(/[-.]/g, ""));

  if (tickerVars.includes(qPlain)) return 100;
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

    const list = await loadAll(host);
    const Q = q.toUpperCase();

    if (Q.length === 1) {
      // show *all* that start with this letter (ticker OR name)
      const starts = list
        .filter((r) => r.ticker.startsWith(Q) || r.name.toUpperCase().startsWith(Q))
        .sort((a, b) => a.ticker.localeCompare(b.ticker))
        .slice(0, limit);
      return NextResponse.json({ results: starts });
    }

    const scored = list
      .map((row) => ({ row, s: scoreRow(q, row) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(({ row }) => row);

    return NextResponse.json({ results: scored });
  } catch (e: any) {
    // Return empty array (not 500) so UI shows "No matches" but stays open
    return NextResponse.json({ results: [], error: e?.message || "suggest_failed" }, { status: 200 });
  }
}
