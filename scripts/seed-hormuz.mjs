#!/usr/bin/env node
// seed-hormuz.mjs — Strait of Hormuz Trade Tracker
//
// Scrapes the WTO DataLab Hormuz Trade Tracker page (daily AXSMarine data)
// and writes key insights + status to Redis.
//
// Source: WTO DataLab / AXSMarine
//   https://datalab.wto.org/Strait-of-Hormuz-Trade-Tracker
//
// Redis key: supply_chain:hormuz_tracker:v1
// Cron: every 6 hours (0 */6 * * *)
// TTL: 28800s (8h — cron interval + 2h buffer)

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'supply_chain:hormuz_tracker:v1';
const CACHE_TTL = 28800; // 8h
const WTO_URL = 'https://datalab.wto.org/Strait-of-Hormuz-Trade-Tracker';

// Decode common HTML entities in scraped text.
function decodeHtmlEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/&ldquo;/g, '\u201c')
    .replace(/&rdquo;/g, '\u201d')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8220;/g, '\u201c')
    .replace(/&#8221;/g, '\u201d');
}

function stripTags(s) {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function deriveStatus(text) {
  const lc = text.toLowerCase();
  if (/\bclosed\b|\bclosure\b/.test(lc)) return 'closed';
  if (/disrupted|disruption|halt|standstill/.test(lc)) return 'disrupted';
  if (/restricted|congested|tension|heightened/.test(lc)) return 'restricted';
  return 'open';
}

async function scrapeWtoPage() {
  console.log(`  Fetching ${WTO_URL}`);

  const resp = await fetch(WTO_URL, {
    headers: {
      'User-Agent': CHROME_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching WTO Hormuz page`);
  const html = await resp.text();

  // --- Date of latest insights ---
  const dateM = html.match(/<time[^>]*>(.*?)<\/time>/);
  const updatedDate = dateM ? stripTags(dateM[1]) : null;

  // --- "Latest insights" summary blurb (above "See key insights" link) ---
  const liM = html.match(/Latest insights([\s\S]*?)See key insights/);
  let summary = null;
  if (liM) {
    const chunk = liM[1];
    const afterTime = chunk.includes('</time>') ? chunk.slice(chunk.indexOf('</time>') + 7) : chunk;
    const text = stripTags(afterTime);
    summary = text || null;
  }

  // --- Title of latest strategic insight (bold text) ---
  const titleM = html.match(/<strong[^>]*>(Strategic Trade Insight:[\s\S]*?)<\/strong>/);
  const title = titleM ? stripTags(titleM[1]) : null;

  // --- Full body paragraphs of the insight ---
  const paragraphs = [];
  if (title) {
    const startIdx = html.indexOf('Strategic Trade Insight:');
    const chunk = html.slice(startIdx);
    const paraRe = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
    let m;
    while ((m = paraRe.exec(chunk)) !== null && paragraphs.length < 5) {
      const text = stripTags(m[1]);
      // Skip AIS footnote and very short snippets
      if (text.length > 30 && !text.startsWith('* AIS')) {
        paragraphs.push(text);
      }
    }
  }

  const combined = [title, summary, ...paragraphs].filter(Boolean).join(' ');
  const status = deriveStatus(combined);

  if (!updatedDate && !summary && !title) {
    throw new Error('No content parsed from WTO Hormuz page — possible structure change');
  }

  console.log(`  Date: ${updatedDate}`);
  console.log(`  Status: ${status}`);
  console.log(`  Title: ${title?.slice(0, 80)}...`);

  return {
    fetchedAt: Date.now(),
    updatedDate,
    title,
    summary,
    paragraphs,
    status,
    attribution: {
      source: 'WTO DataLab / AXSMarine',
      url: WTO_URL,
    },
  };
}

await runSeed('supply_chain', 'hormuz_tracker', CANONICAL_KEY, scrapeWtoPage, {
  ttlSeconds: CACHE_TTL,
  validateFn: (d) => !!(d?.updatedDate || d?.summary || d?.title),
});
