import type { Pixel, PixelMap } from "../types.js";

export interface RegionAwarePaletteOptions {
  removeBackground?: boolean;
  targetColorCount?: number;
  brushSize?: number;
  tinyIslandMaxPixels?: number;
  maxMergeDistance?: number;
  protectDarkLineColors?: boolean;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface ComponentInfo {
  id: number;
  pixels: Pixel[];
  colorCounts: Map<string, number>;
}

interface ColorStats {
  colorHex: string;
  count: number;
  luminance: number;
  boundaryCount: number;
  componentIds: Set<number>;
  neighborColors: Map<string, number>;
}

const NEIGHBORS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

export function optimiseRegionAwarePalette(
  pixelMap: PixelMap,
  options: RegionAwarePaletteOptions = {},
): PixelMap {
  const targetColorCount = Math.max(2, options.targetColorCount ?? 16);
  const tinyIslandMaxPixels = Math.max(
    0,
    options.tinyIslandMaxPixels ?? (targetColorCount <= 16 ? 5 : targetColorCount <= 32 ? 8 : 12),
  );
  const maxMergeDistance =
    options.maxMergeDistance ??
    (targetColorCount <= 16 ? 16 : targetColorCount <= 32 ? 13 : targetColorCount <= 64 ? 10 : 8);

  const distinctBefore = getDistinctColorHexes(pixelMap);
  if (distinctBefore.length <= 1) {
    return reindexPixelMapByColorHex(pixelMap);
  }

  const { components, componentByCoord } = collectComponents(pixelMap);
  const colorStats = buildColorStats(pixelMap, componentByCoord);
  const protectedScores = buildProtectedColorScores(
    pixelMap,
    components,
    colorStats,
    {
      ...options,
      targetColorCount,
      tinyIslandMaxPixels,
    },
  );

  let working = pixelMap;

  // Step 1: 先只合并“非常接近”的颜色，哪怕当前总色数还没超过 target
  const preMergeMapping = buildNearMergeMapping(colorStats, protectedScores, maxMergeDistance);
  if (preMergeMapping.size > 0) {
    working = applyColorMapping(working, preMergeMapping);
  }

  // Step 2: 如果仍然超过目标色数，再做目标色裁剪
  if (getDistinctColorHexes(working).length > targetColorCount) {
    const trimmed = trimPaletteToTarget(working, {
      ...options,
      targetColorCount,
      tinyIslandMaxPixels,
      maxMergeDistance,
    });
    working = trimmed;
  }

  // Step 3: 最终对保留下来的调色板做一轮“拉开差距”
  working = expandPaletteSeparation(working, {
    targetColorCount,
    removeBackground: options.removeBackground === true,
  });

  return reindexPixelMapByColorHex(working);
}

function getDistinctColorHexes(pixelMap: PixelMap): string[] {
  const colors = new Set<string>();

  for (const row of pixelMap) {
    for (const pixel of row) {
      if (pixel.alpha > 0 && pixel.colorIndex >= 0) {
        colors.add(normalizeHex(pixel.colorHex));
      }
    }
  }

  return [...colors];
}

function collectComponents(pixelMap: PixelMap): {
  components: ComponentInfo[];
  componentByCoord: number[][];
} {
  const height = pixelMap.length;
  const width = pixelMap[0]?.length ?? 0;
  const visited = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  const componentByCoord = Array.from({ length: height }, () => Array<number>(width).fill(-1));
  const components: ComponentInfo[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = pixelMap[y]?.[x];
      if (!pixel || pixel.alpha <= 0 || pixel.colorIndex < 0 || visited[y]?.[x]) {
        continue;
      }

      const queue: Array<{ x: number; y: number }> = [{ x, y }];
      visited[y]![x] = true;
      const pixels: Pixel[] = [];
      const colorCounts = new Map<string, number>();
      const id = components.length;

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;

        const currentPixel = pixelMap[current.y]?.[current.x];
        if (!currentPixel || currentPixel.alpha <= 0 || currentPixel.colorIndex < 0) {
          continue;
        }

        pixels.push(currentPixel);
        const hex = normalizeHex(currentPixel.colorHex);
        colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
        componentByCoord[current.y]![current.x] = id;

        for (const neighbor of NEIGHBORS) {
          const nx = current.x + neighbor.dx;
          const ny = current.y + neighbor.dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (visited[ny]?.[nx]) continue;

          const nextPixel = pixelMap[ny]?.[nx];
          if (!nextPixel || nextPixel.alpha <= 0 || nextPixel.colorIndex < 0) continue;

          visited[ny]![nx] = true;
          queue.push({ x: nx, y: ny });
        }
      }

      components.push({
        id,
        pixels,
        colorCounts,
      });
    }
  }

  return { components, componentByCoord };
}

