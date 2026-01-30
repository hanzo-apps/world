/**
 * Dynamic OG Image Generator for Story Sharing
 * Returns an SVG image (1200x630) with country name, CII score, and level.
 * Used as og:image for Twitter Cards and social previews.
 */

const COUNTRY_NAMES = {
  UA: 'Ukraine', RU: 'Russia', CN: 'China', US: 'United States',
  IR: 'Iran', IL: 'Israel', TW: 'Taiwan', KP: 'North Korea',
  SA: 'Saudi Arabia', TR: 'Turkey', PL: 'Poland', DE: 'Germany',
  FR: 'France', GB: 'United Kingdom', IN: 'India', PK: 'Pakistan',
  SY: 'Syria', YE: 'Yemen', MM: 'Myanmar', VE: 'Venezuela',
};

const LEVEL_COLORS = {
  critical: '#ef4444', high: '#f97316', elevated: '#eab308',
  normal: '#22c55e', low: '#3b82f6',
};

const TYPE_LABELS = {
  ciianalysis: 'Intelligence Brief',
  crisisalert: 'Crisis Alert',
  dailybrief: 'Daily Brief',
  marketfocus: 'Market Focus',
};

export default function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const countryCode = (url.searchParams.get('c') || '').toUpperCase();
  const type = url.searchParams.get('t') || 'ciianalysis';
  const score = url.searchParams.get('s');
  const level = url.searchParams.get('l') || 'elevated';

  const countryName = COUNTRY_NAMES[countryCode] || countryCode || 'Global';
  const typeLabel = TYPE_LABELS[type] || 'Intelligence Brief';
  const levelColor = LEVEL_COLORS[level] || '#eab308';
  const scoreNum = score ? parseInt(score, 10) : null;
  const barWidth = scoreNum !== null ? Math.min(scoreNum, 100) * 4.6 : 0;
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0c0c14"/>

  <!-- Top accent line -->
  <rect x="0" y="0" width="1200" height="5" fill="${levelColor}"/>

  <!-- WORLDMONITOR header -->
  <text x="80" y="68" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="700" fill="#777" letter-spacing="6"
    >WORLDMONITOR</text>
  <text x="1120" y="68" font-family="system-ui, sans-serif" font-size="20" fill="#666" text-anchor="end"
    >${escapeXml(typeLabel.toUpperCase())}</text>

  <!-- Separator -->
  <line x1="80" y1="92" x2="1120" y2="92" stroke="#333" stroke-width="1"/>

  <!-- Country name -->
  <text x="80" y="190" font-family="system-ui, -apple-system, sans-serif" font-size="78" font-weight="800" fill="#ffffff"
    >${escapeXml(countryName.toUpperCase())}</text>

  <!-- Country code badge -->
  <rect x="1030" y="155" width="90" height="44" rx="8" fill="rgba(255,255,255,0.1)"/>
  <text x="1075" y="185" font-family="system-ui, sans-serif" font-size="26" font-weight="700" fill="#aaa" text-anchor="middle"
    >${escapeXml(countryCode)}</text>

  ${scoreNum !== null ? `
  <!-- CII Score -->
  <text x="80" y="310" font-family="system-ui, -apple-system, sans-serif" font-size="96" font-weight="800" fill="${levelColor}"
    >${scoreNum}</text>
  <text x="${80 + String(scoreNum).length * 56}" y="310" font-family="system-ui, sans-serif" font-size="44" fill="#888"
    >/100</text>

  <!-- Level badge -->
  <rect x="900" y="270" width="${level.length * 20 + 36}" height="44" rx="8" fill="${levelColor}"/>
  <text x="${900 + (level.length * 20 + 36) / 2}" y="300" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#fff" text-anchor="middle"
    >${level.toUpperCase()}</text>

  <!-- Score bar -->
  <rect x="80" y="340" width="500" height="16" rx="8" fill="#1a1a2e"/>
  <rect x="80" y="340" width="${barWidth}" height="16" rx="8" fill="${levelColor}"/>

  <!-- Labels -->
  <text x="80" y="400" font-family="system-ui, sans-serif" font-size="22" fill="#777" font-weight="600" letter-spacing="4"
    >COUNTRY INSTABILITY INDEX</text>
  ` : `
  <!-- No score — show descriptive text -->
  <text x="80" y="290" font-family="system-ui, sans-serif" font-size="36" fill="#aaa" font-weight="600"
    >Real-time intelligence analysis</text>
  <text x="80" y="340" font-family="system-ui, sans-serif" font-size="24" fill="#777"
    >Country Instability Index · Military Posture · Prediction Markets</text>
  <text x="80" y="380" font-family="system-ui, sans-serif" font-size="24" fill="#777"
    >Signal Convergence · Threat Classification · Active Signals</text>
  `}

  <!-- Bottom separator -->
  <line x1="80" y1="530" x2="1120" y2="530" stroke="#333" stroke-width="1"/>

  <!-- Footer -->
  <text x="80" y="572" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="600" fill="#555" letter-spacing="2"
    >WORLDMONITOR.APP</text>
  <text x="1120" y="572" font-family="system-ui, sans-serif" font-size="20" fill="#666" text-anchor="end"
    >Real-time global intelligence monitoring</text>
  <text x="1120" y="602" font-family="system-ui, sans-serif" font-size="18" fill="#555" text-anchor="end"
    >${escapeXml(dateStr)} · Free &amp; open source</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(svg);
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
