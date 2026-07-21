"""Snapshot 6-month daily closes for the rotation universe from Yahoo.
Stdlib-only fetch → tidy CSV (date,symbol,close). Mirrors the Go engine's
universe so the notebook works on the exact same instruments.
"""
import json, time, urllib.request, urllib.parse, csv, sys, os

UNIVERSE = ["SPY","SMH","SOXX","NVDA","AMD","AVGO","SMCI","XLK","MSFT","GOOGL","META","AMZN",
            "XLE","XOP","UNG","FCG","NG=F","URA","URNM","CCJ","VST","CEG","NRG","XLU",
            "XLF","XLV","XLI","XLP","XLY","XLB","XLRE","XLC"]
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

def fetch(sym):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(sym) + "?range=6mo&interval=1d"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.load(r)
    res = d["chart"]["result"][0]
    ts = res["timestamp"]
    close = res["indicators"]["quote"][0]["close"]
    return [(t, c) for t, c in zip(ts, close) if c is not None]

def main():
    rows = []
    for sym in UNIVERSE:
        for attempt in range(3):
            try:
                for t, c in fetch(sym):
                    rows.append((time.strftime("%Y-%m-%d", time.gmtime(t)), sym, round(c, 4)))
                print(f"  {sym}: ok", file=sys.stderr); break
            except Exception as e:
                print(f"  {sym}: retry {attempt} ({e})", file=sys.stderr); time.sleep(1.5)
        time.sleep(0.15)
    out = os.path.join(os.path.dirname(__file__), "closes.csv")
    with open(out, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["date","symbol","close"]); w.writerows(rows)
    print(f"wrote {len(rows)} rows for {len(set(r[1] for r in rows))} symbols -> {out}", file=sys.stderr)

if __name__ == "__main__":
    main()
