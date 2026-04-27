export const OFFICIAL_COLOR_GRID = [
  ["#f2eff5", "#e4dff1", "#d8d9f3", "#d6e1f3", "#d5e9e4", "#d8e4de", "#dfe8df", "#f2efcf", "#f2dfe2", "#e4d5e2", "#d9cec4", "#e6252a"],
  ["#d4d3df", "#c6c1de", "#bfc7e7", "#b7d3f0", "#b3e0d2", "#aec3ba", "#badbb1", "#efeab1", "#edc1bb", "#d9afb9", "#c9b39a", "#ecea21"],
  ["#bebdc6", "#a79ad8", "#90a2d9", "#87c9f1", "#85d8b7", "#83b48d", "#a7d271", "#f0e962", "#f0a080", "#d37a78", "#b38b58", "#3bcf22"],
  ["#9da0a8", "#6919e6", "#1940da", "#25abf0", "#20cb79", "#29a814", "#7ad410", "#f4e316", "#f37a22", "#dc2f23", "#996a24", "#25d0de"],
  ["#7a7d88", "#5515cd", "#1838b6", "#1b94d6", "#20a864", "#2a9922", "#82c118", "#d8d119", "#d37824", "#c03929", "#7e5124", "#1e1be6"],
  ["#4f5159", "#3d119f", "#123086", "#1b7cb5", "#208b57", "#1e6f14", "#668e18", "#989f18", "#a75f23", "#8f281f", "#4e2f16", "#6b18e5"],
  ["#0f1012", "#0e0c3d", "#0b1d53", "#0e446a", "#0f5335", "#0b4315", "#445c1c", "#666d1d", "#4e2d1a", "#441610", "#1a110d", "#d81bb7"],
] as const;

export const OFFICIAL_PALETTE_ROWS = OFFICIAL_COLOR_GRID.length;
export const OFFICIAL_PALETTE_COLS = OFFICIAL_COLOR_GRID[0]?.length ?? 0;
export const OFFICIAL_PALETTE = OFFICIAL_COLOR_GRID.flat();

export interface OfficialPaletteCell {
  index: number;
  row: number;
  col: number;
  colorHex: string;
}

export function clampOfficialPaletteIndex(index: number): number {
  if (index < 0) {
    return 0;
  }

  if (index >= OFFICIAL_PALETTE.length) {
    return OFFICIAL_PALETTE.length - 1;
  }

  return index;
}

export function officialPaletteCellFromIndex(index: number): OfficialPaletteCell {
  const safeIndex = clampOfficialPaletteIndex(index);
  const row = Math.floor(safeIndex / OFFICIAL_PALETTE_COLS);
  const col = safeIndex % OFFICIAL_PALETTE_COLS;

  return {
    index: safeIndex,
    row,
    col,
    colorHex: OFFICIAL_PALETTE[safeIndex] ?? OFFICIAL_PALETTE[0] ?? "#000000",
  };
}
