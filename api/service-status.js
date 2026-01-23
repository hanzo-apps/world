export const config = { runtime: 'edge' };

// Major tech services and their status page endpoints
const SERVICES = [
  // Cloud Providers
  { id: 'aws', name: 'AWS', url: 'https://health.aws.amazon.com/health/status', category: 'cloud' },
  { id: 'azure', name: 'Azure', url: 'https://status.azure.com/en-us/status', category: 'cloud' },
  { id: 'gcp', name: 'Google Cloud', url: 'https://status.cloud.google.com/', category: 'cloud' },
  { id: 'cloudflare', name: 'Cloudflare', statusPage: 'https://www.cloudflarestatus.com/api/v2/status.json', category: 'cloud' },
  { id: 'vercel', name: 'Vercel', statusPage: 'https://www.vercel-status.com/api/v2/status.json', category: 'cloud' },
  { id: 'netlify', name: 'Netlify', statusPage: 'https://www.netlifystatus.com/api/v2/status.json', category: 'cloud' },

  // Developer Tools
  { id: 'github', name: 'GitHub', statusPage: 'https://www.githubstatus.com/api/v2/status.json', category: 'dev' },
  { id: 'gitlab', name: 'GitLab', statusPage: 'https://status.gitlab.com/api/v2/status.json', category: 'dev' },
  { id: 'npm', name: 'npm', statusPage: 'https://status.npmjs.org/api/v2/status.json', category: 'dev' },
  { id: 'docker', name: 'Docker Hub', statusPage: 'https://www.dockerstatus.com/api/v2/status.json', category: 'dev' },

  // Communication
  { id: 'slack', name: 'Slack', statusPage: 'https://status.slack.com/api/v2.0.0/current', category: 'comm' },
  { id: 'discord', name: 'Discord', statusPage: 'https://discordstatus.com/api/v2/status.json', category: 'comm' },
  { id: 'zoom', name: 'Zoom', statusPage: 'https://status.zoom.us/api/v2/status.json', category: 'comm' },

  // AI Services
  { id: 'openai', name: 'OpenAI', statusPage: 'https://status.openai.com/api/v2/status.json', category: 'ai' },
  { id: 'anthropic', name: 'Anthropic', url: 'https://status.anthropic.com/', category: 'ai' },

  // SaaS
  { id: 'stripe', name: 'Stripe', statusPage: 'https://status.stripe.com/api/v2/status.json', category: 'saas' },
  { id: 'twilio', name: 'Twilio', statusPage: 'https://status.twilio.com/api/v2/status.json', category: 'saas' },
  { id: 'datadog', name: 'Datadog', statusPage: 'https://status.datadoghq.com/api/v2/status.json', category: 'saas' },
];

// Statuspage.io API returns status like: none, minor, major, critical
function normalizeStatus(indicator) {
  switch (indicator?.toLowerCase()) {
    case 'none':
    case 'operational':
      return 'operational';
    case 'minor':
    case 'degraded_performance':
    case 'partial_outage':
      return 'degraded';
    case 'major':
    case 'major_outage':
    case 'critical':
      return 'outage';
    default:
      return 'unknown';
  }
}

async function checkStatusPage(service) {
  if (!service.statusPage) {
    return { ...service, status: 'unknown', description: 'No API available' };
  }

  try {
    const response = await fetch(service.statusPage, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { ...service, status: 'unknown', description: 'API unreachable' };
    }

    const data = await response.json();

    // Handle different API formats
    let status, description;

    if (data.status?.indicator) {
      // Standard Statuspage.io format
      status = normalizeStatus(data.status.indicator);
      description = data.status.description || '';
    } else if (data.status?.status) {
      // Slack format
      status = data.status.status === 'ok' ? 'operational' : 'degraded';
      description = data.status.description || '';
    } else {
      status = 'unknown';
      description = 'Unknown format';
    }

    return { ...service, status, description };
  } catch (error) {
    return { ...service, status: 'unknown', description: error.message };
  }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category'); // cloud, dev, comm, ai, saas, or all

  let servicesToCheck = SERVICES;
  if (category && category !== 'all') {
    servicesToCheck = SERVICES.filter(s => s.category === category);
  }

  // Check all services in parallel
  const results = await Promise.all(servicesToCheck.map(checkStatusPage));

  // Sort by status (outages first, then degraded, then operational)
  const statusOrder = { outage: 0, degraded: 1, unknown: 2, operational: 3 };
  results.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  const summary = {
    operational: results.filter(r => r.status === 'operational').length,
    degraded: results.filter(r => r.status === 'degraded').length,
    outage: results.filter(r => r.status === 'outage').length,
    unknown: results.filter(r => r.status === 'unknown').length,
  };

  return new Response(JSON.stringify({
    success: true,
    timestamp: new Date().toISOString(),
    summary,
    services: results.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      status: r.status,
      description: r.description,
    })),
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60', // 1 min cache
    },
  });
}
