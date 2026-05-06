export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface HsvColor {
  h: number;
  s: number;
  v: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function hexToRgb(hex: string): RgbColor | null {
  const normalized = String(hex ?? "").trim().replace(/^#/u, "");

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

function rgbToHsv({ r, g, b }: RgbColor): HsvColor {
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

function hsvToRgb({ h, s, v }: HsvColor): RgbColor {
  const hue = ((h % 360) + 360) % 360;
  const c = clamp01(v) * clamp01(s);
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = clamp01(v) - c;

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

function relativeLuminance({ r, g, b }: RgbColor): number {
  const transform = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  const rl = transform(r);
  const gl = transform(g);
  const bl = transform(b);

  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function isWarmHue(h: number): boolean {
  return (h >= 12 && h <= 78) || h >= 335;
}

function isCoolDarkHue(h: number): boolean {
  return h >= 200 && h <= 285;
}

function compensateSingleGamePaletteHex(hex: string): string {
  const rgb = hexToRgb(hex);

  if (!rgb) {
    return hex;
  }

  let { h, s, v } = rgbToHsv(rgb);

  // 保持极端黑白与真正中性灰稳定
  if (v <= 0.05 || v >= 0.92 || s <= 0.03) {
    return rgbToHex(rgb);
  }

  // 暖色低饱和补偿：卡其、棕、金棕避免在游戏里发灰
  if (isWarmHue(h) && s < 0.52) {
    s = Math.min(0.60, 0.30 + s * 0.82);

    if (v < 0.62) {
      v = Math.min(0.70, v + 0.06);
    }
  }

  // 深蓝/深紫黑轻微补偿，避免全塌进黑色
  if (isCoolDarkHue(h) && s < 0.42 && v < 0.55) {
    s = Math.min(0.48, 0.16 + s * 0.95);
    v = Math.min(0.58, v + 0.04);
  }

  // 很暗但不是纯黑的颜色，稍微抬一点，避免完全丢失
  if (s > 0.06 && v > 0.05 && v < 0.16) {
    v = 0.16;
  }

  return rgbToHex(hsvToRgb({ h, s, v }));
}

interface PaletteEntry {
  originalIndex: number;
  hex: string;
  rgb: RgbColor;
  hsv: HsvColor;
  luminance: number;
}

function spreadDarkPaletteContrast(hexes: string[]): string[] {
  const entries: PaletteEntry[] = hexes
    .map((hex, originalIndex) => {
      const rgb = hexToRgb(hex);
      if (!rgb) {
        return null;
      }

      return {
        originalIndex,
        hex,
        rgb,
        hsv: rgbToHsv(rgb),
        luminance: relativeLuminance(rgb),
      };
    })
    .filter((entry): entry is PaletteEntry => entry !== null);

  if (entries.length <= 1) {
    return hexes;
  }

  // 只处理真正的深色段；中高亮颜色保持原样
  const darkEntries = entries
    .filter((entry) => entry.hsv.v <= 0.28 || entry.luminance <= 0.045)
    .sort((a, b) => a.hsv.v - b.hsv.v);

  if (darkEntries.length <= 1) {
    return hexes;
  }

  // 只保留最深的一个做“纯黑/近黑”
  // 其余深色按阶梯抬亮，保证至少能在游戏里拉开层次
  const minValueGap = 0.055;
  const floorValues = [0.05, 0.12, 0.18, 0.24, 0.30, 0.36];

  let previousAdjustedV = 0;

  darkEntries.forEach((entry, index) => {
    let { h, s, v } = entry.hsv;

    if (index === 0) {
      // 最深色保留为线稿黑，但不要比原来更亮
      v = Math.min(v, 0.06);
      previousAdjustedV = v;
    } else {
      const floor = floorValues[Math.min(index, floorValues.length - 1)] ?? 0.36;
      const target = Math.max(v, floor, previousAdjustedV + minValueGap);

      v = Math.min(target, 0.42);

      // 如果本来有轻微色相，抬亮后也给一点最低饱和度，避免又变成同一块黑
      if (s > 0.04 && s < 0.14) {
        s = 0.14;
      }

      previousAdjustedV = v;
    }

    const adjustedHex = rgbToHex(hsvToRgb({ h, s, v }));
    entry.hex = adjustedHex;
    entry.rgb = hexToRgb(adjustedHex) ?? entry.rgb;
    entry.hsv = rgbToHsv(entry.rgb);
    entry.luminance = relativeLuminance(entry.rgb);
  });

  const byIndex = new Map(entries.map((entry) => [entry.originalIndex, entry.hex]));

  return hexes.map((hex, index) => byIndex.get(index) ?? hex);
}

export function compensateGamePaletteHex(hex: string): string {
  return compensateSingleGamePaletteHex(hex);
}

export function compensateGamePaletteHexes(hexes: string[]): string[] {
  const firstPass = hexes.map(compensateSingleGamePaletteHex);
  return spreadDarkPaletteContrast(firstPass);
}
