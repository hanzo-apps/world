# World Monitor

**Real-time global intelligence dashboard** — AI-powered news aggregation, geopolitical monitoring, and infrastructure tracking in a unified situational awareness interface.

[![GitHub stars](https://img.shields.io/github/stars/koala73/worldmonitor?style=social)](https://github.com/koala73/worldmonitor/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/koala73/worldmonitor?style=social)](https://github.com/koala73/worldmonitor/network/members)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Last commit](https://img.shields.io/github/last-commit/koala73/worldmonitor)](https://github.com/koala73/worldmonitor/commits/main)

<p align="center">
  <a href="https://worldmonitor.app"><strong>Live Demo</strong></a> &nbsp;·&nbsp;
  <a href="https://tech.worldmonitor.app"><strong>Tech Variant</strong></a> &nbsp;·&nbsp;
  <a href="./docs/DOCUMENTATION.md"><strong>Full Documentation</strong></a>
</p>

![World Monitor Dashboard](new-world-monitor.png)

---

## Why World Monitor?

| Problem | Solution |
|---------|----------|
| News scattered across 100+ sources | **Single unified dashboard** with 80+ curated feeds |
| No geospatial context for events | **Interactive map** with 20+ toggleable data layers |
| Information overload | **AI-synthesized briefs** with focal point detection |
| Expensive OSINT tools ($$$) | **100% free & open source** |
| Static news feeds | **Real-time updates** with live video streams |

---

## Live Demos

| Variant | URL | Focus |
|---------|-----|-------|
| **World Monitor** | [worldmonitor.app](https://worldmonitor.app) | Geopolitics, military, conflicts, infrastructure |
| **Tech Monitor** | [tech.worldmonitor.app](https://tech.worldmonitor.app) | Startups, AI/ML, cloud, cybersecurity |

Both variants run from a single codebase — switch between them with one click.

---

## Key Features

### Interactive Global Map
- **20+ data layers** — conflicts, military bases, infrastructure, protests, disasters
- **Smart clustering** — markers intelligently group at low zoom, expand on zoom in
- **8 regional presets** — Global, Americas, Europe, MENA, Asia, Africa, Oceania, Latin America
- **Time filtering** — 1h, 6h, 24h, 48h, 7d event windows

### AI-Powered Intelligence
- **World Brief** — LLM-synthesized summary of top global developments
- **Focal Point Detection** — ML identifies the most critical story clusters
- **Country Instability Index** — Real-time stability scores for 20 monitored nations
- **Strategic Risk Score** — Composite assessment combining all intelligence modules

### Real-Time Data Layers

<details>
<summary><strong>Geopolitical</strong></summary>

- Active conflict zones with escalation tracking
- Intelligence hotspots with news correlation
- Social unrest events (ACLED + GDELT)
- Sanctions regimes

</details>

<details>
<summary><strong>Military & Strategic</strong></summary>

- 220+ military bases from 9 operators
- Live military flight tracking (ADS-B)
- Naval vessel monitoring (AIS)
- Nuclear facilities & gamma irradiators
- APT cyber threat actor attribution
- Spaceports & launch facilities

</details>

<details>
<summary><strong>Infrastructure</strong></summary>

- Undersea cables with landing points
- Oil & gas pipelines
- AI datacenters (111 major clusters)
- Internet outages
- Critical mineral deposits

</details>

<details>
<summary><strong>Tech Ecosystem</strong> (Tech variant)</summary>

- Tech company HQs (Big Tech, unicorns, public)
- Startup hubs with funding data
- Cloud regions (AWS, Azure, GCP)
- Accelerators (YC, Techstars, 500)
- Upcoming tech conferences

</details>

### Live News & Video
- **80+ RSS feeds** across geopolitics, defense, energy, tech
- **Live video streams** — Bloomberg, Sky News, Al Jazeera, CNBC, and more
- **Custom monitors** — Create keyword-based alerts for any topic
- **Entity extraction** — Auto-links countries, leaders, organizations

### Additional Capabilities
- Signal intelligence with "Why It Matters" context
- Infrastructure cascade analysis
- Maritime & aviation tracking
- Prediction market integration (Polymarket, Kalshi)
- Service status monitoring (cloud providers, AI services)
- Snapshot system for sharing configurations

---

## Quick Start

```bash
# Clone and run
git clone https://github.com/koala73/worldmonitor.git
cd worldmonitor
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Environment Variables (Optional)

For full functionality, add these to `.env.local`:

```env
# AI Summarization
GROQ_API_KEY=gsk_xxx

# Live flight data
OPENSKY_USERNAME=xxx
OPENSKY_PASSWORD=xxx

# Ship tracking
VESSELFINDER_API_KEY=xxx
```

See [API Dependencies](./docs/DOCUMENTATION.md#api-dependencies) for the full list.

---

## Tech Stack

| Category | Technologies |
|----------|--------------|
| **Frontend** | TypeScript, Vite, D3.js, deck.gl |
| **AI/ML** | Groq (Llama 3.1), TensorFlow.js (T5) |
| **APIs** | OpenSky, GDELT, ACLED, USGS, NASA EONET, FRED |
| **Deployment** | Vercel Edge Functions |
| **Data** | Redis (Upstash), RSS feeds |

---

## Documentation

Full documentation including algorithms, data sources, and system architecture:

**[docs/DOCUMENTATION.md](./docs/DOCUMENTATION.md)**

Key sections:
- [Signal Intelligence](./docs/DOCUMENTATION.md#signal-intelligence)
- [Country Instability Index](./docs/DOCUMENTATION.md#country-instability-index-cii)
- [Military Tracking](./docs/DOCUMENTATION.md#military-tracking)
- [Infrastructure Analysis](./docs/DOCUMENTATION.md#infrastructure-cascade-analysis)
- [API Dependencies](./docs/DOCUMENTATION.md#api-dependencies)
- [System Architecture](./docs/DOCUMENTATION.md#system-architecture)

---

## Contributing

Contributions welcome! See [CONTRIBUTING](./docs/DOCUMENTATION.md#contributing) for guidelines.

```bash
# Development
npm run dev          # Start dev server
npm run dev:tech     # Start tech variant
npm run build        # Production build
npm run typecheck    # Type checking
```

---

## Roadmap

- [ ] Mobile-optimized views
- [ ] Push notifications for critical alerts
- [ ] Historical data playback
- [ ] API for programmatic access
- [ ] Self-hosted Docker image

See [full roadmap](./docs/DOCUMENTATION.md#roadmap).

---

## Support the Project

If you find World Monitor useful:

- **Star this repo** to help others discover it
- **Share** with colleagues interested in OSINT
- **Contribute** code, data sources, or documentation
- **Report issues** to help improve the platform

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Author

**Elie Habib** — [GitHub](https://github.com/koala73)

---

<p align="center">
  <a href="https://worldmonitor.app">worldmonitor.app</a> &nbsp;·&nbsp;
  <a href="https://tech.worldmonitor.app">tech.worldmonitor.app</a>
</p>
