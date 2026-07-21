# %% [markdown]
# # Hanzo Notebook — The Rotation Model
#
# A reproducible, numpy/scipy reference implementation of the sector-rotation model
# that powers `world.hanzo.ai` and `lux.fund`. It formalises the **Relative
# Rotation Graph (RRG)** the production Go engine computes (`internal/world/
# handlers_rotation.go`), reproduces the current read, derives the **Lux Book**
# (the top-10 model allocation), and **backtests** the core thesis: *rotate out of
# leadership that is topping (Weakening) and into laggards that are turning up
# (Improving)*.
#
# Data: 6-month daily closes for the 32-symbol universe (`data/closes.csv`),
# snapshotted from Yahoo — the exact instruments the engine scores.
#
# > Research artifact. Model output, not investment advice.

# %%
import os
import numpy as np
import pandas as pd
from scipy import stats
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else "."
DATA = os.path.join(HERE, "data", "closes.csv")

BENCHMARK = "SPY"
LEVEL_WINDOW = 21   # ~1mo trailing window for the RS-Ratio z-score
MOM_LOOKBACK = 5    # ~1wk change for RS-Momentum
SPREAD = 2.5        # z -> RRG-unit spread around 100 (cosmetic; sign is what matters)

# Theme baskets — identical to the Go engine's universe.
THEMES = {
    "AI · Semis":      ("AI buildout",   ["SMH", "SOXX", "NVDA", "AMD", "AVGO", "SMCI"]),
    "Hyperscalers":    ("AI buildout",   ["XLK", "MSFT", "GOOGL", "META", "AMZN"]),
    "Energy":          ("Energy complex", ["XLE", "XOP"]),
    "Natural gas":     ("Energy complex", ["UNG", "FCG", "NG=F"]),
    "Uranium":         ("Energy complex", ["URA", "URNM", "CCJ"]),
    "Nuclear power":   ("Energy complex", ["VST", "CEG", "NRG", "XLU"]),
    "Financials":      ("Sectors", ["XLF"]),
    "Health care":     ("Sectors", ["XLV"]),
    "Industrials":     ("Sectors", ["XLI"]),
    "Staples":         ("Sectors", ["XLP"]),
    "Discretionary":   ("Sectors", ["XLY"]),
    "Materials":       ("Sectors", ["XLB"]),
    "Real estate":     ("Sectors", ["XLRE"]),
    "Communications":  ("Sectors", ["XLC"]),
}

# %% [markdown]
# ## 1. Load the universe
# Long CSV → a wide close matrix (dates × symbols), forward-filled across the small
# calendar gaps that differ between US equities and the NG=F futures contract.

# %%
raw = pd.read_csv(DATA, parse_dates=["date"])
px = raw.pivot(index="date", columns="symbol", values="close").sort_index()
# Forward-fill the small calendar gaps (NG=F futures trade a slightly different
# calendar than US equities), then intersect to the fully-populated window — a
# leading row where any symbol has not started yet is NaN and would poison its
# basket's first index value. This mirrors the engine right-aligning each pair.
px = px.ffill().dropna(how="any")
print(f"universe: {px.shape[1]} symbols × {px.shape[0]} trading days "
      f"({px.index[0].date()} → {px.index[-1].date()})")
px.tail(3)[[BENCHMARK, "SMH", "URA", "NG=F"]]

# %% [markdown]
# ## 2. The RRG kernel (numpy)
# The relative-strength line is `asset / benchmark`. **RS-Ratio** is that line's
# trailing z-score (is the theme out- or under-performing its own recent norm);
# **RS-Momentum** is the trailing z-score of the *short change* in RS-Ratio (is that
# relative strength accelerating or rolling over). Both are centred at 100. The
# quadrant is decided by the two signs — exactly the Go engine's classification.

# %%
def basket_synthetic(closes: pd.DataFrame) -> pd.Series:
    """Equal-weight synthetic: each member indexed to 100 at the window start."""
    idx = closes / closes.iloc[0] * 100.0
    return idx.mean(axis=1)

def trailing_z(x: np.ndarray, window: int) -> np.ndarray:
    """z-score of x[i] within the trailing `window` ending at i."""
    s = pd.Series(x)
    mean = s.rolling(window, min_periods=2).mean()
    std = s.rolling(window, min_periods=2).std(ddof=0)
    z = (s - mean) / std.replace(0, np.nan)
    return z.fillna(0.0).to_numpy()

def rrg(rel: np.ndarray):
    """Relative-strength line → (RS-Ratio, RS-Momentum) series centred at 100."""
    rsr = 100 + SPREAD * trailing_z(rel, LEVEL_WINDOW)
    dm = np.full_like(rsr, np.nan)
    dm[MOM_LOOKBACK:] = rsr[MOM_LOOKBACK:] - rsr[:-MOM_LOOKBACK]
    rsm = 100 + SPREAD * trailing_z(np.nan_to_num(dm), LEVEL_WINDOW)
    return rsr, rsm

def quadrant(ratio: float, mom: float) -> str:
    if ratio >= 100 and mom >= 100: return "leading"
    if ratio >= 100:                return "weakening"
    if mom >= 100:                  return "improving"
    return "lagging"

