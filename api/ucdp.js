// UCDP (Uppsala Conflict Data Program) proxy
// Returns conflict classification per country with intensity levels
// No auth required - public API
export const config = { runtime: 'edge' };

let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (annual data)

export default async function handler(req) {
  const now = Date.now();
  if (cache.data && now - cache.timestamp < CACHE_TTL) {
    return Response.json(cache.data, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'HIT' },
    });
  }

  try {
    // Fetch all pages of conflicts
    let allConflicts = [];
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const response = await fetch(`https://ucdpapi.pcr.uu.se/api/ucdpprioconflict/24.1?pagesize=100&page=${page}`, {
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`UCDP API error: ${response.status}`);
      }

      const rawData = await response.json();
      totalPages = rawData.TotalPages || 1;
      const conflicts = rawData.Result || [];
      allConflicts = allConflicts.concat(conflicts);
      page++;
    }

    // Fields are snake_case: conflict_id, location, side_a, side_b, year, intensity_level, type_of_conflict
    const countryConflicts = {};
    for (const c of allConflicts) {
      const name = c.location || '';
      const year = parseInt(c.year, 10) || 0;
      const intensity = parseInt(c.intensity_level, 10) || 0;

      const entry = {
        conflictId: parseInt(c.conflict_id, 10) || 0,
        conflictName: c.side_b || '',
        location: name,
        year,
        intensityLevel: intensity,
        typeOfConflict: parseInt(c.type_of_conflict, 10) || 0,
        startDate: c.start_date,
        startDate2: c.start_date2,
        sideA: c.side_a,
        sideB: c.side_b,
        region: c.region,
      };

      // Keep most recent / highest intensity per location
      if (!countryConflicts[name] || year > countryConflicts[name].year ||
          (year === countryConflicts[name].year && intensity > countryConflicts[name].intensityLevel)) {
        countryConflicts[name] = entry;
      }
    }

    const result = {
      success: true,
      count: Object.keys(countryConflicts).length,
      conflicts: Object.values(countryConflicts),
      cached_at: new Date().toISOString(),
    };

    cache = { data: result, timestamp: now };

    return Response.json(result, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'MISS' },
    });
  } catch (error) {
    if (cache.data) {
      return Response.json(cache.data, {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'X-Cache': 'STALE' },
      });
    }
    return Response.json({ error: `Fetch failed: ${error.message}`, conflicts: [] }, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