function buildColorStats(pixelMap: PixelMap, componentByCoord: number[][]): Map<string, ColorStats> {
  const stats = new Map<string, ColorStats>();
  const height = pixelMap.length;
  const width = pixelMap[0]?.length ?? 0;

  function ensure(hex: string): ColorStats {
    const normalized = normalizeHex(hex);
    let current = stats.get(normalized);
    if (!current) {
      current = {
        colorHex: normalized,
        count: 0,
        luminance: getLuminance(parseHexColor(normalized)),
        boundaryCount: 0,
        componentIds: new Set<number>(),
        neighborColors: new Map<string, number>(),
      };
      stats.set(normalized, current);
    }
    return current;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = pixelMap[y]?.[x];
      if (!pixel || pixel.alpha <= 0 || pixel.colorIndex < 0) continue;

      const hex = normalizeHex(pixel.colorHex);
      const current = ensure(hex);
      current.count += 1;

      const componentId = componentByCoord[y]?.[x] ?? -1;
      if (componentId >= 0) {
        current.componentIds.add(componentId);
      }

      let touchesBoundary = false;

      for (const neighbor of NEIGHBORS) {
        const nx = x + neighbor.dx;
        const ny = y + neighbor.dy;

        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          touchesBoundary = true;
          continue;
        }

        const nextPixel = pixelMap[ny]?.[nx];
        if (!nextPixel || nextPixel.alpha <= 0 || nextPixel.colorIndex < 0) {
          touchesBoundary = true;
          continue;
        }

        const nextHex = normalizeHex(nextPixel.colorHex);
        if (nextHex !== hex) {
          touchesBoundary = true;
          current.neighborColors.set(nextHex, (current.neighborColors.get(nextHex) ?? 0) + 1);
        }
      }

      if (touchesBoundary) {
        current.boundaryCount += 1;
      }
    }
  }

  return stats;
}

function buildProtectedColorScores(
  pixelMap: PixelMap,
  components: ComponentInfo[],
  colorStats: Map<string, ColorStats>,
  options: RegionAwarePaletteOptions & {
    targetColorCount: number;
    tinyIslandMaxPixels: number;
  },
): Map<string, number> {
  const scores = new Map<string, number>();
  const targetColorCount = options.targetColorCount;
  const maxLineColors = targetColorCount <= 16 ? 2 : targetColorCount <= 32 ? 3 : 4;

  const lineCandidates = [...colorStats.values()]
    .filter((entry) => isLikelyLineColor(entry))
    .sort((a, b) => {
      const aScore = boundaryRatio(a) * 200 + (1 - a.luminance) * 120 + Math.min(a.count, 200);
      const bScore = boundaryRatio(b) * 200 + (1 - b.luminance) * 120 + Math.min(b.count, 200);
      return bScore - aScore;
    })
    .slice(0, maxLineColors);

  for (const entry of lineCandidates) {
    addScore(scores, entry.colorHex, 600 + entry.count * 1.2);
  }

  const sortedComponents = [...components].sort((a, b) => b.pixels.length - a.pixels.length);
  const maxComponentsToInspect =
    targetColorCount <= 16 ? 8 : targetColorCount <= 32 ? 12 : sortedComponents.length;

  for (const component of sortedComponents.slice(0, maxComponentsToInspect)) {
    const entries = [...component.colorCounts.entries()]
      .map(([hex, count]) => ({ hex, count, stats: colorStats.get(hex) }))
      .filter(
        (item): item is { hex: string; count: number; stats: ColorStats } =>
          item.stats !== undefined,
      );

    if (entries.length === 0) continue;

    entries.sort((a, b) => b.count - a.count);
    const dominant = entries[0];
    if (dominant) {
      addScore(scores, dominant.hex, 500 + dominant.count * 1.4);
    }

    const darkest = [...entries].sort((a, b) => a.stats.luminance - b.stats.luminance)[0];
    if (darkest && darkest.hex !== dominant?.hex) {
      addScore(scores, darkest.hex, 320 + darkest.count);
    }

    const brightest = [...entries].sort((a, b) => b.stats.luminance - a.stats.luminance)[0];
    if (
      brightest &&
      brightest.hex !== dominant?.hex &&
      brightest.hex !== darkest?.hex &&
      Math.abs(brightest.stats.luminance - (dominant?.stats.luminance ?? brightest.stats.luminance)) >
        0.12
    ) {
      addScore(scores, brightest.hex, 220 + brightest.count * 0.8);
    }

    if (dominant) {
      const accent = [...entries]
        .filter((item) => item.hex !== dominant.hex)
        .sort((a, b) => {
          const aDistance = colorDistanceHex(a.hex, dominant.hex) + a.count * 0.2;
          const bDistance = colorDistanceHex(b.hex, dominant.hex) + b.count * 0.2;
          return bDistance - aDistance;
        })[0];

      if (
        accent &&
        accent.hex !== darkest?.hex &&
        accent.hex !== brightest?.hex &&
        accent.count >= Math.max(2, Math.floor(component.pixels.length * 0.03))
      ) {
        addScore(scores, accent.hex, 180 + accent.count * 0.7);
      }
    }

    if (component.pixels.length <= options.tinyIslandMaxPixels && entries.length > 0) {
      for (const entry of entries) {
        addScore(scores, entry.hex, 160 + entry.count * 2);
      }
    }
  }

  // 小细节保护：全局像素很少、但不是纯噪点的颜色
  for (const entry of colorStats.values()) {
    if (entry.count <= Math.max(2, options.tinyIslandMaxPixels) && entry.neighborColors.size > 0) {
      addScore(scores, entry.colorHex, 130 + entry.count * 2.5);
    }
  }

  return scores;
}

