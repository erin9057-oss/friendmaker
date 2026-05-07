import type { Pixel, PixelMap } from "../types.js";

const NEIGHBORS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

function isDrawable(pixel: Pixel | undefined): pixel is Pixel {
  return Boolean(pixel && pixel.alpha > 0 && pixel.colorIndex >= 0);
}

function erasePixel(pixel: Pixel): Pixel {
  return {
    ...pixel,
    alpha: 0,
    colorIndex: -1,
  };
}

function isBoundaryPixel(pixelMap: PixelMap, x: number, y: number): boolean {
  const pixel = pixelMap[y]?.[x];

  if (!isDrawable(pixel)) {
    return false;
  }

  for (const neighbor of NEIGHBORS) {
    const nx = x + neighbor.dx;
    const ny = y + neighbor.dy;
    const next = pixelMap[ny]?.[nx];

    if (!isDrawable(next)) {
      return true;
    }

    if (next.colorIndex !== pixel.colorIndex) {
      return true;
    }
  }

  return false;
}

interface Point {
  x: number;
  y: number;
}

interface Component {
  colorIndex: number;
  points: Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function makeVisited(height: number, width: number): boolean[][] {
  return Array.from({ length: height }, () => Array(width).fill(false));
}

function collectComponent(
  pixelMap: PixelMap,
  visited: boolean[][],
  startX: number,
  startY: number,
): Component | null {
  const start = pixelMap[startY]?.[startX];

  if (!isDrawable(start)) {
    return null;
  }

  const colorIndex = start.colorIndex;
  const queue: Point[] = [{ x: startX, y: startY }];
  const points: Point[] = [];

  let minX = startX;
  let minY = startY;
  let maxX = startX;
  let maxY = startY;

  visited[startY]![startX] = true;

  while (queue.length > 0) {
    const current = queue.shift()!;
    points.push(current);

    if (current.x < minX) minX = current.x;
    if (current.y < minY) minY = current.y;
    if (current.x > maxX) maxX = current.x;
    if (current.y > maxY) maxY = current.y;

    for (const neighbor of NEIGHBORS) {
      const nx = current.x + neighbor.dx;
      const ny = current.y + neighbor.dy;

      if (ny < 0 || ny >= pixelMap.length) continue;
      if (nx < 0 || nx >= (pixelMap[ny]?.length ?? 0)) continue;
      if (visited[ny]![nx]) continue;

      const next = pixelMap[ny]?.[nx];

      if (!isDrawable(next)) continue;
      if (next.colorIndex !== colorIndex) continue;

      visited[ny]![nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }

  return {
    colorIndex,
    points,
    minX,
    minY,
    maxX,
    maxY,
  };
}

export interface OutlinePixelMapOptions {
  largeComponentMinSize?: number;
  minOutlineSpan?: number;
  minDensity?: number;
  maxBoundaryRatio?: number;
  noiseComponentMaxSize?: number;
  minKeepSpan?: number;
  maxNoiseBoundaryRatio?: number;
}

function shouldOutlineComponent(
  component: Component,
  boundaryCount: number,
  options: Required<OutlinePixelMapOptions>,
): boolean {
  const area = component.points.length;
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const span = Math.max(width, height);
  const bboxArea = width * height;
  const density = bboxArea > 0 ? area / bboxArea : 0;
  const boundaryRatio = area > 0 ? boundaryCount / area : 1;

  if (area < options.largeComponentMinSize) {
    return false;
  }

  if (span < options.minOutlineSpan) {
    return false;
  }

  // Low density often means textured/noisy components: not worth outlining.
  if (density < options.minDensity) {
    return false;
  }

  // If most pixels are already boundary, converting to outline won't help.
  if (boundaryRatio > options.maxBoundaryRatio) {
    return false;
  }

  return true;
}

interface OutlineColourStats {
  totalPixels: number;
  counts: Map<string, number>;
}

interface OutlineAdjacentInfo {
  dominantShare: number;
  nearestDistance: number;
  nearestLumaGap: number;
  touchesDarkLineLike: boolean;
}

function buildOutlineColourStats(pixelMap: PixelMap): OutlineColourStats {
  const counts = new Map<string, number>();
  let totalPixels = 0;

  for (const row of pixelMap) {
    for (const pixel of row) {
      if (!isDrawable(pixel)) {
        continue;
      }

      const hex = normalizeOutlineHex(pixel.colorHex);
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
      totalPixels += 1;
    }
  }

  return { totalPixels, counts };
}

function shouldKeepNonOutlinedComponent(
  pixelMap: PixelMap,
  component: Component,
  boundaryCount: number,
  options: Required<OutlinePixelMapOptions>,
  colourStats: OutlineColourStats,
): boolean {
  const info = getOutlineComponentRoleInfo(pixelMap, component, boundaryCount, options, colourStats);
  const role = scoreOutlineComponentRole(info);

  // 关键：大面积 non-outlined component 默认是填充残块，不再允许靠深色 lineScore 整块保留。
  // 真正的勾线通常是小块、细长或高边界；大面积填充应该被删。
  if (!info.isSmall && !info.isThin && info.boundaryRatio < 0.82) {
    return false;
  }

  // 明确结构：主勾线、次勾线、深色小结构，保留。
  if ((info.isSmall || info.isThin || info.boundaryRatio >= 0.82) && (role.lineScore >= 72 || role.subLineScore >= 70)) {
    return true;
  }

  // 有色小装饰：金色、棕色、粉色、耳朵细节，保留。
  if (role.detailScore >= 64) {
    return true;
  }

  // 明确噪点 / 填充残块：删除。
  if (role.noiseScore >= 62 && role.lineScore < 55 && role.detailScore < 55) {
    return false;
  }

  // 大面积非 outline component，除非是结构/装饰，否则不保留。
  if (!info.isSmall) {
    return false;
  }

  // 小而细的深色结构保守保留。
  if (info.isThin && info.luma <= 96) {
    return true;
  }

  // 其他小块如果是浅色低饱和，倾向删除，避免 128 色白斑。
  if (info.luma >= 108 && info.chroma <= 42) {
    return false;
  }

  return false;
}

interface OutlineComponentRoleInfo {
  area: number;
  globalColourRatio: number;
  width: number;
  height: number;
  span: number;
  shortSpan: number;
  density: number;
  boundaryRatio: number;
  luma: number;
  chroma: number;
  isSmall: boolean;
  isTiny: boolean;
  isThin: boolean;
  adjacent: OutlineAdjacentInfo;
}

interface OutlineComponentRoleScore {
  lineScore: number;
  subLineScore: number;
  detailScore: number;
  noiseScore: number;
}

function getOutlineComponentRoleInfo(
  pixelMap: PixelMap,
  component: Component,
  boundaryCount: number,
  options: Required<OutlinePixelMapOptions>,
  colourStats: OutlineColourStats,
): OutlineComponentRoleInfo {
  const area = component.points.length;
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const span = Math.max(width, height);
  const shortSpan = Math.min(width, height);
  const bboxArea = width * height;
  const density = bboxArea > 0 ? area / bboxArea : 0;
  const boundaryRatio = area > 0 ? boundaryCount / area : 1;
  const sample = component.points[0];
  const samplePixel = sample ? pixelMap[sample.y]?.[sample.x] : null;
  const sampleHex = normalizeOutlineHex(samplePixel?.colorHex ?? "#000000");
  const luma = outlineLuma(sampleHex);
  const chroma = outlineChroma(sampleHex);
  const colourCount = colourStats.counts.get(sampleHex) ?? area;
  const globalColourRatio = colourStats.totalPixels > 0 ? colourCount / colourStats.totalPixels : 0;
  const adjacent = getOutlineAdjacentInfo(pixelMap, component, sampleHex);

  return {
    area,
    globalColourRatio,
    width,
    height,
    span,
    shortSpan,
    density,
    boundaryRatio,
    luma,
    chroma,
    isSmall: area < options.largeComponentMinSize,
    isTiny: area <= options.noiseComponentMaxSize,
    isThin: shortSpan <= 2 || (shortSpan <= 3 && span >= 8),
    adjacent,
  };
}

function scoreOutlineComponentRole(info: OutlineComponentRoleInfo): OutlineComponentRoleScore {
  const dark = Math.max(0, 105 - info.luma);
  const midDark = info.luma >= 45 && info.luma <= 105 ? 1 : 0;
  const lowChroma = info.chroma <= 34;
  const coloured = info.chroma >= 12;
  const rareColour = info.globalColourRatio <= 0.035;
  const paleNeutral = info.luma >= 108 && info.chroma <= 44;
  const weakNeutral = info.luma >= 92 && info.chroma <= 24;
  const similarAdjacent = info.adjacent.nearestDistance <= 24;
  const dominantAdjacent = info.adjacent.dominantShare >= 0.58;
  const fragmented = info.density < 0.72 || info.boundaryRatio >= 0.70;

  let lineScore = 0;
  lineScore += dark * 0.95;
  lineScore += info.isThin ? 32 : 0;
  lineScore += info.boundaryRatio >= 0.55 ? 24 : 0;
  lineScore += lowChroma && info.luma <= 92 ? 18 : 0;
  lineScore += info.adjacent.touchesDarkLineLike ? 12 : 0;
  lineScore += info.isSmall ? 10 : 0;
  lineScore -= paleNeutral ? 45 : 0;
  lineScore -= similarAdjacent && dominantAdjacent && paleNeutral ? 22 : 0;

  let subLineScore = 0;
  subLineScore += midDark ? 28 : 0;
  subLineScore += info.isThin ? 24 : 0;
  subLineScore += info.boundaryRatio >= 0.48 ? 18 : 0;
  subLineScore += info.adjacent.touchesDarkLineLike ? 14 : 0;
  subLineScore += info.luma <= 120 && info.chroma <= 48 ? 12 : 0;
  subLineScore -= paleNeutral ? 28 : 0;

  let detailScore = 0;
  detailScore += coloured ? 24 : 0;
  detailScore += rareColour ? 26 : 0;
  detailScore += info.isSmall ? 18 : 0;
  detailScore += info.adjacent.touchesDarkLineLike ? 18 : 0;
  detailScore += info.luma >= 35 && info.luma <= 215 ? 12 : 0;
  detailScore -= paleNeutral && info.chroma <= 18 ? 35 : 0;

  let noiseScore = 0;
  noiseScore += paleNeutral ? 34 : 0;
  noiseScore += weakNeutral ? 20 : 0;
  noiseScore += similarAdjacent ? 22 : 0;
  noiseScore += dominantAdjacent ? 24 : 0;
  noiseScore += fragmented ? 18 : 0;
  noiseScore += info.globalColourRatio >= 0.018 ? 14 : 0;
  noiseScore += info.area >= 96 ? 12 : 0;
  noiseScore -= info.isThin && info.luma <= 92 ? 42 : 0;
  noiseScore -= detailScore >= 55 ? 38 : 0;
  noiseScore -= lineScore >= 60 ? 45 : 0;

  return {
    lineScore,
    subLineScore,
    detailScore,
    noiseScore,
  };
}

function getOutlineAdjacentInfo(
  pixelMap: PixelMap,
  component: Component,
  componentHex: string,
): OutlineAdjacentInfo {
  const componentPoints = new Set(component.points.map((point) => `${point.x},${point.y}`));
  const adjacentCounts = new Map<string, number>();
  let totalAdjacent = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestLumaGap = Number.POSITIVE_INFINITY;
  let touchesDarkLineLike = false;

  for (const point of component.points) {
    for (const { dx, dy } of NEIGHBORS) {
      const nx = point.x + dx;
      const ny = point.y + dy;

      if (componentPoints.has(`${nx},${ny}`)) {
        continue;
      }

      const neighbour = pixelMap[ny]?.[nx];
      if (!isDrawable(neighbour)) {
        continue;
      }

      const neighbourHex = normalizeOutlineHex(neighbour.colorHex);
      if (neighbourHex === componentHex) {
        continue;
      }

      adjacentCounts.set(neighbourHex, (adjacentCounts.get(neighbourHex) ?? 0) + 1);
      totalAdjacent += 1;

      const distance = outlineColourDistance(componentHex, neighbourHex);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestLumaGap = Math.abs(outlineLuma(componentHex) - outlineLuma(neighbourHex));
      }

      const nl = outlineLuma(neighbourHex);
      const nc = outlineChroma(neighbourHex);
      if (nl <= 72 || (nl <= 92 && nc <= 34)) {
        touchesDarkLineLike = true;
      }
    }
  }

  let dominantShare = 0;
  for (const count of adjacentCounts.values()) {
    dominantShare = Math.max(dominantShare, totalAdjacent > 0 ? count / totalAdjacent : 0);
  }

  return {
    dominantShare,
    nearestDistance: Number.isFinite(nearestDistance) ? nearestDistance : 999,
    nearestLumaGap: Number.isFinite(nearestLumaGap) ? nearestLumaGap : 999,
    touchesDarkLineLike,
  };
}

function outlineColourDistance(leftHex: string, rightHex: string): number {
  const left = parseOutlineHex(leftHex);
  const right = parseOutlineHex(rightHex);
  return (
    Math.abs(left.r - right.r) * 0.35 +
    Math.abs(left.g - right.g) * 0.4 +
    Math.abs(left.b - right.b) * 0.25
  );
}

function normalizeOutlineHex(hex: string): string {
  const normalized = String(hex ?? "").trim().replace(/^#/, "").toLowerCase();
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized.padEnd(6, "0").slice(0, 6);

  return `#${value}`;
}


function outlineLuma(hex: string): number {
  const rgb = parseOutlineHex(hex);
  return rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114;
}

function outlineChroma(hex: string): number {
  const rgb = parseOutlineHex(hex);
  return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
}

function parseOutlineHex(hex: string): { r: number; g: number; b: number } {
  const normalized = String(hex ?? "").trim().replace(/^#/, "").toLowerCase();
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized.padEnd(6, "0").slice(0, 6);

  return {
    r: Number.parseInt(value.slice(0, 2), 16) || 0,
    g: Number.parseInt(value.slice(2, 4), 16) || 0,
    b: Number.parseInt(value.slice(4, 6), 16) || 0,
  };
}

export function createOutlinePixelMap(
  pixelMap: PixelMap,
  options: OutlinePixelMapOptions = {},
): PixelMap {
  const resolved: Required<OutlinePixelMapOptions> = {
    largeComponentMinSize: Math.max(1, Math.floor(options.largeComponentMinSize ?? 128)),
    minOutlineSpan: Math.max(1, Math.floor(options.minOutlineSpan ?? 16)),
    minDensity: options.minDensity ?? 0.55,
    maxBoundaryRatio: options.maxBoundaryRatio ?? 0.35,
    noiseComponentMaxSize: Math.max(1, Math.floor(options.noiseComponentMaxSize ?? 18)),
    minKeepSpan: Math.max(1, Math.floor(options.minKeepSpan ?? 5)),
    maxNoiseBoundaryRatio: options.maxNoiseBoundaryRatio ?? 0.68,
  };

  const height = pixelMap.length;
  const width = pixelMap[0]?.length ?? 0;
  const outlineColourStats = buildOutlineColourStats(pixelMap);

  const visited = makeVisited(height, width);
  const keep = Array.from({ length: height }, () => Array(width).fill(false));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (visited[y]![x]) {
        continue;
      }

      const pixel = pixelMap[y]?.[x];

      if (!isDrawable(pixel)) {
        visited[y]![x] = true;
        continue;
      }

      const component = collectComponent(pixelMap, visited, x, y);

      if (!component) {
        continue;
      }

      const boundaryPoints = component.points.filter((point) =>
        isBoundaryPixel(pixelMap, point.x, point.y),
      );

      const outlineThisComponent = shouldOutlineComponent(
        component,
        boundaryPoints.length,
        resolved,
      );

      if (outlineThisComponent) {
        for (const point of boundaryPoints) {
          keep[point.y]![point.x] = true;
        }
      } else if (
        shouldKeepNonOutlinedComponent(
          pixelMap,
          component,
          boundaryPoints.length,
          resolved,
          outlineColourStats,
        )
      ) {
        for (const point of component.points) {
          keep[point.y]![point.x] = true;
        }
      }
    }
  }

  return pixelMap.map((row, y) =>
    row.map((pixel, x) => {
      if (!isDrawable(pixel)) {
        return pixel;
      }

      return keep[y]![x] ? pixel : erasePixel(pixel);
    }),
  );
}
