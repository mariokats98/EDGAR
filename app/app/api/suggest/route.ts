// app/api/suggest/route.ts
import { NextResponse } from "next/server";

const SEC_HEADERS = {
  "User-Agent": process.env.SEC_USER_AGENT || "EDGARCards/1.0 (you@example.com)",
  "Accept": "application/json",
};

type Row = { ticker: string; cik: string; name: string };

function pad10(cik: string | number) {
  const s = String(cik).replace(/\D/g, "");
  return s.padStart(10, "0");
}

// normalize ticker variants: BRK.B, BRK-B, etc.
function norms(sym: string): string[] {
  const u = sym.toUpperCase().trim();
  const noDots = u.replace(/\./g, "");
  const dash = u.replace(/\./g, "-");
  const plain = u.replace(/[-.]/g, "");
  return Array.from(new Set([u, dash, noDots, plain]));
}

let CACHE: Row[] | null = null;
let LAST = 0;

async function loadAll(): Promise<Row[]> {
  const now = Date.now();
  if (CACHE && now - LAST < 60 * 60 * 1000) return CACHE; // 1h cache

  // 1) Operating companies
  const r1 = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: SEC_HEADERS, cache: "no-store" });
  if (!r1.ok) throw new Error(`ticker list failed ${r1.status}`);
  const j1 = await r1.json(); // { "0": {cik_str, ticker, title}, ... }

  const arr1: Row[] = Object.keys(j1).map((k) => ({
    ticker: String(j1[k].ticker || "").toUpperCase(),
    cik: pad10(j1[k].cik_str),
    name: String(j1[k].title || ""),
  }));

  // 2) Exchange list (broader coverage)
  const r2 = await fetch("https://www.sec.gov/files/company_tickers_exchange.json", { headers: SEC_HEADERS, cache: "no-store" });
  const arr2: Row[] = [];
  if (r2.ok) {
    const j2 = await r2.json(); // array of {cik, ticker, title, exchange}
    for (const row of j2) {
      arr2.push({
        ticker: String(row.ticker || "").toUpperCase(),
        cik: pad10(row.cik),
        name: String(row.title || ""),
      });
    }
  }

  // merge, de-dup by normalized ticker
  const byPlain = new Map<string, Row>();
  const push = (r: Row) => {
    for (const n of norms(r.ticker)) {
      const key = n.replace(/[-.]/g, "");
      if (!byPlain.has(key)) byPlain.set(key, r);
    }
  };
  arr2.forEach(push);
  arr1.forEach(push);

  CACHE = Array.from(new Set(byPlain.values()));
  LAST = now;
  return CACHE;
}

function scoreRow(q: string, row: Row): number {
  const Q = q.toUpperCase().trim();
  const qPlain = Q.replace(/[-.]/g, "");
  const tickerVariants = norms(row.ticker).map((v) => v.replace(/[-.]/g, ""));

  if (tickerVariants.includes(qPlain)) return 100;         // exact ticker
  if (tickerVariants.some((t) => t.startsWith(qPlain))) return 90;
  if (tickerVariants.some((t) => t.includes(qPlain))) return 75;

  const nameU = row.name.toUpperCase();
  if (nameU.startsWith(Q)) return 65;
  if (nameU.includes(Q)) return 50;

  return 0;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const limitParam = Number(url.searchParams.get("limit") || 50);
    const limit = Math.min(100, Math.max(10, limitParam)); // cap to keep it fast

    if (!q) return NextResponse.json({ results: [] });

    const list = await loadAll();
    const Q = q.toUpperCase();

    // ⭐ If only 1 letter typed → return all tickers/names that START WITH that letter
    if (Q.length === 1) {
      const starts = list
        .filter(
          (r) =>
            r.ticker.startsWith(Q) ||
            r.name.toUpperCase().startsWith(Q)
        )
        .sort((a, b) => a.ticker.localeCompare(b.ticker))
        .slice(0, limit);
      return NextResponse.json({ results: starts });
    }

    // Otherwise → ranked search
    const scored = list
      .map((row) => ({ row, s: scoreRow(q, row) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(({ row }) => row);

    return NextResponse.json({ results: scored });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "suggest_failed" }, { status: 500 });
  }
}