function buildNearMergeMapping(
  colorStats: Map<string, ColorStats>,
  protectedScores: Map<string, number>,
  maxMergeDistance: number,
): Map<string, string> {
  const hexes = [...colorStats.keys()];
  if (hexes.length <= 1) {
    return new Map<string, string>();
  }

  const uf = new UnionFind(hexes);

  for (let i = 0; i < hexes.length; i += 1) {
    for (let j = i + 1; j < hexes.length; j += 1) {
      const leftHex = hexes[i];
      const rightHex = hexes[j];
      if (!leftHex || !rightHex) continue;

      const left = colorStats.get(leftHex);
      const right = colorStats.get(rightHex);
      if (!left || !right) continue;

      const leftProtected = (protectedScores.get(leftHex) ?? 0) > 0;
      const rightProtected = (protectedScores.get(rightHex) ?? 0) > 0;

      if (leftProtected && rightProtected) {
        continue;
      }

      const distance = colorDistanceHex(leftHex, rightHex);
      if (distance > maxMergeDistance) {
        continue;
      }

      const shareComponent = sharesComponent(left.componentIds, right.componentIds);
      const bothLineLike = isLikelyLineColor(left) && isLikelyLineColor(right);

      if (!shareComponent && !bothLineLike) {
        continue;
      }

      const luminanceGap = Math.abs(left.luminance - right.luminance);
      if ((isLikelyLineColor(left) || isLikelyLineColor(right)) && luminanceGap > 0.07) {
        continue;
      }

      uf.union(leftHex, rightHex);
    }
  }

  const groups = new Map<string, string[]>();

  for (const hex of hexes) {
    const root = uf.find(hex);
    const group = groups.get(root);
    if (group) {
      group.push(hex);
    } else {
      groups.set(root, [hex]);
    }
  }

  const mapping = new Map<string, string>();

  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue;
    }

    const representative = [...group].sort((a, b) => {
      const protectedDiff = (protectedScores.get(b) ?? 0) - (protectedScores.get(a) ?? 0);
      if (protectedDiff !== 0) return protectedDiff;

      const countDiff = (colorStats.get(b)?.count ?? 0) - (colorStats.get(a)?.count ?? 0);
      if (countDiff !== 0) return countDiff;

      return (colorStats.get(a)?.luminance ?? 0) - (colorStats.get(b)?.luminance ?? 0);
    })[0];

    if (!representative) continue;

    for (const hex of group) {
      mapping.set(hex, representative);
    }
  }

  return mapping;
}

