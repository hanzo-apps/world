/**
 * Summarization Service with Fallback Chain
 * Groq -> OpenRouter -> Browser T5 (lazy loaded)
 */

import { mlWorker } from './ml-worker';

export type SummarizationProvider = 'groq' | 'openrouter' | 'browser' | 'cache';

export interface SummarizationResult {
  summary: string;
  provider: SummarizationProvider;
  cached: boolean;
}

export type ProgressCallback = (step: number, total: number, message: string) => void;

// Cache for summaries (30 min TTL)
const summaryCache = new Map<string, { summary: string; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCacheKey(headlines: string[]): string {
  return headlines.slice(0, 6).join('|').slice(0, 200);
}

function getCachedSummary(headlines: string[]): string | null {
  const key = getCacheKey(headlines);
  const cached = summaryCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.summary;
  }
  return null;
}

function setCachedSummary(headlines: string[], summary: string): void {
  const key = getCacheKey(headlines);
  summaryCache.set(key, { summary, timestamp: Date.now() });

  // Cleanup old entries
  if (summaryCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of summaryCache.entries()) {
      if (now - v.timestamp > CACHE_TTL_MS) {
        summaryCache.delete(k);
      }
    }
  }
}

async function tryGroq(headlines: string[]): Promise<string | null> {
  try {
    const response = await fetch('/api/groq-summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headlines, mode: 'brief' }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.fallback) return null; // Signal to try next provider
      throw new Error(`Groq error: ${response.status}`);
    }

    const data = await response.json();
    console.log('[Summarization] Groq success:', data.model);
    return data.summary;
  } catch (error) {
    console.warn('[Summarization] Groq failed:', error);
    return null;
  }
}

async function tryOpenRouter(headlines: string[]): Promise<string | null> {
  try {
    const response = await fetch('/api/openrouter-summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headlines, mode: 'brief' }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.fallback) return null;
      throw new Error(`OpenRouter error: ${response.status}`);
    }

    const data = await response.json();
    console.log('[Summarization] OpenRouter success:', data.model);
    return data.summary;
  } catch (error) {
    console.warn('[Summarization] OpenRouter failed:', error);
    return null;
  }
}

async function tryBrowserT5(headlines: string[]): Promise<string | null> {
  try {
    // Lazy load the ML worker models only when needed
    if (!mlWorker.isAvailable) {
      console.log('[Summarization] Browser ML not available');
      return null;
    }

    // Combine headlines for summarization
    const combinedText = headlines.slice(0, 6).map(h => h.slice(0, 80)).join('. ');
    const prompt = `Summarize the main themes from these news headlines in 2 sentences: ${combinedText}`;

    const [summary] = await mlWorker.summarize([prompt]);

    // Validate summary quality
    if (!summary || summary.length < 20 || summary.toLowerCase().includes('summarize')) {
      return null;
    }

    console.log('[Summarization] Browser T5 success');
    return summary;
  } catch (error) {
    console.warn('[Summarization] Browser T5 failed:', error);
    return null;
  }
}

/**
 * Generate a summary using the fallback chain: Groq -> OpenRouter -> Browser T5
 */
export async function generateSummary(
  headlines: string[],
  onProgress?: ProgressCallback
): Promise<SummarizationResult | null> {
  if (!headlines || headlines.length < 2) {
    return null;
  }

  const totalSteps = 4;

  // Step 1: Check cache
  onProgress?.(1, totalSteps, 'Checking cache...');
  const cached = getCachedSummary(headlines);
  if (cached) {
    console.log('[Summarization] Cache hit');
    return { summary: cached, provider: 'cache', cached: true };
  }

  // Step 2: Try Groq (fast, 1000/day)
  onProgress?.(2, totalSteps, 'Connecting to Groq AI...');
  const groqResult = await tryGroq(headlines);
  if (groqResult) {
    setCachedSummary(headlines, groqResult);
    return { summary: groqResult, provider: 'groq', cached: false };
  }

  // Step 3: Try OpenRouter (fallback, 50/day)
  onProgress?.(3, totalSteps, 'Trying OpenRouter...');
  const openRouterResult = await tryOpenRouter(headlines);
  if (openRouterResult) {
    setCachedSummary(headlines, openRouterResult);
    return { summary: openRouterResult, provider: 'openrouter', cached: false };
  }

  // Step 4: Try Browser T5 (local, unlimited but slower)
  onProgress?.(4, totalSteps, 'Loading local AI model...');
  const browserResult = await tryBrowserT5(headlines);
  if (browserResult) {
    setCachedSummary(headlines, browserResult);
    return { summary: browserResult, provider: 'browser', cached: false };
  }

  console.warn('[Summarization] All providers failed');
  return null;
}

/**
 * Clear the summary cache
 */
export function clearSummaryCache(): void {
  summaryCache.clear();
}
