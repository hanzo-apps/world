import { useEffect, useRef, useState } from 'react';
import { Sheet, XStack, YStack, Text, Button, Input, ScrollView } from '@hanzo/gui';
import { getAccessToken } from '../lib/iam-auth';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function getMapContext() {
  try {
    const u = new URL(window.location.href);
    const lat = Number(u.searchParams.get('lat'));
    const lon = Number(u.searchParams.get('lon'));
    const zoom = Number(u.searchParams.get('zoom'));
    const layers = (u.searchParams.get('layers') || '').split(',').filter(Boolean);
    return Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon, zoom: Number.isFinite(zoom) ? zoom : 2, layers }
      : null;
  } catch {
    return null;
  }
}

export function ZenChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  async function send() {
    const q = input.trim();
    if (!q || streaming) return;
    setInput('');
    const next = [...messages, { role: 'user' as const, content: q }];
    setMessages(next);
    setStreaming(true);

    try {
      const token = getAccessToken();
      const res = await fetch('/v1/world/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages: next, mapContext: getMapContext() }),
      });
      if (!res.body) throw new Error('no stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      setMessages((m) => [...m, { role: 'assistant', content: '' }]);
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const delta = j.choices?.[0]?.delta?.content || '';
            if (delta) {
              acc += delta;
              setMessages((m) => {
                const copy = m.slice();
                copy[copy.length - 1] = { role: 'assistant', content: acc };
                return copy;
              });
            }
          } catch {
            /* keepalive or non-JSON line */
          }
        }
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `Sorry — chat is unavailable right now. (${(err as Error).message})` },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <>
      <Button
        position="fixed"
        bottom={20}
        right={20}
        size="$4"
        circular
        backgroundColor="$color"
        color="$background"
        zIndex={90}
        onPress={() => setOpen(true)}
      >
        ✦
      </Button>

      <Sheet open={open} onOpenChange={setOpen} snapPoints={[80]} dismissOnSnapToBottom>
        <Sheet.Overlay />
        <Sheet.Frame
          padding="$4"
          gap="$3"
          backgroundColor="$background"
          borderTopWidth={1}
          borderTopColor="$borderColor"
        >
          <XStack justifyContent="space-between" alignItems="center">
            <Text fontSize={16} fontWeight="600" color="$color">
              Zen AI analyst
            </Text>
            <Button size="$2" chromeless onPress={() => setOpen(false)}>
              Close
            </Button>
          </XStack>

          <ScrollView ref={scrollRef as never} flex={1}>
            <YStack gap="$3">
              {messages.length === 0 ? (
                <Text fontSize={13} color="$colorPress">
                  Ask anything about what's happening on the dashboard right now —
                  conflicts, markets, infrastructure, weather. Grounded in live
                  feeds.
                </Text>
              ) : (
                messages.map((m, i) => (
                  <XStack
                    key={i}
                    justifyContent={m.role === 'user' ? 'flex-end' : 'flex-start'}
                  >
                    <YStack
                      maxWidth="80%"
                      padding="$3"
                      borderRadius="$3"
                      backgroundColor={m.role === 'user' ? '$color' : '$backgroundPress'}
                    >
                      <Text fontSize={13} color={m.role === 'user' ? '$background' : '$color'}>
                        {m.content || (m.role === 'assistant' && streaming ? '…' : '')}
                      </Text>
                    </YStack>
                  </XStack>
                ))
              )}
            </YStack>
          </ScrollView>

          <XStack gap="$2">
            <Input
              flex={1}
              size="$4"
              placeholder="Ask Zen…"
              value={input}
              onChangeText={setInput}
              onSubmitEditing={send}
              disabled={streaming}
            />
            <Button size="$4" onPress={send} disabled={streaming || !input.trim()}>
              Send
            </Button>
          </XStack>
        </Sheet.Frame>
      </Sheet>
    </>
  );
}