function trimPaletteToTarget(
  pixelMap: PixelMap,
  options: RegionAwarePaletteOptions & {
    targetColorCount: number;
    tinyIslandMaxPixels: number;
    maxMergeDistance: number;
  },
): PixelMap {
  const { components, componentByCoord } = collectComponents(pixelMap);
  const colorStats = buildColorStats(pixelMap, componentByCoord);
  const protectedScores = buildProtectedColorScores(pixelMap, components, colorStats, options);
  const colors = [...colorStats.values()];

  if (colors.length <= options.targetColorCount) {
    return reindexPixelMapByColorHex(pixelMap);
  }

  const ranked = [...colors].sort((a, b) => {
    const aScore =
      (protectedScores.get(a.colorHex) ?? 0) +
      a.count * 1.5 +
      a.boundaryCount * 0.4 +
      a.componentIds.size * 40;
    const bScore =
      (protectedScores.get(b.colorHex) ?? 0) +
      b.count * 1.5 +
      b.boundaryCount * 0.4 +
      b.componentIds.size * 40;
    return bScore - aScore;
  });

  const keepHexes = new Set(
    ranked.slice(0, options.targetColorCount).map((entry) => entry.colorHex),
  );

  const mapping = new Map<string, string>();

  for (const entry of colors) {
    if (keepHexes.has(entry.colorHex)) {
      mapping.set(entry.colorHex, entry.colorHex);
      continue;
    }

    let bestHex: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidateHex of keepHexes) {
      const candidate = colorStats.get(candidateHex);
      if (!candidate) continue;

      let score = colorDistanceHex(entry.colorHex, candidateHex);

      if (isLikelyLineColor(entry) && !isLikelyLineColor(candidate)) {
        score += 10;
      }

      if (!sharesComponent(entry.componentIds, candidate.componentIds)) {
        score += 8;
      }

      const luminanceGap = Math.abs(entry.luminance - candidate.luminance);
      score += luminanceGap * 20;

      if (score < bestScore) {
        bestScore = score;
        bestHex = candidateHex;
      }
    }

    mapping.set(entry.colorHex, bestHex ?? entry.colorHex);
  }

  return applyColorMapping(pixelMap, mapping);
}

function expandPaletteSeparation(
  pixelMap: PixelMap,
  options: {
    targetColorCount: number;
    removeBackground: boolean;
  },
): PixelMap {
  const distinct = getDistinctColorHexes(pixelMap);
  if (distinct.length <= 1) {
    return reindexPixelMapByColorHex(pixelMap);
  }

  const minDistance =
    options.targetColorCount <= 16 ? 22 : options.targetColorCount <= 32 ? 18 : 12;
  const minDarkLumaGap =
    options.targetColorCount <= 16 ? 0.06 : options.targetColorCount <= 32 ? 0.05 : 0.03;

  const sorted = [...distinct].sort(
    (a, b) => getLuminance(parseHexColor(a)) - getLuminance(parseHexColor(b)),
  );

  const adjusted = new Map<string, string>();
  const adjustedRgbs: Rgb[] = [];

  for (const hex of sorted) {
    let rgb = parseHexColor(hex);
    let tries = 0;

    while (tries < 10) {
      const tooClose = adjustedRgbs.some((other) => {
        const distance = colorDistance(rgb, other);
        const luminanceGap = Math.abs(getLuminance(rgb) - getLuminance(other));
        const darkPair = getLuminance(rgb) < 0.25 || getLuminance(other) < 0.25;
        if (distance < minDistance) return true;
        if (darkPair && luminanceGap < minDarkLumaGap) return true;
        return false;
      });

      if (!tooClose) {
        break;
      }

      if (getLuminance(rgb) < 0.45) {
        rgb = brightenRgb(rgb, 10);
      } else {
        rgb = darkenRgb(rgb, 8);
      }
      tries += 1;
    }

    let adjustedHex = rgbToHex(rgb);
    let bump = 0;

    while ([...adjusted.values()].includes(adjustedHex) && bump < 8) {
      rgb = getLuminance(rgb) < 0.5 ? brightenRgb(rgb, 2) : darkenRgb(rgb, 2);
      adjustedHex = rgbToHex(rgb);
      bump += 1;
    }

    adjusted.set(hex, adjustedHex);
    adjustedRgbs.push(parseHexColor(adjustedHex));
  }

  return applyColorMapping(pixelMap, adjusted);
}

