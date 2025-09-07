"use client";
import { useEffect, useMemo, useState } from "react";
import tickerMap from "../data/tickerMap.json";

type Filing = {
  cik: string;
  company: string;
  form: string;
  filed_at: string;
  title: string;
  source_url: string;
  primary_doc_url?: string | null;
  items?: string[];
  badges?: string[];
  amount_usd?: number | null;
};

const SAMPLE = ["AAPL","MSFT","AMZN"];

export default function Home() {
  const [input, setInput] = useState("AAPL");         // ticker or CIK
  const [resolvedCik, setResolvedCik] = useState<string>("0000320193");
  const [filings, setFilings] = useState<Filing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [show8K, setShow8K] = useState(true);
  const [show10Q, setShow10Q] = useState(true);
  const [show10K, setShow10K] = useState(true);
  const [showS1, setShowS1] = useState(true);

  function resolveCIKLocalOrNumeric(value: string): string | null {
  const v = value.trim().toUpperCase();
  if (!v) return null;
  if (/^\d{10}$/.test(v)) return v;             // exact CIK
  if (/^\d{1,9}$/.test(v)) return v.padStart(10, "0"); // short numeric -> 10 digits
  // @ts-ignore local map import
  const localMap = (tickerMap as Record<string, string>) || {};
  if (localMap[v]) return localMap[v];          // quick local hit
  return null;                                  // fall back to remote
}

async function fetchFilingsFor(value: string) {
  // Use the async resolver (local → remote SEC lookup)
  const cik = await resolveCIK(value);   // <-- important fix: added "await"
  if (!cik) {
    setError(
      "Ticker/CIK not recognized. Try any ticker (e.g., TSLA, V, BRK.B), a company name (e.g., APPLE), or a 10-digit CIK."
    );
    return;
  }

  setResolvedCik(cik);
  setLoading(true);
  setError(null);

  try {
    const r = await fetch(`/api/filings/${cik}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Failed to fetch filings");
    setFilings(j);
  } catch (e: any) {
    setError(e.message || "Error fetching filings");
  } finally {
    setLoading(false);
  }
}


    setResolvedCik(cik);
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/filings/${cik}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed");
      setFilings(j);
    } catch (e: any) {
      setError(e.message || "Error fetching filings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchFilingsFor("AAPL"); }, []);

  const filtered = useMemo(() => {
    return filings.filter(f => {
      const form = f.form.toUpperCase();
      if (form.startsWith("8-K")) return show8K;
      if (form === "10-Q") return show10Q;
      if (form === "10-K") return show10K;
      if (form.startsWith("S-1") || form.startsWith("424B")) return showS1;
      return true;
    });
  }, [filings, show8K, show10Q, show10K, showS1]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">EDGAR Filing Cards</h1>
          <p className="text-gray-600 text-sm mt-1">
            Enter a <strong>Ticker</strong> (AAPL) or <strong>CIK</strong> (10-digit) to view recent filings.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ticker (AAPL) or CIK (0000320193)"
            className="border bg-white rounded-xl px-3 py-2 w-80"
          />
          <button
            onClick={() => fetchFilingsFor(input)}
            className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Fetching…" : "Fetch"}
          </button>

          <div className="flex gap-2">
            {SAMPLE.map(t => (
              <button key={t}
                onClick={() => { setInput(t); fetchFilingsFor(t); }}
                className="text-xs rounded-full bg-gray-100 px-3 py-1"
                title={(tickerMap as Record<string,string>)[t] || ""}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
          <span className="text-gray-700 font-medium">Filter:</span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={show8K} onChange={e => setShow8K(e.target.checked)} />
            8-K
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={show10Q} onChange={e => setShow10Q(e.target.checked)} />
            10-Q
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={show10K} onChange={e => setShow10K(e.target.checked)} />
            10-K
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showS1} onChange={e => setShowS1(e.target.checked)} />
            S-1 / 424B
          </label>
          <span className="text-gray-500">Resolved CIK: <code>{resolvedCik}</code></span>
        </div>

        {error && <div className="text-red-600 text-sm mb-4">Error: {error}</div>}

        <section className="grid md:grid-cols-2 gap-4">
          {filtered.map((f, i) => (
            <article key={i} className="rounded-2xl bg-white p-4 shadow-sm border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{f.filed_at}</span>
                <span className="text-xs rounded-full bg-gray-100 px-2 py-1">{f.form}</span>
              </div>
              <h3 className="mt-2 font-medium">{f.title}</h3>

              {(f.badges && f.badges.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {f.badges.map((b, idx) => (
                    <span key={idx} className="text-[11px] rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5">
                      {b}
                    </span>
                  ))}
                </div>
              )}

              {(typeof f.amount_usd === "number") && (
                <div className="mt-2 text-sm">
                  <span className="font-semibold">Largest amount: </span>
                  ${ (f.amount_usd/1_000_000).toFixed(1) }M
                </div>
              )}

              {(f.items && f.items.length > 0) && (
                <div className="mt-3 text-xs text-gray-600">
                  <span className="font-semibold">Items:</span> {f.items.join(", ")}
                </div>
              )}

              <div className="mt-4 flex gap-3">
                <a className="text-sm underline" href={f.source_url} target="_blank">Filing index</a>
                {f.primary_doc_url && (
                  <a className="text-sm underline" href={f.primary_doc_url} target="_blank">Primary document</a>
                )}
              </div>
            </article>
          ))}
        </section>

        {!loading && filtered.length === 0 && !error && (
          <p className="text-sm text-gray-600 mt-6">No filings match your filters.</p>
        )}
      </div>
    </main>
  );
}
