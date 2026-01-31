// HDX HAPI (Humanitarian API) proxy
// Returns aggregated conflict event counts per country
// Source: ACLED data aggregated monthly by HDX
export const config = { runtime: 'edge' };

let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

export default async function handler(req) {
  const now = Date.now();
  if (cache.data && now - cache.timestamp < CACHE_TTL) {
    return Response.json(cache.data, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=1800', 'X-Cache': 'HIT' },
    });
  }

  try {
    const appId = btoa('worldmonitor:monitor@worldmonitor.app');
    const response = await fetch(
      `https://hapi.humdata.org/api/v2/coordination-context/conflict-events?output_format=json&limit=1000&offset=0&app_identifier=${appId}`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HAPI API error: ${response.status}`);
    }

    const rawData = await response.json();
    const records = rawData.data || [];

    // Each record is (country, event_type, month) — aggregate across event types per country
    // Keep only the most recent month per country
    const byCountry = {};
    for (const r of records) {
      const iso3 = r.location_code || '';
      if (!iso3) continue;

      const month = r.reference_period_start || '';
      const eventType = (r.event_type || '').toLowerCase();
      const events = r.events || 0;
      const fatalities = r.fatalities || 0;

      if (!byCountry[iso3]) {
        byCountry[iso3] = { iso3, locationName: r.location_name || '', month, eventsTotal: 0, eventsPoliticalViolence: 0, eventsCivilianTargeting: 0, eventsDemonstrations: 0, fatalitiesTotalPoliticalViolence: 0, fatalitiesTotalCivilianTargeting: 0 };
      }

      const c = byCountry[iso3];
      if (month > c.month) {
        // Newer month — reset
        c.month = month;
        c.eventsTotal = 0; c.eventsPoliticalViolence = 0; c.eventsCivilianTargeting = 0; c.eventsDemonstrations = 0; c.fatalitiesTotalPoliticalViolence = 0; c.fatalitiesTotalCivilianTargeting = 0;
      }
      if (month === c.month) {
        c.eventsTotal += events;
        if (eventType.includes('political_violence')) { c.eventsPoliticalViolence += events; c.fatalitiesTotalPoliticalViolence += fatalities; }
        if (eventType.includes('civilian_targeting')) { c.eventsCivilianTargeting += events; c.fatalitiesTotalCivilianTargeting += fatalities; }
        if (eventType.includes('demonstration')) { c.eventsDemonstrations += events; }
      }
    }

    const result = {
      success: true,
      count: Object.keys(byCountry).length,
      countries: Object.values(byCountry),
      cached_at: new Date().toISOString(),
    };

    cache = { data: result, timestamp: now };

    return Response.json(result, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=1800', 'X-Cache': 'MISS' },
    });
  } catch (error) {
    if (cache.data) {
      return Response.json(cache.data, {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'X-Cache': 'STALE' },
      });
    }
    return Response.json({ error: `Fetch failed: ${error.message}`, countries: [] }, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
