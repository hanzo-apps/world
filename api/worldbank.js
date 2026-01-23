// Use Node.js runtime - Edge gets 403 from World Bank API

// Tech-related World Bank indicators
const TECH_INDICATORS = {
  // Digital Infrastructure
  'IT.NET.USER.ZS': 'Internet Users (% of population)',
  'IT.CEL.SETS.P2': 'Mobile Subscriptions (per 100 people)',
  'IT.NET.BBND.P2': 'Fixed Broadband Subscriptions (per 100 people)',
  'IT.NET.SECR.P6': 'Secure Internet Servers (per million people)',

  // Innovation & R&D
  'GB.XPD.RSDV.GD.ZS': 'R&D Expenditure (% of GDP)',
  'IP.PAT.RESD': 'Patent Applications (residents)',
  'IP.PAT.NRES': 'Patent Applications (non-residents)',
  'IP.TMK.TOTL': 'Trademark Applications',

  // High-Tech Trade
  'TX.VAL.TECH.MF.ZS': 'High-Tech Exports (% of manufactured exports)',
  'BX.GSR.CCIS.ZS': 'ICT Service Exports (% of service exports)',
  'TM.VAL.ICTG.ZS.UN': 'ICT Goods Imports (% of total goods imports)',

  // Education & Skills
  'SE.TER.ENRR': 'Tertiary Education Enrollment (%)',
  'SE.XPD.TOTL.GD.ZS': 'Education Expenditure (% of GDP)',

  // Economic Context
  'NY.GDP.MKTP.KD.ZG': 'GDP Growth (annual %)',
  'NY.GDP.PCAP.CD': 'GDP per Capita (current US$)',
  'NE.EXP.GNFS.ZS': 'Exports of Goods & Services (% of GDP)',
};

// Major tech economies to compare
const TECH_COUNTRIES = [
  'USA', 'CHN', 'JPN', 'DEU', 'KOR', 'GBR', 'IND', 'ISR', 'SGP', 'TWN',
  'FRA', 'CAN', 'SWE', 'NLD', 'CHE', 'FIN', 'IRL', 'AUS', 'BRA', 'IDN'
];

export default async function handler(req) {
  const url = new URL(req.url);
  const indicator = url.searchParams.get('indicator');
  const country = url.searchParams.get('country');
  const countries = url.searchParams.get('countries'); // comma-separated
  const years = url.searchParams.get('years') || '5';
  const action = url.searchParams.get('action');

  // Return available indicators
  if (action === 'indicators') {
    return new Response(JSON.stringify({
      indicators: TECH_INDICATORS,
      defaultCountries: TECH_COUNTRIES,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400', // Cache for 24h
      },
    });
  }

  // Validate indicator
  if (!indicator) {
    return new Response(JSON.stringify({
      error: 'Missing indicator parameter',
      availableIndicators: Object.keys(TECH_INDICATORS),
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Build country list
    let countryList = country || countries || TECH_COUNTRIES.join(';');
    if (countries) {
      countryList = countries.split(',').join(';');
    }

    // Calculate date range
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - parseInt(years);

    // World Bank API v2
    const wbUrl = `https://api.worldbank.org/v2/country/${countryList}/indicator/${indicator}?format=json&date=${startYear}:${currentYear}&per_page=1000`;

    const response = await fetch(wbUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'WorldMonitor/1.0 (https://worldmonitor.app)',
      },
    });

    if (!response.ok) {
      throw new Error(`World Bank API error: ${response.status}`);
    }

    const data = await response.json();

    // World Bank returns [metadata, data] array
    if (!data || !Array.isArray(data) || data.length < 2 || !data[1]) {
      return new Response(JSON.stringify({
        indicator,
        indicatorName: TECH_INDICATORS[indicator] || indicator,
        metadata: { page: 1, pages: 1, total: 0 },
        byCountry: {},
        latestByCountry: {},
        timeSeries: [],
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const [metadata, records] = data;

    // Transform data for easier frontend consumption
    const transformed = {
      indicator,
      indicatorName: TECH_INDICATORS[indicator] || (records[0]?.indicator?.value || indicator),
      metadata: {
        page: metadata.page,
        pages: metadata.pages,
        total: metadata.total,
      },
      // Group by country
      byCountry: {},
      // Latest values for comparison
      latestByCountry: {},
      // Time series for charts
      timeSeries: [],
    };

    for (const record of records || []) {
      const countryCode = record.countryiso3code || record.country?.id;
      const countryName = record.country?.value;
      const year = record.date;
      const value = record.value;

      if (!countryCode || value === null) continue;

      // Group by country
      if (!transformed.byCountry[countryCode]) {
        transformed.byCountry[countryCode] = {
          code: countryCode,
          name: countryName,
          values: [],
        };
      }
      transformed.byCountry[countryCode].values.push({ year, value });

      // Track latest value
      if (!transformed.latestByCountry[countryCode] ||
          year > transformed.latestByCountry[countryCode].year) {
        transformed.latestByCountry[countryCode] = {
          code: countryCode,
          name: countryName,
          year,
          value,
        };
      }

      // Add to time series
      transformed.timeSeries.push({
        countryCode,
        countryName,
        year,
        value,
      });
    }

    // Sort each country's values by year
    for (const country of Object.values(transformed.byCountry)) {
      country.values.sort((a, b) => a.year - b.year);
    }

    // Sort time series by year descending
    transformed.timeSeries.sort((a, b) => b.year - a.year || a.countryCode.localeCompare(b.countryCode));

    return new Response(JSON.stringify(transformed), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600', // Cache for 1h
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
      indicator,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
