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

function shouldKeepNonOutlinedComponent(
  pixelMap: PixelMap,
  component: Component,
  boundaryCount: number,
  options: Required<OutlinePixelMapOptions>,
): boolean {
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
  const luma = samplePixel ? outlineLuma(samplePixel.colorHex) : 255;
  const chroma = samplePixel ? outlineChroma(samplePixel.colorHex) : 0;

  const isSmall = area < options.largeComponentMinSize;
  const isTiny = area <= options.noiseComponentMaxSize;
  const isThin = shortSpan <= 2 || (shortSpan <= 3 && span >= 8);
  const isHighlyBoundary = boundaryRatio >= 0.62;

  const lineLike =
    luma <= 62 ||
    (luma <= 86 && chroma <= 34) ||
    (luma <= 78 && chroma > 34);

  const colouredDetail =
    chroma >= 12 &&
    luma >= 45 &&
    luma <= 205 &&
    area <= options.largeComponentMinSize * 2;

  // 金色 / 棕色 / 粉色 / 小装饰：先保留，避免黄色细节被当成噪点吃掉。
  if (colouredDetail && (isSmall || isThin || isHighlyBoundary)) {
    return true;
  }

  // 深色线稿、鼻子、嘴、胡子：只在“小 / 细 / 高边界”时保留。
  // 不再把大面积深色填充整块当成线稿保留。
  if (lineLike && (isSmall || isThin || isHighlyBoundary)) {
    return true;
  }

  // 亮白 / 浅灰 / 低饱和的小碎块：删除。
  if (
    isTiny &&
    luma >= 120 &&
    chroma <= 46
  ) {
    return false;
  }

  // 小而跨度很小、边界占比高的碎点：删除。
  if (
    isTiny &&
    span <= options.minKeepSpan &&
    boundaryRatio >= options.maxNoiseBoundaryRatio &&
    chroma <= 35
  ) {
    return false;
  }

  // 大面积且没有被 outline 的 component，说明它不适合转边界。
  // outline 模式下不要整块保留，否则会残留大色块。
  if (!isSmall) {
    return false;
  }

  // 其他小块：保守保留，避免误删五官、饰品、小结构。
  return true;
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
      } else if (shouldKeepNonOutlinedComponent(pixelMap, component, boundaryPoints.length, resolved)) {
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
