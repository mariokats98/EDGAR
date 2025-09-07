import { NextResponse } from "next/server";

const SEC_HEADERS = {
  "User-Agent": process.env.SEC_USER_AGENT || "EDGARCards/1.0 (you@example.com)",
  "Accept": "application/json",
};

function pad10(cik: string | number) {
  const s = String(cik).replace(/\D/g, "");
  return s.padStart(10, "0");
}

let CACHE: Array<{ ticker: string; cik: string; name: string }> | null = null;
let LAST_FETCH = 0;

async function loadTickerList() {
  const now = Date.now();
  if (CACHE && now - LAST_FETCH < 1000 * 60 * 60) return CACHE; // 1h cache

  const url = "https://www.sec.gov/files/company_tickers.json";
  const r = await fetch(url, { headers: SEC_HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`SEC ticker list failed (${r.status})`);
  const j = await r.json();

  const out: Array<{ ticker: string; cik: string; name: string }> = [];
  for (const k of Object.keys(j)) {
    const row = j[k];
    out.push({
      ticker: String(row.ticker || "").toUpperCase(),
      cik: pad10(row.cik_str),
      name: String(row.title || ""),
    });
  }
  CACHE = out;
  LAST_FETCH = now;
  return out;
}

export async function GET(
  req: Request,
  { params }: { params: { symbol: string } }
) {
  try {
    const list = await loadTickerList();
    const q = params.symbol.trim().toUpperCase();

    let hit = list.find((x) => x.ticker === q);
    if (!hit) {
      hit = list.find((x) => x.name.toUpperCase().includes(q));
    }

    if (!hit) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ cik: hit.cik, ticker: hit.ticker, name: hit.name });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "lookup_failed" }, { status: 500 });
  }
}
