// WatchQueue — the single source of truth for consumable media.
//
// The world surfaces media from three unrelated producers: non-live news video
// clips, images/videos the AI analyst pulls mid-answer, and news "story" cards.
// Before this they flashed by and couldn't be consumed reliably. WatchQueue
// unifies them into ONE ordered queue with tracked per-item state so you can
// step through it (next/prev), and each item is marked watched when you move on
// — "tracked watch and finished correctly".
//
// This module is pure logic: no DOM, no framework. It owns the queue value and
// its transitions; the panel and immersive player are just views over it. State
// persists to localStorage so the queue and what you've already watched survive
// a reload. One invariant, enforced in one place (setCurrent): at most one item
// is 'watching', and leaving an item marks it 'watched'.

export type QueueItemKind = 'video' | 'image' | 'story';
export type QueueItemStatus = 'queued' | 'watching' | 'watched';

export interface QueueItem {
  /** Stable dedup key derived from the source ref — enqueue is idempotent on it. */
  id: string;
  kind: QueueItemKind;
  title: string;
  /** Producer label shown in the list, e.g. 'Bloomberg', 'AI', 'Reuters'. */
  source: string;
  /** What to render: a YouTube videoId (video), an image URL (image), or a link (story). */
  ref: string;
  /** Optional preview image (story/video thumbnail). */
  thumbnail?: string;
  /** Optional deep link (story article, video watch URL). */
  link?: string;
  addedAt: number;
  status: QueueItemStatus;
}

export type QueueItemInput = Omit<QueueItem, 'addedAt' | 'status'> & { addedAt?: number };

const STORAGE_KEY = 'hanzo-world-watch-queue';
// Bound the queue so AI-surfaced media can't grow it without limit. When over
// the cap we prune the oldest WATCHED items first (never anything unwatched or
// current), so consumption history is trimmed but the backlog is preserved.
const MAX_ITEMS = 200;

interface Persisted {
  items: QueueItem[];
  currentId: string | null;
}

export class WatchQueue {
  private items: QueueItem[] = [];
  private currentId: string | null = null;
  private listeners = new Set<() => void>();
  private readonly now: () => number;

  // `now` is injectable so tests are deterministic; defaults to Date.now.
  constructor(now: () => number = () => Date.now()) {
    this.now = now;
    this.load();
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /** A defensive copy of the ordered queue. */
  list(): QueueItem[] {
    return this.items.map((it) => ({ ...it }));
  }

  /**
   * The item to show now: the explicit current, else the first unwatched item
   * (so a freshly-filled queue has something to play without a forced mutation).
   * Returns null only when every item is watched or the queue is empty.
   */
  current(): QueueItem | null {
    if (this.currentId) {
      const it = this.items.find((i) => i.id === this.currentId);
      if (it) return { ...it };
    }
    const first = this.items.find((i) => i.status !== 'watched');
    return first ? { ...first } : null;
  }

  get length(): number {
    return this.items.length;
  }

  /** Count of items not yet watched — the "up next" backlog size. */
  unwatchedCount(): number {
    return this.items.filter((i) => i.status !== 'watched').length;
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /**
   * Add an item, idempotent on id. A re-surfaced clip/image (same id) is NOT
   * re-queued or reset — that's what makes consumption reliable rather than a
   * flicker of duplicates. Returns the live item (new or pre-existing).
   */
  enqueue(input: QueueItemInput): QueueItem {
    const existing = this.items.find((i) => i.id === input.id);
    if (existing) return { ...existing };

    const item: QueueItem = {
      ...input,
      addedAt: input.addedAt ?? this.now(),
      status: 'queued',
    };
    this.items.push(item);
    this.prune();
    this.commit();
    return { ...item };
  }

  /** Make `id` the current item and mark it 'watching' (re-watch is allowed). */
  select(id: string): QueueItem | null {
    if (!this.items.some((i) => i.id === id)) return null;
    this.setCurrent(id);
    this.commit();
    return this.current();
  }

  /**
   * Finish the current item and advance to the next one in order. Returns the
   * new current, or null when the queue is consumed (cursor falls off the end).
   */
  next(): QueueItem | null {
    const idx = this.currentIndex();
    // Nothing current yet → start at the first unwatched item.
    if (idx < 0) {
      const first = this.items.find((i) => i.status !== 'watched');
      if (!first) return null;
      this.setCurrent(first.id);
      this.commit();
      return this.current();
    }
    const nextItem = this.items[idx + 1];
    if (!nextItem) {
      // At the end: finish the last item and leave nothing current.
      this.markStatus(this.items[idx], 'watched');
      this.currentId = null;
      this.commit();
      return null;
    }
    this.setCurrent(nextItem.id);
    this.commit();
    return this.current();
  }

  /** Step back to the previous item (re-watch). No-op at the front. */
  prev(): QueueItem | null {
    const idx = this.currentIndex();
    const target = this.items[idx - 1];
    if (!target) return this.current();
    this.setCurrent(target.id);
    this.commit();
    return this.current();
  }

  /** Force an item to 'watched' without changing which item is current. */
  markWatched(id: string): void {
    const it = this.items.find((i) => i.id === id);
    if (!it || it.status === 'watched') return;
    it.status = 'watched';
    if (this.currentId === id) this.currentId = null;
    this.commit();
  }

  remove(id: string): void {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length === before) return;
    if (this.currentId === id) this.currentId = null;
    this.commit();
  }

  /** Drop every watched item — clear consumed history, keep the backlog. */
  clearWatched(): void {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.status !== 'watched');
    if (this.items.length !== before) this.commit();
  }

