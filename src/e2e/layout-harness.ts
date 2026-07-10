// Realistic harness for the layout engine (services/grid-config.ts +
// services/panel-drag.ts + components/Panel.ts). It mounts REAL Panel instances
// and a map panel wired exactly like App does, under the real main.css, so
// Playwright drives the true grid ⇄ free mechanism (snap, corner resize,
// free-form drag/resize, overlay, cell-size re-snap). Exposes
// window.__layoutHarness for assertions.

import '../styles/main.css';
import { Panel } from '../components/Panel';
import {
  attachPanelDrag,
  attachPanelResize,
  attachPanelColResize,
} from '../services/panel-drag';
import {
  getLayoutMode,
  setLayoutMode,
  toggleLayoutMode,
  getCellSize,
  setCellSize,
  type LayoutMode,
} from '../services/grid-config';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface LayoutHarness {
  ready: boolean;
  mode: () => LayoutMode;
  setMode: (m: LayoutMode) => void;
  toggle: () => LayoutMode;
  cell: () => number;
  setCell: (px: number) => void;
  rect: (id: string) => Rect | null;
  colStep: () => { step: number; cols: number; padL: number };
  order: () => string[];
  overlayVisible: () => boolean;
  gridColumnOf: (id: string) => string;
}

declare global {
  interface Window {
    __layoutHarness?: LayoutHarness;
  }
}

const PANELS: Array<{ id: string; title: string }> = [
  { id: 'alpha', title: 'Alpha' },
  { id: 'bravo', title: 'Bravo' },
  { id: 'charlie', title: 'Charlie' },
  { id: 'delta', title: 'Delta' },
  { id: 'echo', title: 'Echo' },
  { id: 'foxtrot', title: 'Foxtrot' },
];

function currentSpan(el: HTMLElement): number {
  if (el.classList.contains('span-4')) return 4;
  if (el.classList.contains('span-3')) return 3;
  if (el.classList.contains('span-2')) return 2;
  if (el.classList.contains('span-0')) return 0;
  return 1;
}

function build(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const grid = document.createElement('div');
  grid.className = 'panels-grid';
  grid.id = 'panelsGrid';
  app.appendChild(grid);

  const makeDraggable = (el: HTMLElement, key: string): void => {
    el.dataset.panel = key;
    attachPanelDrag(el, {
      getGrid: () => grid,
      onReorder: () => {
        /* order read back from the DOM in tests */
      },
    });
  };

  // ── Map panel, wired like App.setupMapPanel (row + col resize, drag) ──
  const mapSection = document.createElement('div');
  mapSection.className = 'panel map-section map-panel';
  mapSection.dataset.panel = 'map';
  mapSection.innerHTML = `
    <div class="panel-header map-drag-grip" aria-label="map — drag to move"></div>
    <div class="map-container" id="mapContainer"></div>
    <div class="map-resize-handle" id="mapResizeHandle"></div>
    <div class="panel-col-resize-handle" id="mapColResizeHandle"></div>`;
  mapSection.classList.add('span-2');
  mapSection.style.gridColumn = '1 / -1';
  grid.appendChild(mapSection);
  makeDraggable(mapSection, 'map');
  attachPanelResize(mapSection, mapSection.querySelector('#mapResizeHandle')!, {
    minSpan: 1,
    maxSpan: 4,
    rowPx: 200,
    getStartSpan: () => currentSpan(mapSection),
    onPreview: (span) => {
      mapSection.classList.remove('span-1', 'span-2', 'span-3', 'span-4');
      mapSection.classList.add(`span-${span}`);
    },
    onCommit: () => {
      /* span persisted via Panel's store elsewhere; not needed here */
    },
  });
  attachPanelColResize(mapSection, mapSection.querySelector('#mapColResizeHandle')!, {
    getGrid: () => grid,
    getStartCols: () => {
      const m = mapSection.style.gridColumn.match(/span\s+(\d+)/);
      return m && m[1] ? parseInt(m[1], 10) : 99;
    },
    onPreview: (cols, total) => {
      mapSection.style.gridColumn = cols >= total ? '1 / -1' : `span ${cols}`;
    },
    onCommit: () => {
      /* map cols persisted by App in prod; the harness only needs the geometry */
    },
  });

  // ── Real Panel instances (own their bottom / right / corner grips) ──
  for (const spec of PANELS) {
    const panel = new Panel({ id: spec.id, title: spec.title, trackActivity: false });
    const el = panel.getElement();
    panel.setContent(`<div style="padding:10px;color:var(--text-dim)">${spec.title}</div>`);
    makeDraggable(el, spec.id);
    grid.appendChild(el);
  }

  const rectOf = (id: string): Rect | null => {
    const el = grid.querySelector<HTMLElement>(`[data-panel="${id}"]`);
    if (!el) return null;
    const g = grid.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { left: r.left - g.left, top: r.top - g.top, width: r.width, height: r.height };
  };

  const colStep = (): { step: number; cols: number; padL: number } => {
    const cs = getComputedStyle(grid);
    const tracks = cs.gridTemplateColumns.split(' ').filter(Boolean);
    const n = Math.max(1, tracks.length);
    const gap = parseFloat(cs.columnGap || '0') || 0;
    const rect = grid.getBoundingClientRect();
    const padL = parseFloat(cs.paddingLeft || '0') || 0;
    const padR = parseFloat(cs.paddingRight || '0') || 0;
    const inner = rect.width - padL - padR;
    const colW = (inner - gap * (n - 1)) / n;
    return { step: colW + gap, cols: n, padL };
  };

  window.__layoutHarness = {
    ready: true,
    mode: () => getLayoutMode(),
    setMode: (m) => setLayoutMode(m),
    toggle: () => toggleLayoutMode(),
    cell: () => getCellSize(),
    setCell: (px) => setCellSize(px),
    rect: rectOf,
    colStep,
    order: () => Array.from(grid.children).map((c) => (c as HTMLElement).dataset.panel ?? ''),
    overlayVisible: () => document.body.classList.contains('layout-snapping'),
    gridColumnOf: (id) =>
      grid.querySelector<HTMLElement>(`[data-panel="${id}"]`)?.style.gridColumn ?? '',
  };
}

build();
