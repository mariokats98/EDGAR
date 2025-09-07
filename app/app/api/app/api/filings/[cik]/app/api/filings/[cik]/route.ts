import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_USER_AGENT = "EDGARCards/1.0 (youremail@example.com)";
const SEC_HEADERS = {
  "User-Agent": process.env.SEC_USER_AGENT || DEFAULT_USER_AGENT,
  "Accept": "application/json",
};

function zeroPadCIK(raw: string) {
  const s = String(raw || "").replace(/\D/g, "");
  return s.padStart(10, "0");
}
function isHtmlLike(url: string) {
  const u = url.toLowerCase();
  return u.endsWith(".htm") || u.endsWith(".html") || u.endsWith(".txt");
}
function detectItems(text: string) {
  const found = text.match(/Item\s+\d{1,2}\.\d{2}/gi) || [];
  const items = Array.from(new Set(found));
  const lower = new Set(items.map(s => s.toLowerCase()));
  const badges: string[] = [];
  if (lower.has("item 1.01")) badges.push("Material Agreement (Item 1.01)");
  if (lower.has("item 5.02")) badges.push("Executive Change (Item 5.02)");
  return { items, badges };
}
function extractLargestAmount(text: string): number | null {
  const re = /\$?\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(million|billion|m|bn)?/gi;
  let max: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let num = parseFloat(m[1].replace(/,/g, ""));
    const unit = (m[2] || "").toLowerCase();
    if (unit === "billion" || unit === "bn") num *= 1_000_000_000;
    if (unit === "million" || unit === "m") num *= 1_000_000;
    if (!Number.isFinite(num)) continue;
    if (max === null || num > max) max = num;
  }
  return max;
}

export async function GET(req: Request, { params }: { params: { cik: string } }) {
  try {
    const cik10 = zeroPadCIK(params.cik);
    const url = `https://data.sec.gov/submissions/CIK${cik10}.json`;

    const r = await fetch(url, { headers: SEC_HEADERS, cache: "no-store" });
    const raw = await r.text();

    if (!r.ok) {
      return NextResponse.json(
        { error: `SEC fetch failed`, status: r.status, bodySnippet: raw.slice(0, 200) },
        { status: 502 }
      );
    }

    let data: any;
    try { data = JSON.parse(raw); } 
    catch {
      return NextResponse.json(
        { error: "SEC returned non-JSON", status: r.status, bodySnippet: raw.slice(0, 200) },
        { status: 502 }
      );
    }

    const name = data?.name || data?.entityType || "Company";
    const recent = data?.filings?.recent ?? {};
    const total = Math.min(20, (recent?.accessionNumber ?? []).length || 0);

    if (!total) {
      return NextResponse.json([], { status: 200 });
    }

    const out: any[] = [];
    for (let i = 0; i < total; i++) {
      const form = String(recent.form[i] || "");
      const filed_at = recent.filingDate?.[i] || "";
      const acc = (recent.accessionNumber?.[i] || "").replace(/-/g, "");
      const primary = recent.primaryDocument?.[i] || null;

      // The "Archives" CIK segment is *not* zero-padded.
      const cikNoPad = String(parseInt(cik10, 10));
      const base = `https://www.sec.gov/Archives/edgar/data/${cikNoPad}/${acc}`;
      const primaryUrl = primary ? `${base}/${primary}` : null;

      let items: string[] = [];
      let badges: string[] = [];
      let amount_usd: number | null = null;

      if (primaryUrl && isHtmlLike(primaryUrl)) {
        try {
          const t = await fetch(primaryUrl, { headers: { "User-Agent": SEC_HEADERS["User-Agent"] as string } });
          if (t.ok) {
            const html = await t.text();
            const text = html.replace(/<[^>]+>/g, " ");
            if (form.toUpperCase().startsWith("8-K")) {
              const found = detectItems(text);
              items = found.items;
              badges = found.badges;
            }
            const F = form.toUpperCase();
            if (F.startsWith("S-1") || F.startsWith("424B")) {
              amount_usd = extractLargestAmount(text);
            }
          }
        } catch {
          // ignore doc fetch errors; still return the filing
        }
      }

      out.push({
        cik: cik10,
        company: name,
        form,
        filed_at,
        title: `${name} • ${form} • ${filed_at}`,
        source_url: base,
        primary_doc_url: primaryUrl,
        items,
        badges,
        amount_usd
      });
    }

    return NextResponse.json(out, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