  clear(): void {
    this.items = [];
    this.currentId = null;
    this.commit();
  }

  // ── subscription ───────────────────────────────────────────────────────────

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private currentIndex(): number {
    if (!this.currentId) return -1;
    return this.items.findIndex((i) => i.id === this.currentId);
  }

  // The one place the "at most one 'watching', leaving marks 'watched'"
  // invariant lives. Leaving the prior current marks it finished; the target
  // becomes 'watching' (unless already watched, in which case re-watching it
  // flips it back to 'watching').
  private setCurrent(id: string): void {
    if (this.currentId && this.currentId !== id) {
      const prev = this.items.find((i) => i.id === this.currentId);
      if (prev && prev.status === 'watching') prev.status = 'watched';
    }
    const target = this.items.find((i) => i.id === id);
    if (target) target.status = 'watching';
    this.currentId = id;
  }

  private markStatus(item: QueueItem | undefined, status: QueueItemStatus): void {
    if (item) item.status = status;
  }

  private prune(): void {
    if (this.items.length <= MAX_ITEMS) return;
    const overflow = this.items.length - MAX_ITEMS;
    let dropped = 0;
    // Remove oldest watched items (list is append-ordered) until back under cap.
    this.items = this.items.filter((it) => {
      if (dropped >= overflow) return true;
      if (it.status === 'watched' && it.id !== this.currentId) {
        dropped++;
        return false;
      }
      return true;
    });
  }

  private commit(): void {
    this.save();
    for (const fn of this.listeners) fn();
  }

  private save(): void {
    try {
      const data: Persisted = { items: this.items, currentId: this.currentId };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable / quota — queue still works in-memory this session */
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<Persisted>;
      if (!Array.isArray(data.items)) return;
      // Trust but validate: keep only well-formed items.
      this.items = data.items.filter(
        (it): it is QueueItem =>
          !!it && typeof it.id === 'string' && typeof it.ref === 'string' &&
          (it.kind === 'video' || it.kind === 'image' || it.kind === 'story'),
      );
      this.currentId = typeof data.currentId === 'string' &&
        this.items.some((i) => i.id === data.currentId)
        ? data.currentId
        : null;
    } catch {
      /* corrupt storage — start clean */
    }
  }
}

// Process-wide singleton: exactly one queue, shared by every producer and view.
export const watchQueue = new WatchQueue();
