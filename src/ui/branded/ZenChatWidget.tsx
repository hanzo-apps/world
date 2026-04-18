import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@hanzo/ui/primitives/sheet';
import { Button } from '@hanzo/ui/primitives/button';
import { Input } from '@hanzo/ui/primitives/input';
import { MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/cn';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Read current map context from the global worldmonitor state.
 *
 * The legacy app exposes its state on `window` for debug already. This is a
 * minimal read-only probe. If the shape changes this quietly falls back to
 * an empty context — Zen still answers, just without the viewport.
 */
function readMapContext() {
  const win = window as unknown as {
    geoDebug?: { count?: () => number };
    __wmActiveLayers?: string[];
    __wmMapCenter?: { lat: number; lon: number; zoom: number };
  };
  return {
    active_layers: win.__wmActiveLayers ?? [],
    map_center: win.__wmMapCenter ?? null,
    cell_count: win.geoDebug?.count?.() ?? 0,
  };
}

export function ZenChatWidget({ endpoint = '/v1/world/chat' }: { endpoint?: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'I am Zen. Ask me about the map, a country, or a live event. I can see your active layers and viewport.',
    },
  ]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');

    const userMsg: ChatMessage = { role: 'user', content: text };
    const assistantMsg: ChatMessage = { role: 'assistant', content: '' };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
          context: readMapContext(),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as { content?: string };
            if (parsed.content) {
              setMessages((prev) => {
                const next = prev.slice();
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: last.content + parsed.content };
                }
                return next;
              });
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = prev.slice();
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          next[next.length - 1] = {
            ...last,
            content: `Sorry, chat is not available right now. (${err instanceof Error ? err.message : 'unknown'})`,
          };
        }
        return next;
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Floating bubble */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            aria-label="Open Zen chat"
            className={cn(
              'hanzo-chat-widget hanzo-chrome font-inter fixed bottom-6 right-6 z-40',
              'flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105',
              'bg-primary text-primary-foreground',
            )}
          >
            <MessageCircle className="h-5 w-5" />
          </button>
        </SheetTrigger>
        <SheetContent
          side="right"
          className="hanzo-chrome font-inter flex h-full w-full flex-col bg-background p-0 sm:max-w-md"
        >
          <SheetHeader className="flex flex-row items-center justify-between gap-2 border-b border-border p-4">
            <SheetTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Sparkles className="h-4 w-4" />
              Zen
            </SheetTitle>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </SheetHeader>

          <div
            ref={listRef}
            className="flex-1 space-y-4 overflow-y-auto p-4 text-sm"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2',
                  m.role === 'user'
                    ? 'ml-auto bg-primary text-primary-foreground'
                    : 'bg-secondary text-foreground',
                )}
              >
                {m.content || (sending && i === messages.length - 1 ? <span className="text-muted-foreground">...</span> : null)}
              </div>
            ))}
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-border bg-background p-3"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Zen..."
              disabled={sending}
              autoComplete="off"
              className="flex-1 bg-secondary"
            />
            <Button
              type="submit"
              size="icon"
              disabled={sending || !input.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
