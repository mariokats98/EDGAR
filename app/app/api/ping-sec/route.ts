// app/api/ping-sec/route.ts
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = process.env.SEC_USER_AGENT || "EDGARCards/1.0 (support@example.com)";

export async function GET() {
  try {
    const url = "https://data.sec.gov/submissions/CIK0000320193.json"; // Apple
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, cache: "no-store" });
    const text = await r.text();
    let sample: any = null;
    try { 
      const j = JSON.parse(text);
      const forms = j?.filings?.recent?.form?.slice(0, 5) || [];
      sample = { forms };
    } catch { /* not JSON */ }

    return NextResponse.json({
      ok: r.ok,
      status: r.status,
      contentType: r.headers.get("content-type"),
      sample
    }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "fetch_failed" }, { status: 200 });
  }
}
