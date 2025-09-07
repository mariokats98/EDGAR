# EDGAR Filing Cards (Enhanced)

**Features**
- Enter **Ticker OR CIK** (ticker auto-resolves to CIK via small JSON map)
- **Form filters**: 8-K, 10-Q, 10-K, S-1/424B
- **8-K Item badges**: detects *Item 1.01* (Material Agreement) and *Item 5.02* (Executive Change)
- **S-1/424B amount**: extracts largest $ amount as a quick proxy

**Deploy steps (no coding)**
1) Upload this folder to a GitHub repo.
2) In Vercel → New Project → Import repo → add env var:
   - `SEC_USER_AGENT` = `EDGARCards/1.0 (youremail@example.com)`
3) Deploy. Done!

**Local run**
```
npm install
npm run dev
```

**Extend ticker search**
- Edit `data/tickerMap.json`. Add entries like `"BRK.B": "0001067983"` (CIK must be 10-digit, left-padded zeros).

**Notes**
- We fetch company submissions JSON and, for recent items, fetch the primary doc for 8-K/S-1/424B to extract badges/amounts.
- Be mindful of SEC polite usage: keep requests modest, include `User-Agent`.
