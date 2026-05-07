import type { PixelMap } from "../types.js";
import {
  compensateGamePaletteHexes,
  hexToRgb,
  rgbToHex,
  type RgbColor,
} from "./gamePaletteCompensation.js";

interface HsvColor {
  h: number;
  s: number;
  v: number;
}

interface PaletteStat {
  colorIndex: number;
  colorHex: string;
  rgb: RgbColor;
  hsv: HsvColor;
  area: number;
}

class DisjointSet {
  private readonly parent = new Map<number, number>();

  add(value: number): void {
    if (!this.parent.has(value)) {
      this.parent.set(value, value);
    }
  }

  find(value: number): number {
    const parent = this.parent.get(value);

    if (parent === undefined || parent === value) {
      this.parent.set(value, value);
      return value;
    }

    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);

    if (leftRoot === rightRoot) {
      return;
    }

    this.parent.set(rightRoot, leftRoot);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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

function circularHueDistance(left: number, right: number): number {
  const diff = Math.abs(left - right) % 360;
  return Math.min(diff, 360 - diff);
}

function adjacencyKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function buildPaletteStats(pixelMap: PixelMap): {
  stats: PaletteStat[];
  totalPixels: number;
} {
  const byColor = new Map<
    number,
    {
      colorHex: string;
      area: number;
    }
  >();

  let totalPixels = 0;

  for (const row of pixelMap) {
    for (const pixel of row) {
      if (pixel.alpha <= 0 || pixel.colorIndex < 0) {
        continue;
      }

      totalPixels += 1;

      const current = byColor.get(pixel.colorIndex);
      if (current) {
        current.area += 1;
      } else {
        byColor.set(pixel.colorIndex, {
          colorHex: pixel.colorHex,
          area: 1,
        });
      }
    }
  }

  const stats: PaletteStat[] = [];

  for (const [colorIndex, item] of byColor.entries()) {
    const rgb = hexToRgb(item.colorHex);

    if (!rgb) {
      continue;
    }

    stats.push({
      colorIndex,
      colorHex: item.colorHex,
      rgb,
      hsv: rgbToHsv(rgb),
      area: item.area,
    });
  }

  stats.sort((left, right) => left.colorIndex - right.colorIndex);

  return { stats, totalPixels };
}

function buildColorAdjacency(pixelMap: PixelMap): Map<string, number> {
  const adjacency = new Map<string, number>();

  for (let y = 0; y < pixelMap.length; y += 1) {
    const row = pixelMap[y];

    if (!row) {
      continue;
    }

    for (let x = 0; x < row.length; x += 1) {
      const pixel = row[x];

      if (!pixel || pixel.alpha <= 0 || pixel.colorIndex < 0) {
        continue;
      }

      const right = row[x + 1];
      if (right && right.alpha > 0 && right.colorIndex >= 0 && right.colorIndex !== pixel.colorIndex) {
        const key = adjacencyKey(pixel.colorIndex, right.colorIndex);
        adjacency.set(key, (adjacency.get(key) ?? 0) + 1);
      }

      const below = pixelMap[y + 1]?.[x];
      if (below && below.alpha > 0 && below.colorIndex >= 0 && below.colorIndex !== pixel.colorIndex) {
        const key = adjacencyKey(pixel.colorIndex, below.colorIndex);
        adjacency.set(key, (adjacency.get(key) ?? 0) + 1);
      }
    }
  }

  return adjacency;
}

function shouldMergeColors(
  left: PaletteStat,
  right: PaletteStat,
  totalPixels: number,
  sharedBoundary: number,
): boolean {
  const hueDistance = circularHueDistance(left.hsv.h, right.hsv.h);
  const saturationDistance = Math.abs(left.hsv.s - right.hsv.s);
  const valueDistance = Math.abs(left.hsv.v - right.hsv.v);
  const minAreaRatio = Math.min(left.area, right.area) / Math.max(1, totalPixels);
  const sharedBoundaryRatio = sharedBoundary / Math.max(1, Math.min(left.area, right.area));
  const adjacent = sharedBoundary > 0;

  const leftNeutral = left.hsv.s <= 0.075;
  const rightNeutral = right.hsv.s <= 0.075;
  const bothNeutral = leftNeutral && rightNeutral;

  const leftTrueBlack = left.hsv.v <= 0.075;
  const rightTrueBlack = right.hsv.v <= 0.075;
  const oneTrueBlack = leftTrueBlack !== rightTrueBlack;

  // Keep real line-art black separate from dark fills/shadows.
  if (oneTrueBlack && Math.max(left.hsv.v, right.hsv.v) > 0.14) {
    return false;
  }

  // Neutral greys: hue is meaningless; merge by value only.
  if (bothNeutral) {
    if (valueDistance <= 0.055) {
      return true;
    }

    return adjacent && valueDistance <= 0.085 && (minAreaRatio < 0.025 || sharedBoundaryRatio > 0.08);
  }

  // Same hue family and very close in the game's useful S/V plane.
  if (hueDistance <= 12 && saturationDistance <= 0.08 && valueDistance <= 0.075) {
    return true;
  }

  // Adjacent pieces of the same visual subject can merge with looser thresholds.
  if (
    adjacent &&
    hueDistance <= 22 &&
    saturationDistance <= 0.14 &&
    valueDistance <= 0.12 &&
    (sharedBoundaryRatio > 0.035 || minAreaRatio < 0.04)
  ) {
    return true;
  }

  // Tiny colour fragments are usually quantisation noise. Absorb them when close.
  if (
    minAreaRatio < 0.008 &&
    hueDistance <= 30 &&
    saturationDistance <= 0.20 &&
    valueDistance <= 0.16
  ) {
    return true;
  }

  // Very dark non-black colours are often indistinguishable in-game.
  // Merge only near-identical ones; separate dark levels are handled later by spreading.
  if (
    left.hsv.v < 0.23 &&
    right.hsv.v < 0.23 &&
    hueDistance <= 28 &&
    saturationDistance <= 0.10 &&
    valueDistance <= 0.045
  ) {
    return true;
  }

  return false;
}

function weightedRepresentativeHex(members: PaletteStat[]): string {
  const totalArea = members.reduce((sum, item) => sum + item.area, 0);

  if (totalArea <= 0) {
    return members[0]?.colorHex ?? "#000000";
  }

  const weighted = members.reduce(
    (sum, item) => ({
      r: sum.r + item.rgb.r * item.area,
      g: sum.g + item.rgb.g * item.area,
      b: sum.b + item.rgb.b * item.area,
    }),
    { r: 0, g: 0, b: 0 },
  );

  return rgbToHex({
    r: weighted.r / totalArea,
    g: weighted.g / totalArea,
    b: weighted.b / totalArea,
  });
}

function buildPaletteRemap(pixelMap: PixelMap): Map<number, { newIndex: number; colorHex: string }> {
  const { stats, totalPixels } = buildPaletteStats(pixelMap);

  if (stats.length <= 1) {
    return new Map(
      stats.map((stat, index) => [
        stat.colorIndex,
        {
          newIndex: index,
          colorHex: stat.colorHex,
        },
      ]),
    );
  }

  const adjacency = buildColorAdjacency(pixelMap);
  const disjointSet = new DisjointSet();

  for (const stat of stats) {
    disjointSet.add(stat.colorIndex);
  }

  for (let i = 0; i < stats.length; i += 1) {
    const left = stats[i];

    if (!left) {
      continue;
    }

    for (let j = i + 1; j < stats.length; j += 1) {
      const right = stats[j];

      if (!right) {
        continue;
      }

      const sharedBoundary = adjacency.get(adjacencyKey(left.colorIndex, right.colorIndex)) ?? 0;

      if (shouldMergeColors(left, right, totalPixels, sharedBoundary)) {
        disjointSet.union(left.colorIndex, right.colorIndex);
      }
    }
  }

  const grouped = new Map<number, PaletteStat[]>();

  for (const stat of stats) {
    const root = disjointSet.find(stat.colorIndex);
    const group = grouped.get(root);

    if (group) {
      group.push(stat);
    } else {
      grouped.set(root, [stat]);
    }
  }

  const groups = Array.from(grouped.values()).sort((left, right) => {
    const leftMinIndex = Math.min(...left.map((item) => item.colorIndex));
    const rightMinIndex = Math.min(...right.map((item) => item.colorIndex));
    return leftMinIndex - rightMinIndex;
  });

  const rawRepresentativeHexes = groups.map(weightedRepresentativeHex);
  const compensatedHexes = compensateGamePaletteHexes(rawRepresentativeHexes);
  const remap = new Map<number, { newIndex: number; colorHex: string }>();

  groups.forEach((group, newIndex) => {
    const colorHex = compensatedHexes[newIndex] ?? rawRepresentativeHexes[newIndex] ?? "#000000";

    for (const stat of group) {
      remap.set(stat.colorIndex, {
        newIndex,
        colorHex,
      });
    }
  });

  return remap;
}

export function optimiseRegionAwarePalette(pixelMap: PixelMap): PixelMap {
  const remap = buildPaletteRemap(pixelMap);

  if (remap.size === 0) {
    return pixelMap;
  }

  return pixelMap.map((row) =>
    row.map((pixel) => {
      if (pixel.alpha <= 0 || pixel.colorIndex < 0) {
        return pixel;
      }

      const mapped = remap.get(pixel.colorIndex);

      if (!mapped) {
        return pixel;
      }

      return {
        ...pixel,
        colorIndex: mapped.newIndex,
        colorHex: mapped.colorHex,
      };
    }),
  );
}
