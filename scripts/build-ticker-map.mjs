// scripts/build-ticker-map.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../app/data/tickerMap.json");

const UA =
  process.env.SEC_USER_AGENT ||
  "EDGARCards/1.0 (support@example.com)"; // Replace with your real email in Vercel

async function fetchJSON(url) {
  const headers = { "User-Agent": UA, Accept: "application/json" };
  let delay = 250;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers, cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
    }
  }
}

function pad10(x) {
  const s = String(x ?? "").replace(/\D/g, "");
  return s.padStart(10, "0");
}

function norms(sym) {
  const u = String(sym || "").toUpperCase().trim();
  const nodots = u.replace(/\./g, "");
  const dash = u.replace(/\./g, "-");
  const plain = u.replace(/[-.]/g, "");
  return Array.from(new Set([u, dash, nodots, plain]));
}

async function main() {
  console.log("Fetching SEC tickers…");

  // 1) Base SEC list
  const j1 = await fetchJSON("https://www.sec.gov/files/company_tickers.json");
  const arr1 = Object.keys(j1).map((k) => ({
    ticker: String(j1[k].ticker || "").toUpperCase(),
    cik: pad10(j1[k].cik_str),
    name: String(j1[k].title || ""),
  }));

  // 2) Exchange list (adds ADRs, extras)
  let arr2 = [];
  try {
    const j2 = await fetchJSON("https://www.sec.gov/files/company_tickers_exchange.json");
    if (Array.isArray(j2)) {
      arr2 = j2.map((row) => ({
        ticker: String(row.ticker || "").toUpperCase(),
        cik: pad10(row.cik),
        name: String(row.title || ""),
      }));
    }
  } catch {
    console.log("Exchange list unavailable, continuing with base list.");
  }

  // Merge & dedupe
  const byPlain = new Map();
  const push = (r) => {
    for (const n of norms(r.ticker)) {
      const key = n.replace(/[-.]/g, "");
      if (!byPlain.has(key)) byPlain.set(key, { ticker: r.ticker, cik: r.cik });
    }
  };
  arr2.forEach(push);
  arr1.forEach(push);

  const map = {};
  for (const { ticker, cik } of byPlain.values()) {
    map[ticker] = cik;
    if (ticker.includes(".")) {
      map[ticker.replace(/\./g, "-")] = cik; // BRK-B
      map[ticker.replace(/\./g, "")] = cik;  // BRKB
    } else if (ticker.includes("-")) {
      map[ticker.replace(/-/g, ".")] = cik;  // BRK.B
      map[ticker.replace(/-/g, "")] = cik;   // BRKB
    }
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(map, null, 2));

  console.log(`✅ Wrote ${Object.keys(map).length} tickers to app/data/tickerMap.json`);
}

main().catch((e) => {
  console.error("❌ Failed:", e?.message || e);
  process.exit(1);
});
