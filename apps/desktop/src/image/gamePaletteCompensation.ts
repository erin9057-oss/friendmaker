export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function hexToRgb(hex: string): RgbColor | null {
  const normalized = hex.trim().replace(/^#/u, "");

  if (!/^[0-9a-fA-F]{6}$/u.test(normalized)) {
    return null;
  }

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

export function rgbToHex(color: RgbColor): string {
  return `#${clamp255(color.r).toString(16).padStart(2, "0")}${clamp255(color.g)
    .toString(16)
    .padStart(2, "0")}${clamp255(color.b).toString(16).padStart(2, "0")}`;
}

function rgbToHsv({ r, g, b }: RgbColor): { h: number; s: number; v: number } {
  const rn = clamp01(r / 255);
  const gn = clamp01(g / 255);
  const bn = clamp01(b / 255);

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;

  if (delta > 0) {
    if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }
  }

  if (h < 0) {
    h += 360;
  }

  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hsvToRgb({ h, s, v }: { h: number; s: number; v: number }): RgbColor {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;

  let rn = 0;
  let gn = 0;
  let bn = 0;

  if (hue < 60) {
    rn = c;
    gn = x;
  } else if (hue < 120) {
    rn = x;
    gn = c;
  } else if (hue < 180) {
    gn = c;
    bn = x;
  } else if (hue < 240) {
    gn = x;
    bn = c;
  } else if (hue < 300) {
    rn = x;
    bn = c;
  } else {
    rn = c;
    bn = x;
  }

  return {
    r: clamp255((rn + m) * 255),
    g: clamp255((gn + m) * 255),
    b: clamp255((bn + m) * 255),
  };
}

function isWarmHue(h: number): boolean {
  return (h >= 12 && h <= 78) || h >= 335;
}

function isCoolDarkHue(h: number): boolean {
  return h >= 200 && h <= 285;
}

export function compensateGamePaletteHex(hex: string): string {
  const rgb = hexToRgb(hex);

  if (!rgb) {
    return hex;
  }

  const hsv = rgbToHsv(rgb);
  let { h, s, v } = hsv;

  // Preserve true neutral tones. These are important for outlines, white,
  // silver, black clothing and clean grey UI-like details.
  if (v <= 0.08 || v >= 0.90 || s <= 0.035) {
    return rgbToHex(rgb);
  }

  // The game custom palette visually compresses low saturation too much.
  // Warm low-saturation colours become grey/muddy, so push khaki, bronze,
  // brown and dark red into a more drawable range before writing PC commands.
  if (isWarmHue(h) && s < 0.52) {
    s = Math.min(0.60, 0.30 + s * 0.82);

    if (v < 0.62) {
      v = Math.min(0.70, v + 0.06);
    }
  }

  // Dark blue / navy can collapse into black. Lift gently, without making it neon.
  if (isCoolDarkHue(h) && s < 0.42 && v < 0.55) {
    s = Math.min(0.48, 0.16 + s * 0.95);
    v = Math.min(0.58, v + 0.04);
  }

  // Very dark coloured pixels should retain some chroma instead of becoming
  // indistinguishable from pure black.
  if (s > 0.08 && v > 0.08 && v < 0.18) {
    v = 0.18;
  }

  return rgbToHex(hsvToRgb({ h, s, v }));
}

export function compensateGamePaletteHexes(hexes: string[]): string[] {
  return hexes.map(compensateGamePaletteHex);
}
