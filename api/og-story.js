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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0a0a0a"/>

  <!-- Grid pattern -->
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#grid)"/>

  <!-- Top accent line -->
  <rect x="0" y="0" width="1200" height="4" fill="${levelColor}"/>

  <!-- WORLDMONITOR header -->
  <text x="80" y="72" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="700" fill="#555" letter-spacing="6"
    >WORLDMONITOR</text>
  <text x="1120" y="72" font-family="system-ui, sans-serif" font-size="20" fill="#444" text-anchor="end"
    >${typeLabel.toUpperCase()}</text>

  <!-- Separator -->
  <line x1="80" y1="96" x2="1120" y2="96" stroke="#1a1a2e" stroke-width="1"/>

  <!-- Country name -->
  <text x="80" y="200" font-family="system-ui, -apple-system, sans-serif" font-size="72" font-weight="800" fill="#ffffff"
    >${escapeXml(countryName.toUpperCase())}</text>

  <!-- Country code badge -->
  <rect x="1040" y="168" width="80" height="40" rx="6" fill="rgba(255,255,255,0.08)"/>
  <text x="1080" y="196" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#888" text-anchor="middle"
    >${escapeXml(countryCode)}</text>

  ${scoreNum !== null ? `
  <!-- CII Score -->
  <text x="80" y="300" font-family="system-ui, -apple-system, sans-serif" font-size="80" font-weight="800" fill="${levelColor}"
    >${scoreNum}</text>
  <text x="${80 + String(scoreNum).length * 48}" y="300" font-family="system-ui, sans-serif" font-size="40" fill="#666"
    >/100</text>

  <!-- Level badge -->
  <rect x="900" y="262" width="${level.length * 18 + 32}" height="40" rx="6" fill="${levelColor}"/>
  <text x="${900 + (level.length * 18 + 32) / 2}" y="290" font-family="system-ui, sans-serif" font-size="22" font-weight="700" fill="#fff" text-anchor="middle"
    >${level.toUpperCase()}</text>

  <!-- Score bar background -->
  <rect x="80" y="330" width="460" height="14" rx="7" fill="#1a1a2e"/>
  <!-- Score bar fill -->
  <rect x="80" y="330" width="${barWidth}" height="14" rx="7" fill="${levelColor}"/>

  <!-- Labels -->
  <text x="80" y="390" font-family="system-ui, sans-serif" font-size="20" fill="#555" font-weight="600" letter-spacing="3"
    >INSTABILITY INDEX</text>
  ` : `
  <!-- No score available -->
  <text x="80" y="300" font-family="system-ui, sans-serif" font-size="32" fill="#666"
    >Real-time intelligence analysis</text>
  `}

  <!-- Bottom separator -->
  <line x1="80" y1="540" x2="1120" y2="540" stroke="#1a1a2e" stroke-width="1"/>

  <!-- Footer -->
  <text x="80" y="580" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="600" fill="#333" letter-spacing="2"
    >WORLDMONITOR.APP</text>
  <text x="1120" y="580" font-family="system-ui, sans-serif" font-size="18" fill="#444" text-anchor="end"
    >Real-time global intelligence monitoring</text>
  <text x="1120" y="608" font-family="system-ui, sans-serif" font-size="16" fill="#333" text-anchor="end"
    >Free &amp; open source</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(svg);
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
