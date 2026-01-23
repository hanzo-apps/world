export const config = { runtime: 'edge' };

// Scrape FwdStart newsletter archive and return as RSS
export default async function handler(req) {
  try {
    const response = await fetch('https://www.fwdstart.me/archive', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const items = [];
    const seenUrls = new Set();

    // Find all post links and extract data
    // Pattern: <a href="/p/slug">...<img alt="Title">...<p>Date</p>
    const postBlockPattern = /<a[^>]*href="(\/p\/[^"]+)"[^>]*class="[^"]*embla[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    while ((match = postBlockPattern.exec(html)) !== null) {
      const url = `https://www.fwdstart.me${match[1]}`;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const blockContent = match[2];

      // Extract title from img alt attribute
      const altMatch = blockContent.match(/alt="([^"]+)"/);
      let title = altMatch ? altMatch[1] : '';

      // If no alt, try to get title from slug
      if (!title) {
        const slug = match[1].replace('/p/', '');
        title = slug
          .replace(/-/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
          .slice(0, 100);
      }

      // Extract date - look for patterns like "Jan 23, 2026" or "Dec 15, 2025"
      const dateMatch = blockContent.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i);
      let pubDate = new Date();
      if (dateMatch) {
        const parsed = new Date(dateMatch[0]);
        if (!isNaN(parsed.getTime())) {
          pubDate = parsed;
        }
      }

      // Extract description/subtitle if available
      const subtitleMatch = blockContent.match(/subtitle[^>]*>([^<]+)</i);
      const description = subtitleMatch ? subtitleMatch[1].trim() : '';

      if (title && title.length > 3) {
        items.push({ title, link: url, date: pubDate.toISOString(), description });
      }
    }

    // Fallback: simpler pattern if embla class not found
    if (items.length === 0) {
      const simplePattern = /href="(\/p\/[^"]+)"[^>]*>[\s\S]*?alt="([^"]+)"/gi;
      while ((match = simplePattern.exec(html)) !== null) {
        const url = `https://www.fwdstart.me${match[1]}`;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        const title = match[2];
        if (title && title.length > 3) {
          items.push({
            title,
            link: url,
            date: new Date().toISOString(),
            description: '',
          });
        }
      }
    }

    // Last fallback: just extract URLs and generate titles from slugs
    if (items.length === 0) {
      const urlPattern = /href="(\/p\/[\w-]+)"/g;
      while ((match = urlPattern.exec(html)) !== null) {
        const url = `https://www.fwdstart.me${match[1]}`;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        const slug = match[1].replace('/p/', '');
        const title = slug
          .replace(/-/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
          .slice(0, 100);

        items.push({
          title,
          link: url,
          date: new Date().toISOString(),
          description: '',
        });
      }
    }

    // Build RSS XML
    const rssItems = items.slice(0, 30).map(item => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.link}</link>
      <guid>${item.link}</guid>
      <pubDate>${new Date(item.date).toUTCString()}</pubDate>
      <description><![CDATA[${item.description}]]></description>
      <source url="https://www.fwdstart.me">FwdStart Newsletter</source>
    </item>`).join('');

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>FwdStart Newsletter</title>
    <link>https://www.fwdstart.me</link>
    <description>Forward-thinking startup and VC news from MENA and beyond</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="https://worldmonitor.app/api/fwdstart" rel="self" type="application/rss+xml"/>
    ${rssItems}
  </channel>
</rss>`;

    return new Response(rss, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=1800', // 30 min cache
      },
    });
  } catch (error) {
    console.error('FwdStart scraper error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch FwdStart archive',
      details: error.message
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
