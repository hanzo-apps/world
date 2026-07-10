/**
 * Tiny, XSS-safe Markdown → HTML renderer for analyst replies.
 *
 * Why hand-rolled (no dep): the whole app is framework-free vanilla TS and the
 * analyst output is a small, well-known Markdown subset. A ~200-line renderer we
 * control is smaller and safer than pulling marked + a sanitizer.
 *
 * Safety model (the ONE rule): the source is untrusted model text. NO raw HTML
 * is ever passed through — every text run is escaped exactly once, every link
 * href is run through sanitizeUrl (http/https/relative only). So the output HTML
 * can only contain the tags this file emits; a `<img onerror=…>` in the source
 * renders as inert text.
 *
 * Entity fix (P0): the backend HTML-escapes some replies, so an apostrophe
 * arrives as the literal `&#39;`. decodeEntities() runs FIRST (once), turning it
 * back into a real character; the renderer then re-escapes text runs on output —
 * a single, correct escape, so the browser shows `'`, never `&#39;`.
 */

import { escapeHtml, sanitizeUrl } from './sanitize';

// ── HTML entity decoding ─────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', middot: '·', bull: '•',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷',
  euro: '€', pound: '£', cent: '¢', sect: '§', para: '¶',
};

/** Decode HTML entities (named + numeric decimal/hex) to real characters. */
export function decodeEntities(input: string): string {
  if (!input || input.indexOf('&') === -1) return input || '';
  return input.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    }
    const v = NAMED_ENTITIES[body];
    return v !== undefined ? v : m;
  });
}

// ── Inline rendering ─────────────────────────────────────────────────────────

const SENTINEL = '\u0000'; // NUL: absent from model text, survives escapeHtml, no collisions

/** Render inline Markdown (bold/italic/strike/code/links) in one already
 *  entity-decoded run of text. Returns safe HTML. */
function inline(src: string): string {
  const tokens: string[] = [];
  const stash = (html: string): string => {
    tokens.push(html);
    return `${SENTINEL}${tokens.length - 1}${SENTINEL}`;
  };

  // 1) Protect code spans and links BEFORE escaping, so their raw text/urls are
  //    handled correctly and no emphasis is applied inside them.
  let s = src.replace(/`([^`\n]+)`/g, (_m, code: string) => stash(`<code>${escapeHtml(code)}</code>`));

  s = s.replace(/(!?)\[([^\]\n]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_m, bang: string, text: string, url: string) => {
    const safe = sanitizeUrl(url);
    const label = escapeHtml(text || url);
    if (bang) return stash(label); // images render as their alt text (no remote loads)
    if (!safe) return stash(label);
    return stash(`<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  });

  // 2) Escape everything else exactly once. Markdown delimiters survive escaping.
  s = escapeHtml(s);

  // 3) Emphasis (bold before italic so ** isn't eaten by *). Strikethrough too.
  s = s
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

  // 4) Restore protected tokens.
  return s.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'), (_m, i: string) => tokens[Number(i)] ?? '');
}

// ── Block rendering ──────────────────────────────────────────────────────────

const RE = {
  fence: /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/,
  heading: /^(#{1,6})\s+(.*)$/,
  hr: /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/,
  quote: /^\s*>\s?(.*)$/,
  ul: /^(\s*)[-*+]\s+(.*)$/,
  ol: /^(\s*)(\d+)[.)]\s+(.*)$/,
};

interface ListFrame {
  tag: 'ul' | 'ol';
  indent: number;
}

/** Render a Markdown string to XSS-safe HTML. */
export function renderMarkdown(raw: string): string {
  const text = decodeEntities(raw ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const out: string[] = [];
  const listStack: ListFrame[] = [];
  let para: string[] = [];

  const closeLists = (toIndent = -1): void => {
    while (listStack.length && listStack[listStack.length - 1]!.indent > toIndent) {
      out.push(`</li></${listStack.pop()!.tag}>`);
    }
  };
  const flushPara = (): void => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushAll = (): void => {
    flushPara();
    closeLists(-1);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Fenced code block.
    const fence = line.match(RE.fence);
    if (fence) {
      flushAll();
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      for (; i < lines.length; i++) {
        if (lines[i]!.trimStart().startsWith(marker[0]!.repeat(3)) && lines[i]!.trim().replace(/[`~]/g, '') === '') break;
        body.push(lines[i]!);
      }
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      flushPara();
      closeLists(-1);
      continue;
    }

    if (RE.hr.test(line)) {
      flushAll();
      out.push('<hr>');
      continue;
    }

    const h = line.match(RE.heading);
    if (h) {
      flushAll();
      const level = Math.min(6, h[1]!.length);
      out.push(`<h${level}>${inline(h[2]!.trim())}</h${level}>`);
      continue;
    }

    const quote = line.match(RE.quote);
    if (quote) {
      flushPara();
      closeLists(-1);
      const buf = [quote[1]!];
      while (i + 1 < lines.length && RE.quote.test(lines[i + 1]!)) {
        buf.push(lines[++i]!.match(RE.quote)![1]!);
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    const ul = line.match(RE.ul);
    const ol = line.match(RE.ol);
    if (ul || ol) {
      flushPara();
      const indent = (ul ? ul[1]! : ol![1]!).length;
      const tag: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      const content = ul ? ul[2]! : ol![3]!;

      // Close deeper lists; open when indenting; close-then-open on tag change.
      closeLists(indent);
      const top = listStack[listStack.length - 1];
      if (!top || indent > top.indent) {
        out.push(`<${tag}><li>`);
        listStack.push({ tag, indent });
      } else if (top.tag !== tag) {
        out.push(`</li></${top.tag}>`);
        listStack.pop();
        out.push(`<${tag}><li>`);
        listStack.push({ tag, indent });
      } else {
        out.push('</li><li>');
      }
      out.push(inline(content));
      continue;
    }

    // Plain text → accumulate into a paragraph (unless it continues a list item).
    if (listStack.length) {
      out.push(' ' + inline(line.trim()));
    } else {
      para.push(line.trim());
    }
  }

  flushAll();
  return out.join('');
}
