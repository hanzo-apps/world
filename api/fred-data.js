import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
export const config = { runtime: 'edge' };

const FETCH_TIMEOUT_MS = 8000;

async function fetchOneSeries(seriesId, apiKey, observationStart, observationEnd) {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: '10',
  });
  if (observationStart) params.set('observation_start', observationStart);
  if (observationEnd) params.set('observation_end', observationEnd);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.stlouisfed.org/fred/series/observations?${params}`,
      { headers: { Accept: 'application/json' }, signal: controller.signal },
    );
    if (!response.ok) return { series_id: seriesId, observations: [], error: `HTTP ${response.status}` };
    const data = await response.json();
    return { series_id: seriesId, observations: data.observations || [] };
  } catch (e) {
    return { series_id: seriesId, observations: [], error: e.message };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, { status: 403, headers: corsHeaders });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  if (isDisallowedOrigin(req)) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const seriesParam = url.searchParams.get('series_id');
  const observationStart = url.searchParams.get('observation_start');
  const observationEnd = url.searchParams.get('observation_end');

  if (!seriesParam) {
    return Response.json({ error: 'Missing series_id parameter' }, { status: 400, headers: corsHeaders });
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return Response.json({ observations: [], skipped: true, reason: 'FRED_API_KEY not configured' }, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60', 'X-Data-Status': 'skipped-no-api-key' },
    });
  }

  const MAX_BATCH = 15;
  // Support comma-separated series_id for batch requests (e.g. ?series_id=FEDFUNDS,UNRATE,DGS10)
  const seriesIds = [...new Set(seriesParam.split(',').map(s => s.trim()).filter(Boolean))];

  if (seriesIds.length > MAX_BATCH) {
    return Response.json({ error: `Too many series requested (max ${MAX_BATCH})` }, { status: 400, headers: corsHeaders });
  }

  if (seriesIds.length === 1) {
    // Single series — backwards compatible response shape; propagate upstream errors
    const result = await fetchOneSeries(seriesIds[0], apiKey, observationStart, observationEnd);
    if (result.error) {
      return Response.json({ observations: [], error: result.error }, {
        status: 502,
        headers: { ...corsHeaders, 'Cache-Control': 'no-cache' },
      });
    }
    return Response.json({ observations: result.observations }, {
      status: 200,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
    });
  }

  // Batch mode — fetch all in parallel, return keyed by series_id
  const results = await Promise.all(
    seriesIds.map(id => fetchOneSeries(id, apiKey, observationStart, observationEnd)),
  );

  const batch = {};
  let failedCount = 0;
  for (const r of results) {
    batch[r.series_id] = { observations: r.observations, ...(r.error && { error: r.error }) };
    if (r.error) failedCount++;
  }

  // All failed — don't cache, return 502
  if (failedCount === results.length) {
    return Response.json({ batch, error: 'All upstream requests failed' }, {
      status: 502,
      headers: { ...corsHeaders, 'Cache-Control': 'no-cache' },
    });
  }

  return Response.json({ batch, ...(failedCount > 0 && { partial: true }) }, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Cache-Control': failedCount > 0
        ? 'public, max-age=300, s-maxage=300, stale-while-revalidate=60'
        : 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600',
    },
  });
}
