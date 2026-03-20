/**
 * Publish job: builds compact WorldMonitor snapshot payloads and writes to Redis.
 * This is the handoff point between consumer-prices-core and WorldMonitor.
 */
import { createClient } from 'redis';
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

async function writeSnapshot(
  redis: ReturnType<typeof createClient>,
  key: string,
  data: unknown,
  ttlSeconds: number,
) {
  const json = JSON.stringify(data);
  await redis.setEx(key, ttlSeconds, json);
  await redis.setEx(
    makeKey(['seed-meta', key]),
    ttlSeconds * 2,
    JSON.stringify({ fetchedAt: Date.now(), recordCount: recordCount(data) }),
  );
  logger.info(`  wrote ${key} (${json.length} bytes, ttl=${ttlSeconds}s)`);
}

export async function publishAll() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is not set');

  const redis = createClient({ url: redisUrl });
  await redis.connect();

  try {
    const retailers = loadAllRetailerConfigs().filter((r) => r.enabled);
    const markets = [...new Set(retailers.map((r) => r.marketCode))];
    const baskets = loadAllBasketConfigs();

    for (const marketCode of markets) {
      logger.info(`Publishing snapshots for market: ${marketCode}`);

      try {
        const overview = await buildOverviewSnapshot(marketCode);
        await writeSnapshot(redis, makeKey(['consumer-prices', 'overview', marketCode]), overview, 1800);
      } catch (err) {
        logger.error(`overview:${marketCode} failed: ${err}`);
      }

      for (const days of [7, 30]) {
        try {
          const movers = await buildMoversSnapshot(marketCode, days);
          await writeSnapshot(redis, makeKey(['consumer-prices', 'movers', marketCode, `${days}d`]), movers, 1800);
        } catch (err) {
          logger.error(`movers:${marketCode}:${days}d failed: ${err}`);
        }
      }

      try {
        const freshness = await buildFreshnessSnapshot(marketCode);
        await writeSnapshot(redis, makeKey(['consumer-prices', 'freshness', marketCode]), freshness, 600);
      } catch (err) {
        logger.error(`freshness:${marketCode} failed: ${err}`);
      }

      for (const range of ['7d', '30d', '90d']) {
        try {
          const categories = await buildCategoriesSnapshot(marketCode, range);
          await writeSnapshot(redis, makeKey(['consumer-prices', 'categories', marketCode, range]), categories, 1800);
        } catch (err) {
          logger.error(`categories:${marketCode}:${range} failed: ${err}`);
        }
      }

      for (const basket of baskets.filter((b) => b.marketCode === marketCode)) {
        try {
          const spread = await buildRetailerSpreadSnapshot(marketCode, basket.slug);
          await writeSnapshot(
            redis,
            makeKey(['consumer-prices', 'retailer-spread', marketCode, basket.slug]),
            spread,
            1800,
          );
        } catch (err) {
          logger.error(`spread:${marketCode}:${basket.slug} failed: ${err}`);
        }

        for (const range of ['7d', '30d', '90d']) {
          try {
            const series = await buildBasketSeriesSnapshot(marketCode, basket.slug, range);
            await writeSnapshot(
              redis,
              makeKey(['consumer-prices', 'basket-series', marketCode, basket.slug, range]),
              series,
              3600,
            );
          } catch (err) {
            logger.error(`basket-series:${marketCode}:${basket.slug}:${range} failed: ${err}`);
          }
        }
      }
    }

    logger.info('Publish complete');
  } finally {
    await redis.disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  publishAll().catch(console.error);
}
