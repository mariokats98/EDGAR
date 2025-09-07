import { NextResponse } from "next/server";

const DEFAULT_USER_AGENT = "EDGARCards/1.0 (youremail@example.com)";
const SEC_HEADERS = {
  "User-Agent": process.env.SEC_USER_AGENT || DEFAULT_USER_AGENT,
  "Accept": "application/json",
};

function zeroPadCIK(cik: string) {
  return cik.padStart(10, "0");
}

function isHtmlLike(url: string) {
  const u = url.toLowerCase();
  return u.endsWith(".htm") || u.endsWith(".html") || u.endsWith(".txt");
}

function detectItems(text: string) {
  // Use .match() (widely supported) instead of .matchAll()
  const found = text.match(/Item\s+\d{1,2}\.\d{2}/gi) || [];
  const items = Array.from(new Set(found)); // de-dup
  const lower = new Set(items.map(s => s.toLowerCase()));
  const badges: string[] = [];
  if (lower.has("item 1.01")) badges.push("Material Agreement (Item 1.01)");
  if (lower.has("item 5.02")) badges.push("Executive Change (Item 5.02)");
  return { items, badges };
}

function extractLargestAmount(text: string): number | null {
  // Classic RegExp exec loop instead of .matchAll()
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
    if (!r.ok) return NextResponse.json({ error: `SEC fetch failed (${r.status})` }, { status: 502 });
    const data = await r.json();

    const name = data?.name || data?.entityType || "Company";
    const recent = data?.filings?.recent ?? {};
    const n = Math.min(12, (recent?.accessionNumber ?? []).length);
    const out: any[] = [];

    for (let i = 0; i < n; i++) {
      const form = String(recent.form[i] || "");
      const filed_at = recent.filingDate[i];
      const acc = recent.accessionNumber[i]?.replace(/-/g, "");
      const primary = recent.primaryDocument[i];
      const cikNum = parseInt(params.cik, 10);
      const base = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}`;
      const primaryUrl = primary ? `${base}/${primary}` : null;

      let items: string[] = [];
      let badges: string[] = [];
      let amount_usd: number | null = null;

      if (primaryUrl && isHtmlLike(primaryUrl)) {
        try {
          const t = await fetch(primaryUrl, { headers: { "User-Agent": SEC_HEADERS["User-Agent"] as string } });
          if (t.ok) {
            const raw = await t.text();
            const text = raw.replace(/<[^>]+>/g, " "); // basic tag strip for HTML
            if (form.toUpperCase().startsWith("8-K")) {
              const found = detectItems(text);
              items = found.items;
              badges = found.badges;
            }
            if (["S-1","424B1","424B2","424B3","424B4"].includes(form.toUpperCase())) {
              amount_usd = extractLargestAmount(text);
            }
          }
        } catch {}
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

    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