# Build each theme's synthetic and its RRG track.
bench = px[BENCHMARK]
tracks = {}
for name, (group, members) in THEMES.items():
    have = [m for m in members if m in px.columns]
    synth = basket_synthetic(px[have])
    rel = (synth / bench).to_numpy()
    rsr, rsm = rrg(rel)
    tracks[name] = dict(group=group, synth=synth, rsr=rsr, rsm=rsm,
                        ratio=rsr[-1], mom=rsm[-1], quadrant=quadrant(rsr[-1], rsm[-1]))

# %% [markdown]
# ## 3. The current read
# Ranked by forward relative momentum — the same leaderboard the panel renders.

# %%
def pct_return(s: pd.Series, n: int) -> float:
    if len(s) <= n: return np.nan
    return (s.iloc[-1] / s.iloc[-1 - n] - 1) * 100

rows = []
for name, t in tracks.items():
    rows.append(dict(theme=name, group=t["group"], quadrant=t["quadrant"],
                     RS_Ratio=round(t["ratio"], 1), RS_Mom=round(t["mom"], 1),
                     ret_1mo=round(pct_return(t["synth"], 21), 1),
                     ret_3mo=round(pct_return(t["synth"], 63), 1)))
read = pd.DataFrame(rows).sort_values("RS_Mom", ascending=False).reset_index(drop=True)
print(read.to_string(index=False))

# %% [markdown]
# ## 4. Thesis signals
# **Distribution** = a leader (RS-Ratio ≥ 100) rolling over (RS-Momentum < 100).
# **Accumulation** = a laggard (RS-Ratio < 100) turning up (RS-Momentum ≥ 100).
# The **Great Rotation** requires *both* legs — `min(distribution, accumulation)`.

# %%
def clamp01(v): return max(0.0, min(1.0, v))

def distribution_score(t):  # AI complex topping
    return clamp01((t["ratio"] - 100) / 5) * 0.5 + clamp01((100 - t["mom"]) / 5) * 0.5

def accumulation_score(t):  # energy complex turning up
    base = 0.5 if t["ratio"] >= 100 else clamp01((100 - t["ratio"]) / 5)
    return base * 0.4 + clamp01((t["mom"] - 100) / 5) * 0.6

ai = max([tracks[k] for k in ("AI · Semis", "Hyperscalers")], key=lambda t: t["ratio"])
energy = max([tracks[k] for k in ("Energy", "Natural gas", "Uranium", "Nuclear power")],
             key=lambda t: t["mom"])
dist, acc = distribution_score(ai), accumulation_score(energy)
great = min(dist, acc)
state = lambda s: "ACTIVE" if s >= 0.66 else "WATCH" if s >= 0.33 else "off"
print(f"AI · Semis distribution   {dist:.2f}  [{state(dist)}]")
print(f"Energy complex accumulation {acc:.2f}  [{state(acc)}]")
print(f"GREAT ROTATION (AI→Energy)  {great:.2f}  [{state(great)}]")

# %% [markdown]
# ## 5. The Lux Book — top-10 model allocation
# Conviction = quadrant base (accumulate Improving, hold Leading, trim Weakening,
# avoid Lagging) + a momentum tilt + an oversold-base bonus, normalised to 100%.

# %%
QUAD_BASE = {"improving": 1.0, "leading": 0.72, "weakening": 0.22, "lagging": 0.08}
STANCE = {"improving": "Accumulate", "leading": "Core", "weakening": "Trim", "lagging": "Avoid"}

def conviction(t):
    c = QUAD_BASE[t["quadrant"]] + np.clip((t["mom"] - 100) * 0.16, -1.2, 1.2)
    r3 = pct_return(t["synth"], 63)
    if t["quadrant"] == "improving" and r3 < 0:
        c += min(0.3, -r3 / 100)
    return max(0.0, c)

conv = {name: conviction(t) for name, t in tracks.items()}
top = sorted(conv, key=conv.get, reverse=True)[:10]
total = sum(conv[n] for n in top)
book = pd.DataFrame([
    dict(bucket=n, weight_pct=round(conv[n] / total * 100, 1),
         stance=STANCE[tracks[n]["quadrant"]],
         d_mom=round(tracks[n]["mom"] - 100, 1),
         ret_3mo=round(pct_return(tracks[n]["synth"], 63), 1))
    for n in top
])
print(book.to_string(index=False))
print(f"\nbook weight sums to {book.weight_pct.sum():.1f}%")

# %% [markdown]
# ## 6. Backtest — does the rotation add value?
# Each week, score every theme's RRG (using only data available up to that point),
# form a **long Improving+Leading / short Weakening+Lagging** book (equal-weight,
# weekly rebalanced, held on the next week's synthetic returns), and compare to a
# long-only equal-weight basket and to SPY. This is an in-sample sanity check on a
# single 6-month window — indicative, not a strategy claim.

# %%
# Daily synthetic returns for every theme, aligned.
synth_px = pd.DataFrame({name: t["synth"] for name, t in tracks.items()})
rets = synth_px.pct_change().fillna(0.0)
spy_ret = bench.pct_change().fillna(0.0)

