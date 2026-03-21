/**
 * Publish job: builds compact WorldMonitor snapshot payloads and writes to Redis.
 * This is the handoff point between consumer-prices-core and WorldMonitor.
 */
import {
  buildBasketSeriesSnapshot,
  buildCategoriesSnapshot,
  buildFreshnessSnapshot,
  buildMoversSnapshot,
  buildOverviewSnapshot,
  buildRetailerSpreadSnapshot,
} from '../snapshots/worldmonitor.js';
import { loadAllBasketConfigs, loadAllRetailerConfigs } from '../config/loader.js';

const logger = {
  info: (msg: string, ...args: unknown[]) => console.log(`[publish] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[publish] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[publish] ${msg}`, ...args),
};

function makeKey(parts: string[]): string {
  return parts.join(':');
}

function recordCount(data: unknown): number {
  if (!data || typeof data !== 'object') return 1;
  const d = data as Record<string, unknown>;
  const arr = d.retailers ?? d.risers ?? d.essentialsSeries ?? d.categories;
  return Array.isArray(arr) ? arr.length : 1;
}

async function upstashCommand(url: string, token: string, command: unknown[]): Promise<void> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!resp.ok) throw new Error(`Upstash ${command[0]} failed: HTTP ${resp.status}`);
}

async function writeSnapshot(
  url: string,
  token: string,
  key: string,
  data: unknown,
  ttlSeconds: number,
) {
  const json = JSON.stringify(data);
  await upstashCommand(url, token, ['SET', key, json, 'EX', ttlSeconds]);
  await upstashCommand(url, token, [
    'SET',
    makeKey(['seed-meta', key]),
    JSON.stringify({ fetchedAt: Date.now(), recordCount: recordCount(data) }),
    'EX',
    ttlSeconds * 2,
  ]);
  logger.info(`  wrote ${key} (${json.length} bytes, ttl=${ttlSeconds}s)`);
}

// 26h TTL — longer than the 24h cron cadence to survive scheduling drift
const TTL = 93600;

export async function publishAll() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set');

  const retailers = loadAllRetailerConfigs().filter((r) => r.enabled);
  const markets = [...new Set(retailers.map((r) => r.marketCode))];
  const baskets = loadAllBasketConfigs();

  for (const marketCode of markets) {
    logger.info(`Publishing snapshots for market: ${marketCode}`);

    try {
      const overview = await buildOverviewSnapshot(marketCode);
      await writeSnapshot(url, token, makeKey(['consumer-prices', 'overview', marketCode]), overview, TTL);
    } catch (err) {
      logger.error(`overview:${marketCode} failed: ${err}`);
    }

    for (const days of [7, 30]) {
      try {
        const movers = await buildMoversSnapshot(marketCode, days);
        await writeSnapshot(url, token, makeKey(['consumer-prices', 'movers', marketCode, `${days}d`]), movers, TTL);
      } catch (err) {
        logger.error(`movers:${marketCode}:${days}d failed: ${err}`);
      }
    }

    try {
      const freshness = await buildFreshnessSnapshot(marketCode);
      await writeSnapshot(url, token, makeKey(['consumer-prices', 'freshness', marketCode]), freshness, TTL);
    } catch (err) {
      logger.error(`freshness:${marketCode} failed: ${err}`);
    }

    for (const range of ['7d', '30d', '90d']) {
      try {
        const categories = await buildCategoriesSnapshot(marketCode, range);
        await writeSnapshot(url, token, makeKey(['consumer-prices', 'categories', marketCode, range]), categories, TTL);
      } catch (err) {
        logger.error(`categories:${marketCode}:${range} failed: ${err}`);
      }
    }

    for (const basket of baskets.filter((b) => b.marketCode === marketCode)) {
      try {
        const spread = await buildRetailerSpreadSnapshot(marketCode, basket.slug);
        await writeSnapshot(
          url, token,
          makeKey(['consumer-prices', 'retailer-spread', marketCode, basket.slug]),
          spread,
          TTL,
        );
      } catch (err) {
        logger.error(`spread:${marketCode}:${basket.slug} failed: ${err}`);
      }

      for (const range of ['7d', '30d', '90d']) {
        try {
          const series = await buildBasketSeriesSnapshot(marketCode, basket.slug, range);
          await writeSnapshot(
            url, token,
            makeKey(['consumer-prices', 'basket-series', marketCode, basket.slug, range]),
            series,
            TTL,
          );
        } catch (err) {
          logger.error(`basket-series:${marketCode}:${basket.slug}:${range} failed: ${err}`);
        }
      }
    }
  }

  logger.info('Publish complete');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  publishAll().catch(console.error);
}