function applyColorMapping(pixelMap: PixelMap, mapping: Map<string, string>): PixelMap {
  const remapped = pixelMap.map((row) =>
    row.map((pixel) => {
      if (pixel.alpha <= 0 || pixel.colorIndex < 0) {
        return pixel;
      }

      const sourceHex = normalizeHex(pixel.colorHex);
      const targetHex = normalizeHex(mapping.get(sourceHex) ?? sourceHex);

      if (targetHex === sourceHex) {
        return {
          ...pixel,
          colorHex: targetHex,
        };
      }

      return {
        ...pixel,
        colorHex: targetHex,
      };
    }),
  );

  return reindexPixelMapByColorHex(remapped);
}

function reindexPixelMapByColorHex(pixelMap: PixelMap): PixelMap {
  const indexByHex = new Map<string, number>();
  let nextIndex = 0;

  return pixelMap.map((row) =>
    row.map((pixel) => {
      if (pixel.alpha <= 0 || pixel.colorIndex < 0) {
        return pixel;
      }

      const hex = normalizeHex(pixel.colorHex);
      let index = indexByHex.get(hex);
      if (index === undefined) {
        index = nextIndex;
        indexByHex.set(hex, index);
        nextIndex += 1;
      }

      return {
        ...pixel,
        colorHex: hex,
        colorIndex: index,
      };
    }),
  );
}

function sharesComponent(left: Set<number>, right: Set<number>): boolean {
  for (const id of left) {
    if (right.has(id)) {
      return true;
    }
  }
  return false;
}

function isLikelyLineColor(entry: ColorStats): boolean {
  const ratio = boundaryRatio(entry);
  if (entry.luminance <= 0.18) return true;
  if (entry.luminance <= 0.26 && ratio >= 0.55) return true;
  if (entry.luminance <= 0.32 && ratio >= 0.72) return true;
  return false;
}

function boundaryRatio(entry: ColorStats): number {
  if (entry.count <= 0) return 0;
  return entry.boundaryCount / entry.count;
}

function addScore(map: Map<string, number>, hex: string, amount: number): void {
  map.set(hex, (map.get(hex) ?? 0) + amount);
}

function normalizeHex(hex: string): string {
  const value = String(hex ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/u.test(value)) {
    return value;
  }
  if (/^#[0-9a-f]{3}$/u.test(value)) {
    const chars = value.slice(1).split("");
    return `#${chars.map((char) => `${char}${char}`).join("")}`;
  }
  return "#000000";
}

function parseHexColor(hex: string): Rgb {
  const normalized = normalizeHex(hex);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(rgb: Rgb): string {
  const r = clampChannel(rgb.r).toString(16).padStart(2, "0");
  const g = clampChannel(rgb.g).toString(16).padStart(2, "0");
  const b = clampChannel(rgb.b).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function getLuminance(rgb: Rgb): number {
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

function getSaturation(rgb: Rgb): number {
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  if (max === 0) return 0;
  return (max - min) / max;
}

function colorDistanceHex(leftHex: string, rightHex: string): number {
  return colorDistance(parseHexColor(leftHex), parseHexColor(rightHex));
}

function colorDistance(left: Rgb, right: Rgb): number {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  const rgbDistance = Math.sqrt(dr * dr + dg * dg + db * db);
  const luminanceDistance = Math.abs(getLuminance(left) - getLuminance(right)) * 90;
  const saturationDistance = Math.abs(getSaturation(left) - getSaturation(right)) * 50;

  return rgbDistance * 0.7 + luminanceDistance + saturationDistance;
}

function brightenRgb(rgb: Rgb, amount: number): Rgb {
  return {
    r: clampChannel(rgb.r + amount),
    g: clampChannel(rgb.g + amount),
    b: clampChannel(rgb.b + amount),
  };
}

function darkenRgb(rgb: Rgb, amount: number): Rgb {
  return {
    r: clampChannel(rgb.r - amount),
    g: clampChannel(rgb.g - amount),
    b: clampChannel(rgb.b - amount),
  };
}

class UnionFind {
  private parent: Map<string, string>;

  constructor(items: string[]) {
    this.parent = new Map<string, string>();
    for (const item of items) {
      this.parent.set(item, item);
    }
  }

  find(item: string): string {
    const parent = this.parent.get(item);
    if (!parent || parent === item) {
      return item;
    }

    const root = this.find(parent);
    this.parent.set(item, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    this.parent.set(rightRoot, leftRoot);
  }
}
