/**
 * Summarization Service with Fallback Chain
 * Server-side Redis caching handles cross-user deduplication
 * Fallback: Hanzo gateway -> browser T5
 */

import { mlWorker } from './ml-worker';
import { getSiteVariant } from '@/config';
import { BETA_MODE } from '@/config/beta';
import { isFeatureAvailable } from './runtime-config';
import { fetchWithTimeout } from '@/utils';

export type SummarizationProvider = 'hanzo' | 'browser' | 'cache';

export interface SummarizationResult {
  summary: string;
  provider: SummarizationProvider;
  cached: boolean;
}

export type ProgressCallback = (step: number, total: number, message: string) => void;

/**
 * Summarize on OUR stack.
 *
 * This replaces `tryGroq` + `tryOpenRouter`, which were not two providers: both
 * called `/v1/world/{groq,openrouter}-summarize`, and BOTH of those routes are
 * the same Go handler (`handleSummarize`) hitting api.hanzo.ai. So the
 * "fallback" was the identical request twice — a retry wearing a second
 * vendor's name, which is also why the console announced `Groq success` for
 * work Hanzo did.
 */
async function tryHanzo(headlines: string[], geoContext?: string, lang?: string): Promise<SummarizationResult | null> {
  if (!isFeatureAvailable('aiSummary')) return null;
  try {
    const response = await fetchWithTimeout('/v1/world/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headlines, mode: 'brief', geoContext, variant: getSiteVariant(), lang }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.fallback) return null;
      throw new Error(`Summarize error: ${response.status}`);
    }

    const data = await response.json();
    const provider: SummarizationProvider = data.cached ? 'cache' : 'hanzo';
    console.log(`[Summarization] ${provider === 'cache' ? 'cache hit' : 'Hanzo'}:`, data.model);
    return { summary: data.summary, provider, cached: !!data.cached };
  } catch (error) {
    console.warn('[Summarization] failed:', error);
    return null;
  }
}

async function tryBrowserT5(headlines: string[], modelId?: string): Promise<SummarizationResult | null> {
  try {
    if (!mlWorker.isAvailable) {
      console.log('[Summarization] Browser ML not available');
      return null;
    }

    const combinedText = headlines.slice(0, 6).map(h => h.slice(0, 80)).join('. ');
    const prompt = `Summarize the main themes from these news headlines in 2 sentences: ${combinedText}`;

    const [summary] = await mlWorker.summarize([prompt], modelId);

    if (!summary || summary.length < 20 || summary.toLowerCase().includes('summarize')) {
      return null;
    }

    console.log('[Summarization] Browser T5 success');
    return {
      summary,
      provider: 'browser',
      cached: false,
    };
  } catch (error) {
    console.warn('[Summarization] Browser T5 failed:', error);
    return null;
  }
}

/**
 * Generate a summary: the Hanzo gateway, falling back to the local browser model.
 * Server-side Redis caching is handled by the API endpoints
 * @param geoContext Optional geographic signal context to include in the prompt
 */
export async function generateSummary(
  headlines: string[],
  onProgress?: ProgressCallback,
  geoContext?: string,
  lang: string = 'en'
): Promise<SummarizationResult | null> {
  if (!headlines || headlines.length < 2) {
    return null;
  }

  if (BETA_MODE) {
    const modelReady = mlWorker.isAvailable && mlWorker.isModelLoaded('summarization-beta');

    if (modelReady) {
      const totalSteps = 3;
      // Model already loaded — use browser T5-small first
      onProgress?.(1, totalSteps, 'Running local AI model (beta)...');
      const browserResult = await tryBrowserT5(headlines, 'summarization-beta');
      if (browserResult) {
        console.log('[BETA] Browser T5-small:', browserResult.summary);
        tryHanzo(headlines, geoContext).then(r => {
          if (r) console.log('[BETA] cloud comparison:', r.summary);
        }).catch(() => {});
        return browserResult;
      }

      // Warm model failed inference — cloud fallback
      onProgress?.(2, totalSteps, 'Summarizing...');
      const cloudResult = await tryHanzo(headlines, geoContext);
      if (cloudResult) return cloudResult;
    } else {
      const totalSteps = 4;
      console.log('[BETA] T5-small not loaded yet, using cloud providers first');
      // Kick off model load in background for next time
      if (mlWorker.isAvailable) {
        mlWorker.loadModel('summarization-beta').catch(() => {});
      }

      // Cloud while the local model loads
      onProgress?.(1, totalSteps, 'Summarizing...');
      const cloudResult = await tryHanzo(headlines, geoContext);
      if (cloudResult) {
        console.log('[BETA] cloud:', cloudResult.summary);
        return cloudResult;
      }

      // Last resort: try browser T5 (may have finished loading by now)
      if (mlWorker.isAvailable) {
        onProgress?.(3, totalSteps, 'Waiting for local AI model...');
        const browserResult = await tryBrowserT5(headlines, 'summarization-beta');
        if (browserResult) return browserResult;
      }

      onProgress?.(4, totalSteps, 'No providers available');
    }

    console.warn('[BETA] All providers failed');
    return null;
  }

  const totalSteps = 2;

  // Step 1: the Hanzo gateway (server-side cache in front of it)
  onProgress?.(1, totalSteps, 'Summarizing...');
  const cloudResult = await tryHanzo(headlines, geoContext, lang);
  if (cloudResult) {
    return cloudResult;
  }

  // Step 2: the local browser model (slower, but needs no session)
  onProgress?.(2, totalSteps, 'Loading local AI model...');
  const browserResult = await tryBrowserT5(headlines);
  if (browserResult) {
    return browserResult;
  }

  console.warn('[Summarization] All providers failed');
  return null;
}


/**
 * Translate text using the fallback chain
 * @param text Text to translate
 * @param targetLang Target language code (e.g., 'fr', 'es')
 */
export async function translateText(
  text: string,
  targetLang: string,
  onProgress?: ProgressCallback
): Promise<string | null> {
  if (!text) return null;

  if (isFeatureAvailable('aiSummary')) {
    onProgress?.(1, 2, 'Translating...');
    try {
      const response = await fetchWithTimeout('/v1/world/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headlines: [text],
          mode: 'translate',
          variant: targetLang
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.summary;
      }
    } catch (e) {
      console.warn('Translation failed', e);
    }
  }


  return null;
}
