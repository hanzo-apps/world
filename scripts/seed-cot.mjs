#!/usr/bin/env node

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';
loadEnvFile(import.meta.url);

const COT_KEY = 'market:cot:v1';
const COT_TTL = 604800;

const TARGET_INSTRUMENTS = [
  { name: 'S&P 500 E-Mini',    code: 'ES', pattern: /E-MINI S&P 500/i },
  { name: 'Nasdaq 100 E-Mini', code: 'NQ', pattern: /E-MINI NASDAQ-100/i },
  { name: '10-Year T-Note',    code: 'ZN', pattern: /10-YEAR U.S. TREASURY NOTE/i },
  { name: '2-Year T-Note',     code: 'ZT', pattern: /2-YEAR U.S. TREASURY NOTE/i },
  { name: 'Gold',              code: 'GC', pattern: /GOLD - COMMODITY EXCHANGE/i },
  { name: 'Crude Oil (WTI)',   code: 'CL', pattern: /CRUDE OIL, LIGHT SWEET/i },
  { name: 'EUR/USD',           code: 'EC', pattern: /EURO FX/i },
  { name: 'USD/JPY',           code: 'JY', pattern: /JAPANESE YEN/i },
];

function parseDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{6}$/.test(s)) {
    const yy = s.slice(0, 2);
    const mm = s.slice(2, 4);
    const dd = s.slice(4, 6);
    const year = parseInt(yy, 10) >= 50 ? `19${yy}` : `20${yy}`;
    return `${year}-${mm}-${dd}`;
  }
  return s;
}

async function fetchCotData() {
  const url = 'https://www.cftc.gov/dea/newcot/c_disaggrt.txt';
  let text;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      console.warn(`  CFTC fetch failed: HTTP ${resp.status}`);
      return { instruments: [], reportDate: '' };
    }
    text = await resp.text();
  } catch (e) {
    console.warn(`  CFTC fetch error: ${e.message}`);
    return { instruments: [], reportDate: '' };
  }

  const lines = text.split('\n').map(l => l.trimEnd());
  if (lines.length < 2) {
    console.warn('  CFTC: empty file');
    return { instruments: [], reportDate: '' };
  }

  const headerLine = lines[0];
  const headers = headerLine.split('|').map(h => h.trim());

  const colIdx = name => {
    const idx = headers.indexOf(name);
    return idx;
  };

  const nameCol          = colIdx('Market_and_Exchange_Names');
  const dateCol1         = colIdx('Report_Date_as_YYYY-MM-DD');
  const dateCol2         = colIdx('As_of_Date_In_Form_YYMMDD');
  const dealerLongCol    = colIdx('Dealer_Positions_Long_All');
  const dealerShortCol   = colIdx('Dealer_Positions_Short_All');
  const amLongCol        = colIdx('Asset_Mgr_Positions_Long_All');
  const amShortCol       = colIdx('Asset_Mgr_Positions_Short_All');
  const levLongCol       = colIdx('Lev_Money_Positions_Long_All');
  const levShortCol      = colIdx('Lev_Money_Positions_Short_All');

  if (nameCol === -1) {
    console.warn('  CFTC: Market_and_Exchange_Names column not found');
    return { instruments: [], reportDate: '' };
  }

  const dataLines = lines.slice(1).filter(l => l.trim().length > 0);

  const instruments = [];
  let latestReportDate = '';

  for (const target of TARGET_INSTRUMENTS) {
    const matchingLines = dataLines.filter(line => {
      const fields = line.split('|');
      const marketName = fields[nameCol] ?? '';
      return target.pattern.test(marketName);
    });

    if (matchingLines.length === 0) {
      console.warn(`  CFTC: no rows found for ${target.name}`);
      continue;
    }

    const row = matchingLines[0];
    const fields = row.split('|');

    const rawDate = (dateCol1 !== -1 && fields[dateCol1]?.trim())
      ? fields[dateCol1].trim()
      : (dateCol2 !== -1 ? fields[dateCol2]?.trim() ?? '' : '');
    const reportDate = parseDate(rawDate);

    if (reportDate && !latestReportDate) latestReportDate = reportDate;

    const toNum = idx => {
      if (idx === -1) return 0;
      const v = parseInt((fields[idx] ?? '').replace(/,/g, '').trim(), 10);
      return isNaN(v) ? 0 : v;
    };

    const dealerLong  = toNum(dealerLongCol);
    const dealerShort = toNum(dealerShortCol);
    const amLong      = toNum(amLongCol);
    const amShort     = toNum(amShortCol);
    const levLong     = toNum(levLongCol);
    const levShort    = toNum(levShortCol);

    const netPct = ((amLong - amShort) / Math.max(amLong + amShort, 1)) * 100;

    instruments.push({
      name: target.name,
      code: target.code,
      reportDate,
      assetManagerLong: amLong,
      assetManagerShort: amShort,
      leveragedFundsLong: levLong,
      leveragedFundsShort: levShort,
      dealerLong,
      dealerShort,
      netPct: parseFloat(netPct.toFixed(2)),
    });

    console.log(`  ${target.code}: AM net ${netPct.toFixed(1)}% (${amLong}L / ${amShort}S), date=${reportDate}`);
  }

  return { instruments, reportDate: latestReportDate };
}

if (process.argv[1] && process.argv[1].endsWith('seed-cot.mjs')) {
  runSeed('market', 'cot', COT_KEY, fetchCotData, {
    ttlSeconds: COT_TTL,
    validateFn: data => Array.isArray(data?.instruments) && data.instruments.length > 0,
    recordCount: data => data?.instruments?.length ?? 0,
  }).catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
}
