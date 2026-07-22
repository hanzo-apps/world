// Global flow corridors — the real backbone of world comms + trade, drawn as
// animated great-circle arcs on the globe ("where everything is going"). These
// are the actual major submarine-cable / internet-backbone routes and the
// principal maritime trade lanes between global hubs — not synthetic data. The
// weight is a representative relative magnitude (heaviest corridors brightest /
// widest); direction is source → target for the travelling pulse.

export interface GlobalFlow {
  from: [number, number]; // [lon, lat]
  to: [number, number];
  fromName: string;
  toName: string;
  kind: 'comms' | 'trade';
  weight: number; // 0..100 representative magnitude
}

// Major global hubs (lon, lat).
const H = {
  nyc: [-74.0, 40.71] as [number, number],
  london: [-0.13, 51.51] as [number, number],
  frankfurt: [8.68, 50.11] as [number, number],
  marseille: [5.37, 43.30] as [number, number],
  singapore: [103.82, 1.35] as [number, number],
  dubai: [55.27, 25.20] as [number, number],
  mumbai: [72.88, 19.08] as [number, number],
  tokyo: [139.69, 35.68] as [number, number],
  hongkong: [114.17, 22.32] as [number, number],
  la: [-118.24, 34.05] as [number, number],
  sydney: [151.21, -33.87] as [number, number],
  saopaulo: [-46.63, -23.55] as [number, number],
  joburg: [28.05, -26.20] as [number, number],
  shanghai: [121.47, 31.23] as [number, number],
  rotterdam: [4.48, 51.92] as [number, number],
  rastanura: [50.16, 26.64] as [number, number],
  santos: [-46.33, -23.96] as [number, number],
};

// Internet / comms backbone corridors (submarine cable systems).
const COMMS: [keyof typeof H, keyof typeof H, number][] = [
  ['nyc', 'london', 100],       // transatlantic — the busiest route on earth
  ['london', 'frankfurt', 85],
  ['frankfurt', 'marseille', 70],
  ['marseille', 'singapore', 78], // Europe→Asia via Suez (SEA-ME-WE etc.)
  ['london', 'dubai', 62],
  ['dubai', 'mumbai', 60],
  ['mumbai', 'singapore', 66],
  ['singapore', 'hongkong', 74],
  ['singapore', 'tokyo', 72],
  ['hongkong', 'tokyo', 68],
  ['tokyo', 'la', 90],          // transpacific
  ['singapore', 'la', 80],
  ['la', 'nyc', 88],
  ['singapore', 'sydney', 55],
  ['la', 'sydney', 50],
  ['nyc', 'saopaulo', 58],
  ['london', 'saopaulo', 46],
  ['london', 'joburg', 44],
];

// Principal maritime trade lanes (containers + energy).
const TRADE: [keyof typeof H, keyof typeof H, number][] = [
  ['shanghai', 'la', 100],         // transpacific container trade
  ['shanghai', 'rotterdam', 92],   // Asia→Europe via Suez
  ['singapore', 'rotterdam', 80],
  ['rastanura', 'singapore', 76],  // Gulf oil → Asia
  ['rastanura', 'rotterdam', 64],  // Gulf oil → Europe
  ['shanghai', 'singapore', 82],
  ['santos', 'shanghai', 58],      // Brazil commodities → China
  ['rotterdam', 'nyc', 60],
  ['shanghai', 'sydney', 40],
];

export const GLOBAL_FLOWS: GlobalFlow[] = [
  ...COMMS.map(([a, b, w]): GlobalFlow => ({ from: H[a], to: H[b], fromName: a, toName: b, kind: 'comms', weight: w })),
  ...TRADE.map(([a, b, w]): GlobalFlow => ({ from: H[a], to: H[b], fromName: a, toName: b, kind: 'trade', weight: w })),
];
