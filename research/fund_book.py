"""Compute Lux's AI-fund book: per-asset-class sleeves with a preferred portfolio,
scored off 6-month daily closes vs SPY. Emits funds.json for the lux.fund view."""
import json, time, urllib.request, urllib.parse, math, os

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
BENCH = "SPY"

SLEEVES = {
    "AI":            ["NVDA","AVGO","AMD","SMH","MSFT","GOOGL","META","AMZN"],
    "Bitcoin":       ["BTC-USD","IBIT","MSTR","COIN","MARA"],
    "Gold":          ["GLD","GC=F","GDX","NEM"],
    "Silver":        ["SLV","SI=F","SIL","PAAS"],
    "Uranium":       ["URA","CCJ","URNM","LEU"],
    "Real estate":   ["VNQ","XLRE","IYR","PLD"],
    "Energy":        ["XLE","XOP","CVX","XOM"],
    "Natural gas":   ["UNG","FCG","NG=F","LNG"],
    "Nuclear power": ["VST","CEG","NRG","SMR"],
    "DeFi":          ["UNI-USD","AAVE-USD","LDO-USD","MKR-USD","ETH-USD"],
}
NAMES = {"NVDA":"Nvidia","AVGO":"Broadcom","AMD":"AMD","SMH":"Semis ETF","MSFT":"Microsoft",
 "GOOGL":"Alphabet","META":"Meta","AMZN":"Amazon","BTC-USD":"Bitcoin","IBIT":"iShares BTC",
 "MSTR":"MicroStrategy","COIN":"Coinbase","MARA":"Marathon","ITA":"Aerospace/Def ETF","LMT":"Lockheed",
 "RTX":"RTX","NOC":"Northrop","GD":"General Dynamics","PLTR":"Palantir","XLE":"Energy ETF","XOP":"E&P ETF",
 "CVX":"Chevron","XOM":"Exxon","URA":"Uranium ETF","CCJ":"Cameco","URNM":"Uranium miners","LEU":"Centrus",
 "UNG":"Natgas fund","FCG":"Natgas producers","NG=F":"Henry Hub","LNG":"Cheniere","VST":"Vistra",
 "CEG":"Constellation","NRG":"NRG","SMR":"NuScale","GLD":"Gold trust","GC=F":"Gold spot","GDX":"Gold miners","NEM":"Newmont",
 "SLV":"Silver trust","SI=F":"Silver spot","SIL":"Silver miners","PAAS":"Pan American","VNQ":"REIT ETF",
 "XLRE":"Real estate ETF","IYR":"US real estate","PLD":"Prologis",
 "UNI-USD":"Uniswap","AAVE-USD":"Aave","LDO-USD":"Lido DAO","MKR-USD":"Maker","ETH-USD":"Ethereum"}

def fetch(sym):
    url="https://query1.finance.yahoo.com/v8/finance/chart/"+urllib.parse.quote(sym)+"?range=6mo&interval=1d"
    with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=15) as r:
        d=json.load(r)
    res=d["chart"]["result"][0]
    return [c for c in res["indicators"]["quote"][0]["close"] if c is not None]

def z(xs):
    n=len(xs)
    if n<2: return 0.0
    m=sum(xs)/n; sd=math.sqrt(sum((v-m)**2 for v in xs)/n)
    return 0.0 if sd==0 else (xs[-1]-m)/sd

def ret(c,n): return (c[-1]/c[-1-n]-1)*100 if len(c)>n else None

syms=sorted({s for v in SLEEVES.values() for s in v} | {BENCH})
px={}
for s in syms:
    for _ in range(3):
        try: px[s]=fetch(s); break
        except Exception: time.sleep(1.2)
    time.sleep(0.12)

bench=px.get(BENCH,[])
def rrg(c):
    n=min(len(c),len(bench))
    if n<40: return None
    a,b=c[-n:],bench[-n:]
    rel=[a[i]/b[i] for i in range(n)]
    # RS-Ratio: trailing z of rel level; RS-Mom: z of 5-day change
    rsr=100+2.5*z(rel[-21:])
    dm=[rel[i]-rel[i-5] for i in range(5,n)]
    rsm=100+2.5*z(dm[-21:])
    return rsr,rsm

def quad(r,m):
    if r>=100 and m>=100: return "leading"
    if r>=100: return "weakening"
    if m>=100: return "improving"
    return "lagging"

STANCE={"improving":"Accumulate","leading":"Core","weakening":"Trim","lagging":"Avoid"}
out=[]
for sleeve,members in SLEEVES.items():
    picks=[]
    for s in members:
        c=px.get(s)
        if not c or len(c)<40: continue
        rr=rrg(c)
        if not rr: continue
        r,m=rr
        picks.append({"symbol":s,"name":NAMES.get(s,s),"rsRatio":round(r,1),"rsMomentum":round(m,1),
                      "quadrant":quad(r,m),"ret21":round(ret(c,21) or 0,1),"ret63":round(ret(c,63) or 0,1)})
    if not picks: continue
    picks.sort(key=lambda p:p["rsMomentum"],reverse=True)
    # preferred portfolio weights within the sleeve: momentum-tilted, sum 100
    conv=[max(0.1,(p["rsMomentum"]-95)) for p in picks]
    tot=sum(conv) or 1
    for p,cv in zip(picks,conv): p["weight"]=round(cv/tot*100,1)
    avg_mom=sum(p["rsMomentum"] for p in picks)/len(picks)
    avg_r63=sum(p["ret63"] for p in picks)/len(picks)
    # sleeve stance from the modal quadrant of top holdings
    topq=picks[0]["quadrant"]
    out.append({"sleeve":sleeve,"stance":STANCE[topq],"quadrant":topq,
                "momentum":round(avg_mom,1),"ret63":round(avg_r63,1),"picks":picks})

out.sort(key=lambda s:s["momentum"],reverse=True)
res={"asOf":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"benchmark":BENCH,"window":"6mo","sleeves":out}
open(os.path.join(os.path.dirname(__file__),"funds.json"),"w").write(json.dumps(res,separators=(",",":")))
print("sleeves:",len(out))
for s in out: print(f"  {s['sleeve']:14s} {s['stance']:11s} mom={s['momentum']:.1f} 3mo={s['ret63']:+.1f}%  top={s['picks'][0]['name']} ({s['picks'][0]['weight']:.0f}%)")
