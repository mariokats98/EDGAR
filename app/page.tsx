"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import tickerMap from "./data/tickerMap.json";

// ----------------- Types -----------------
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

type Suggestion = { ticker: string; cik: string; name: string };

const SAMPLE = ["AAPL", "MSFT", "AMZN"];

// ------------- Helper: resolve CIK -------------
function resolveCIKLocalOrNumeric(value: string): string | null {
  const v = value.trim().toUpperCase();
  if (!v) return null;
  if (/^\d{10}$/.test(v)) return v;                 // exact CIK
  if (/^\d{1,9}$/.test(v)) return v.padStart(10, "0"); // short numeric → 10 digits
  const localMap = (tickerMap as Record<string, string>) || {};
  if (localMap[v]) return localMap[v];              // quick local hit
  return null;                                      // let remote handle
}

async function resolveCIK(value: string): Promise<string | null> {
  const local = resolveCIKLocalOrNumeric(value);
  if (local) return local;
  try {
    const r = await fetch(`/api/lookup/${encodeURIComponent(value)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j.cik || null;
  } catch {
    return null;
  }
}

// ----------------- Page -----------------
export default function Home() {
  // Core state
  const [input, setInput] = useState("AAPL");
  const [resolvedCik, setResolvedCik] = useState<string>("0000320193");
  const [filings, setFilings] = useState<Filing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [show8K, setShow8K] = useState(true);
  const [show10Q, setShow10Q] = useState(true);
  const [show10K, setShow10K] = useState(true);
  const [showS1, setShowS1] = useState(true);

  // Suggestions state (improved)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1); // for keyboard nav

  // Refs to manage blur/click and aborting
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Suggest: debounce + (now) 1-char min + abort prior request
  useEffect(() => {
    const q = input.trim();
    // Reset state if too short
    if (q.length < 1) {
      if (abortRef.current) abortRef.current.abort();
      setSuggestions([]);
      setSuggestLoading(false);
      setActiveIndex(-1);
      setShowSuggest(false);
      return;
    }

    // Debounce
    const id = setTimeout(async () => {
      try {
        // cancel previous request if any
        if (abortRef.current) abortRef.current.abort();
        const ac = new AbortController();
        abortRef.current = ac;

        setSuggestLoading(true);
        const r = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (!r.ok) throw new Error("suggest_failed");
        const j = await r.json();

        setSuggestions(Array.isArray(j.results) ? j.results : []);
        setActiveIndex(-1);
        setShowSuggest(true);
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setSuggestions([]);
          setActiveIndex(-1);
          setShowSuggest(false);
        }
      } finally {
        setSuggestLoading(false);
      }
    }, 250); // 250ms debounce

    return () => {
      clearTimeout(id);
      // don't abort here; next request will abort previous
    };
  }, [input]);

  function onPickSuggestion(s: Suggestion) {
    setInput(s.ticker);
    setShowSuggest(false);
    setActiveIndex(-1);
    fetchFilingsFor(s.ticker);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggest || (suggestions.length === 0 && !suggestLoading)) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => {
        const max = suggestions.length - 1;
        if (max < 0) return -1;
        return prev < max ? prev + 1 : 0;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => {
        const max = suggestions.length - 1;
        if (max < 0) return -1;
        return prev <= 0 ? max : prev - 1;
      });
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        onPickSuggestion(suggestions[activeIndex]);
      } else {
        // no active selection → just fetch current input
        fetchFilingsFor(input);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowSuggest(false);
      setActiveIndex(-1);
    }
  }

  function onInputBlur() {
    // delay closing so clicks on dropdown can register
    if (blurTimeout.current) clearTimeout(blurTimeout.current);
    blurTimeout.current = setTimeout(() => setShowSuggest(false), 120);
  }

  // Fetch filings for ticker/CIK (async)
  async function fetchFilingsFor(value: string) {
    const cik = await resolveCIK(value); // IMPORTANT: await
    if (!cik) {
      setError(
        "Ticker/CIK not recognized. Try any ticker (TSLA, V, BRK.B), a company name (APPLE), or a 10-digit CIK."
      );
      return;
    }
    setResolvedCik(cik);
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/filings/${cik}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to fetch filings");
      setFilings(j);
    } catch (e: any) {
      setError(e?.message || "Error fetching filings");
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    fetchFilingsFor("AAPL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optional: auto-refresh every 60s for current input
  useEffect(() => {
    const id = setInterval(() => {
      fetchFilingsFor(input);
    }, 60000);
    return () => clearInterval(id);
  }, [input]);

  // Filtered view
  const filtered = useMemo(() => {
    return filings.filter((f) => {
      const form = (f.form || "").toUpperCase();
      if (form.startsWith("8-K")) return show8K;
      if (form === "10-Q") return show10Q;
      if (form === "10-K") return show10K;
      if (form.startsWith("S-1") || form.startsWith("424B")) return showS1;
      return true;
    });
  }, [filings, show8K, show10Q, show10K, showS1]);

  // ----------------- UI -----------------
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">EDGAR Filing Cards</h1>
          <p className="text-gray-600 text-sm mt-1">
            Enter a <strong>Ticker</strong> (AAPL/BRK.B), <strong>Company</strong> (APPLE), or <strong>CIK</strong> (10 digits).
          </p>
        </header>

        {/* Search + Suggest */}
        <div className="relative w-full max-w-md mb-3" ref={dropdownRef}>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (e.target.value.trim().length >= 1) setShowSuggest(true);
              }}
              onFocus={() => input.trim().length >= 1 && setShowSuggest(true)}
              onBlur={onInputBlur}
              onKeyDown={onKeyDown}
              placeholder="Ticker (AAPL/BRK.B) • Company (APPLE) • CIK (0000320193)"
              className="border bg-white rounded-xl px-3 py-2 w-full"
            />
            <button
              onClick={() => fetchFilingsFor(input)}
              className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Fetching…" : "Fetch"}
            </button>
          </div>

          {showSuggest && (suggestions.length > 0 || suggestLoading) && (
            <div className="absolute z-20 mt-1 w-full rounded-xl border bg-white shadow-md max-h-72 overflow-auto">
              {suggestLoading && (
                <div className="px-3 py-2 text-sm text-gray-500">Searching…</div>
              )}

              {!suggestLoading &&
                suggestions.map((s, i) => {
                  const active = i === activeIndex;
                  return (
                    <button
                      key={`${s.cik}-${i}`}
                      onMouseDown={(e) => e.preventDefault()} // keep focus while clicking
                      onClick={() => onPickSuggestion(s)}
                      className={`w-full text-left px-3 py-2 ${
                        active ? "bg-gray-100" : "hover:bg-gray-50"
                      }`}
                      title={s.name}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{s.ticker}</span>
                        <span className="text-xs text-gray-500">{s.cik}</span>
                      </div>
                      <div className="text-xs text-gray-600 truncate">{s.name}</div>
                    </button>
                  );
                })}

              {!suggestLoading && suggestions.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
              )}
            </div>
          )}
        </div>

        {/* Quick samples (optional) */}
        <div className="flex gap-2 mb-4">
          {SAMPLE.map((t) => (
            <button
              key={t}
              onClick={() => {
                setInput(t);
                fetchFilingsFor(t);
              }}
              className="text-xs rounded-full bg-gray-100 px-3 py-1"
              title={(tickerMap as Record<string, string>)[t] || ""}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
          <span className="text-gray-700 font-medium">Filter:</span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={show8K} onChange={(e) => setShow8K(e.target.checked)} /> 8-K
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={show10Q} onChange={(e) => setShow10Q(e.target.checked)} /> 10-Q
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={show10K} onChange={(e) => setShow10K(e.target.checked)} /> 10-K
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showS1} onChange={(e) => setShowS1(e.target.checked)} /> S-1 / 424B
          </label>
          <span className="text-gray-500">
            Resolved CIK: <code>{resolvedCik}</code>
          </span>
        </div>

        {error && <div className="text-red-600 text-sm mb-4">Error: {error}</div>}

        {/* Filing cards */}
        <section className="grid md:grid-cols-2 gap-4">
          {filtered.map((f, i) => (
            <article key={i} className="rounded-2xl bg-white p-4 shadow-sm border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{f.filed_at}</span>
                <span className="text-xs rounded-full bg-gray-100 px-2 py-1">{f.form}</span>
              </div>
              <h3 className="mt-2 font-medium">{f.title}</h3>

              {f.badges && f.badges.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {f.badges.map((b, idx) => (
                    <span
                      key={idx}
                      className="text-[11px] rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              )}

              {typeof f.amount_usd === "number" && (
                <div className="mt-2 text-sm">
                  <span className="font-semibold">Largest amount: </span>
                  ${(f.amount_usd / 1_000_000).toFixed(1)}M
                </div>
              )}

              {f.items && f.items.length > 0 && (
                <div className="mt-3 text-xs text-gray-600">
                  <span className="font-semibold">Items:</span> {f.items.join(", ")}
                </div>
              )}

              <div className="mt-4 flex gap-3">
                <a className="text-sm underline" href={f.source_url} target="_blank">
                  Filing index
                </a>
                {f.primary_doc_url && (
                  <a className="text-sm underline" href={f.primary_doc_url} target="_blank">
                    Primary document
                  </a>
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