# Precompute each theme's RRG *series* so we can read the quadrant as-of any day.
series = {}
for name, t in tracks.items():
    rel = (t["synth"] / bench).to_numpy()
    rsr, rsm = rrg(rel)
    series[name] = (rsr, rsm)

dates = synth_px.index
start = LEVEL_WINDOW + MOM_LOOKBACK + 1
long_short, long_only = [], []
i = start
while i < len(dates) - 1:
    longs, shorts = [], []
    for name in tracks:
        rsr, rsm = series[name]
        q = quadrant(rsr[i], rsm[i])
        if q in ("improving", "leading"): longs.append(name)
        elif q in ("weakening", "lagging"): shorts.append(name)
    hold = slice(i + 1, min(i + 6, len(dates)))  # hold ~1 week
    fwd = rets.iloc[hold]
    l = fwd[longs].mean(axis=1) if longs else pd.Series(0.0, index=fwd.index)
    s = fwd[shorts].mean(axis=1) if shorts else pd.Series(0.0, index=fwd.index)
    long_short.append(l - s)
    long_only.append(fwd[longs].mean(axis=1) if longs else pd.Series(0.0, index=fwd.index))
    i += 5

ls = pd.concat(long_short); lo = pd.concat(long_only)
eqw = rets.mean(axis=1).loc[ls.index]
spy = spy_ret.loc[ls.index]

def stats_line(name, r):
    ann = (1 + r.mean()) ** 252 - 1
    sharpe = r.mean() / r.std() * np.sqrt(252) if r.std() else 0
    tot = (1 + r).prod() - 1
    print(f"{name:22s} total {tot*100:7.2f}%   ann {ann*100:7.2f}%   Sharpe {sharpe:5.2f}")

print("Window performance (this 6-month sample):")
stats_line("Rotation long/short", ls)
stats_line("Rotation long-only", lo)
stats_line("Equal-weight basket", eqw)
stats_line("SPY benchmark", spy)
t_stat, p = stats.ttest_1samp(ls, 0.0)
print(f"\nLong/short daily mean > 0:  t = {t_stat:.2f}, p = {p:.3f} "
      f"({'significant' if p < 0.05 else 'not significant'} at 5% on this window)")

# %% [markdown]
# ## 7. The picture — the RRG
# The lead themes on the rotation graph, with their two-month tails. Weakening
# (bottom-right) is distribution; Improving (top-left) is accumulation.

# %%
LEADS = ["AI · Semis", "Hyperscalers", "Energy", "Natural gas", "Uranium", "Nuclear power"]
QC = {"leading": "#2fa36b", "weakening": "#d99429", "lagging": "#d1483f", "improving": "#3a7fd0"}

fig, ax = plt.subplots(figsize=(7.2, 7.2))
dev = 4
for n in LEADS:
    rsr, rsm = series[n]
    tail = slice(-40, None)
    dev = max(dev, np.max(np.abs(rsr[tail] - 100)), np.max(np.abs(rsm[tail] - 100)))
R = np.ceil(dev * 1.12)
ax.axhspan(100, 100 + R, xmin=0.5, xmax=1, color=QC["leading"], alpha=0.05)
ax.axhspan(100 - R, 100, xmin=0.5, xmax=1, color=QC["weakening"], alpha=0.08)
ax.axhspan(100 - R, 100, xmin=0, xmax=0.5, color=QC["lagging"], alpha=0.05)
ax.axhspan(100, 100 + R, xmin=0, xmax=0.5, color=QC["improving"], alpha=0.08)
ax.axhline(100, color="#888", lw=0.8, ls="--"); ax.axvline(100, color="#888", lw=0.8, ls="--")
for n in LEADS:
    rsr, rsm = series[n]
    xs, ys = rsr[-40::5], rsm[-40::5]
    c = QC[tracks[n]["quadrant"]]
    ax.plot(xs, ys, "-", color=c, alpha=0.5, lw=1.4)
    ax.plot(xs[-1], ys[-1], "o", color=c, ms=9)
    ax.annotate(n, (xs[-1], ys[-1]), xytext=(7, 3), textcoords="offset points", fontsize=9)
ax.set_xlim(100 - R, 100 + R); ax.set_ylim(100 - R, 100 + R)
ax.set_xlabel("RS-Ratio  (leading →)"); ax.set_ylabel("RS-Momentum  (improving ↑)")
ax.set_title("Rotation graph — lead themes vs SPY")
for label, x, y, ha, va in [("LEADING", 100 + R, 100 + R, "right", "top"),
                            ("WEAKENING", 100 + R, 100 - R, "right", "bottom"),
                            ("LAGGING", 100 - R, 100 - R, "left", "bottom"),
                            ("IMPROVING", 100 - R, 100 + R, "left", "top")]:
    ax.text(x, y, label, ha=ha, va=va, fontsize=8, color="#666", alpha=0.8)
fig.tight_layout()
out = os.path.join(HERE, "rrg.png")
fig.savefig(out, dpi=120)
print(f"saved {out}")
plt.show()
