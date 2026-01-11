export const config = { runtime: 'edge' };

const ALLOWED_CURRENCIES = ['usd', 'eur', 'gbp', 'jpy', 'cny', 'btc', 'eth'];
const MAX_COIN_IDS = 20;
const COIN_ID_PATTERN = /^[a-z0-9-]+$/;

function validateCoinIds(idsParam) {
  if (!idsParam) return 'bitcoin,ethereum,solana';

  const ids = idsParam.split(',')
    .map(id => id.trim().toLowerCase())
    .filter(id => COIN_ID_PATTERN.test(id) && id.length <= 50)
    .slice(0, MAX_COIN_IDS);

  return ids.length > 0 ? ids.join(',') : 'bitcoin,ethereum,solana';
}

function validateCurrency(val) {
  const currency = (val || 'usd').toLowerCase();
  return ALLOWED_CURRENCIES.includes(currency) ? currency : 'usd';
}

function validateBoolean(val, defaultVal) {
  if (val === 'true' || val === 'false') return val;
  return defaultVal;
}

export default async function handler(req) {
  const url = new URL(req.url);

  const ids = validateCoinIds(url.searchParams.get('ids'));
  const vsCurrencies = validateCurrency(url.searchParams.get('vs_currencies'));
  const include24hrChange = validateBoolean(url.searchParams.get('include_24hr_change'), 'true');

  try {
    const geckoUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vsCurrencies}&include_24hr_change=${include24hrChange}`;
    const response = await fetch(geckoUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
