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

export function createOutlinePixelMap(
  pixelMap: PixelMap,
  options: OutlinePixelMapOptions = {},
): PixelMap {
  const resolved: Required<OutlinePixelMapOptions> = {
    largeComponentMinSize: Math.max(1, Math.floor(options.largeComponentMinSize ?? 128)),
    minOutlineSpan: Math.max(1, Math.floor(options.minOutlineSpan ?? 16)),
    minDensity: options.minDensity ?? 0.55,
    maxBoundaryRatio: options.maxBoundaryRatio ?? 0.35,
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
      } else {
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
