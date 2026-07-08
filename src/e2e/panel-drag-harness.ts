// Deterministic harness for the panel drag + resize module. Mounts a fixed
// 3-column grid of panels wired to the real attachPanelDrag / attachPanelResize
// so Playwright can drive real pointer input against them without booting the
// whole app. Exposes window.__panelDragHarness for assertions.

import { attachPanelDrag, attachPanelResize } from '../services/panel-drag';

interface PanelDragHarness {
  ready: boolean;
  reorderCount: number;
  lastCommittedSpan: number | null;
  order: () => string[];
}

declare global {
  interface Window {
    __panelDragHarness?: PanelDragHarness;
  }
}

const PANEL_COUNT = 6;

function currentSpan(el: HTMLElement): number {
  if (el.classList.contains('span-4')) return 4;
  if (el.classList.contains('span-3')) return 3;
  if (el.classList.contains('span-2')) return 2;
  return 1;
}

function build(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; }
    body { margin: 0; background: #0b0b0b; color: #eee; font-family: system-ui, sans-serif; }
    .panels-grid {
      display: grid;
      grid-template-columns: repeat(3, 200px);
      grid-auto-rows: 200px;
      gap: 8px;
      padding: 8px;
      align-items: stretch;
    }
    .panel {
      position: relative;
      min-height: 200px;
      border: 1px solid #666;
      background: #1b1b1b;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel.span-2 { grid-row: span 2; min-height: 400px; }
    .panel.span-3 { grid-row: span 3; min-height: 600px; }
    .panel.span-4 { grid-row: span 4; min-height: 800px; }
    .panel-header { padding: 10px; background: #2a2a2a; font-weight: 600; }
    .panel-content { flex: 1; }
    .panel-resize-handle {
      position: absolute; bottom: 0; left: 0; right: 0; height: 16px;
      cursor: ns-resize; background: rgba(255,255,255,0.12); touch-action: none;
    }
    .panel-drag-ghost { opacity: 0.9; box-shadow: 0 16px 48px rgba(0,0,0,0.5); }
    .panel-drag-source { opacity: 0.3; }
  `;
  document.head.appendChild(style);

  const grid = document.createElement('div');
  grid.className = 'panels-grid';
  grid.id = 'panelsGrid';
  app.appendChild(grid);

  const harness: PanelDragHarness = {
    ready: false,
    reorderCount: 0,
    lastCommittedSpan: null,
    order: () => Array.from(grid.children).map((c) => (c as HTMLElement).dataset.panel ?? ''),
  };

  for (let i = 0; i < PANEL_COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'panel';
    el.dataset.panel = `p${i}`;

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.textContent = `Panel ${i}`;
    el.appendChild(header);

    const content = document.createElement('div');
    content.className = 'panel-content';
    el.appendChild(content);

    const handle = document.createElement('div');
    handle.className = 'panel-resize-handle';
    el.appendChild(handle);

    attachPanelDrag(el, {
      getGrid: () => grid,
      onReorder: () => {
        harness.reorderCount += 1;
      },
    });

    attachPanelResize(el, handle, {
      minSpan: 1,
      maxSpan: 4,
      rowPx: 200,
      getStartSpan: () => currentSpan(el),
      onPreview: (span) => {
        el.classList.remove('span-1', 'span-2', 'span-3', 'span-4');
        if (span > 1) el.classList.add(`span-${span}`);
      },
      onCommit: (span) => {
        harness.lastCommittedSpan = span;
      },
    });

    grid.appendChild(el);
  }

  harness.ready = true;
  window.__panelDragHarness = harness;
}

build();
