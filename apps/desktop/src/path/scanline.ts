import type { DrawingProfile, Pixel, PixelMap } from "../types.js";
import {
  createBrushGrid,
  gridCellToCanvasCenter,
  type BrushGrid,
} from "../brushGrid.js";
import { officialPaletteCellFromIndex } from "../config/officialPalette.js";
import {
  basicPaletteConfigCommand,
  basicPaletteResetCommand,
  colorCommand,
  drawCommand,
  endCommand,
  homeCommand,
  inputConfigCommand,
  lineCommand,
  moveCommand,
  paletteConfigCommand,
  type DrawCommand,
} from "../protocol/commands.js";
import { DEFAULT_SAFE_INPUT_TIMING } from "../protocol/timing.js";

export type PathStrategy = "scanline" | "nearest" | "runs";

const PALETTE_SLOT_COUNT = 9;
const EXACT_COMPONENT_ORDER_LIMIT = 6;
const EXACT_COMPONENT_PIXEL_LIMIT = 300;
const NEIGHBOR_OFFSETS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

function groupPixelsByColor(pixelMap: PixelMap): Map<number, Pixel[]> {
  const byColor = new Map<number, Pixel[]>();

  for (const row of pixelMap) {
    for (const pixel of row) {
      if (pixel.alpha <= 0 || pixel.colorIndex < 0) continue;

      let arr = byColor.get(pixel.colorIndex);
      if (!arr) {
        arr = [];
        byColor.set(pixel.colorIndex, arr);
      }
      arr.push(pixel);
    }
  }

  return byColor;
}

function getLegacyScanlinePixels(pixels: Pixel[]): Pixel[] {
  if (pixels.length === 0) return [];

  const rowsByY = new Map<number, Pixel[]>();
  for (const p of pixels) {
    let row = rowsByY.get(p.y);
    if (!row) {
      row = [];
      rowsByY.set(p.y, row);
    }
    row.push(p);
  }

  const sortedY = [...rowsByY.keys()].sort((a, b) => a - b);
  return sortedY.flatMap((y) => {
    const row = rowsByY.get(y)!;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    return y % 2 === 0 ? sorted : sorted.reverse();
  });
}

function pixelKey(point: { x: number; y: number }): string {
  return `${point.x},${point.y}`;
}

function buildSerpentineRows(pixels: Pixel[], fromBottom = false): Pixel[] {
  const rows = new Map<number, Pixel[]>();

  for (const pixel of pixels) {
    const row = rows.get(pixel.y);
    if (row) {
      row.push(pixel);
    } else {
      rows.set(pixel.y, [pixel]);
    }
  }

  const sortedRows = Array.from(rows.entries()).sort((left, right) => left[0] - right[0]);

  if (fromBottom) {
    sortedRows.reverse();
  }

  return sortedRows.flatMap(([rowNumber, row]) => {
    const sorted = [...row].sort((left, right) => left.x - right.x);

    if (rowNumber % 2 === 0) {
      return sorted;
    }

    return sorted.reverse();
  });
}

function rotatePixelsToNearestStart(
  pixels: Pixel[],
  current: { x: number; y: number },
  grid: BrushGrid,
): Pixel[] {
  if (pixels.length <= 1) {
    return pixels;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  pixels.forEach((pixel, index) => {
    const target = toCanvasPosition(pixel, grid);
    const distance = Math.abs(target.x - current.x) + Math.abs(target.y - current.y);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  if (nearestIndex === 0) {
    return pixels;
  }

  return [...pixels.slice(nearestIndex), ...pixels.slice(0, nearestIndex)];
}

function chooseBestSerpentineOrder(
  pixels: Pixel[],
  current: { x: number; y: number },
  grid: BrushGrid,
): Pixel[] {
  if (pixels.length <= 1) {
    return pixels;
  }

  const topDown = rotatePixelsToNearestStart(buildSerpentineRows(pixels, false), current, grid);
  const bottomUp = rotatePixelsToNearestStart(buildSerpentineRows(pixels, true), current, grid);

  const topFirst = topDown[0];
  const bottomFirst = bottomUp[0];

  if (!topFirst) {
    return bottomUp;
  }

  if (!bottomFirst) {
    return topDown;
  }

  const topStart = toCanvasPosition(topFirst, grid);
  const bottomStart = toCanvasPosition(bottomFirst, grid);
  const topDistance = Math.abs(topStart.x - current.x) + Math.abs(topStart.y - current.y);
  const bottomDistance = Math.abs(bottomStart.x - current.x) + Math.abs(bottomStart.y - current.y);

  return topDistance <= bottomDistance ? topDown : bottomUp;
}

function collectConnectedComponents(pixels: Pixel[]): Pixel[][] {
  if (pixels.length === 0) {
    return [];
  }

  const pixelByKey = new Map<string, Pixel>(pixels.map((pixel) => [pixelKey(pixel), pixel]));
  const visited = new Set<string>();
  const components: Pixel[][] = [];

  for (const pixel of pixels) {
    const startKey = pixelKey(pixel);
    if (visited.has(startKey)) {
      continue;
    }

    const stack = [pixel];
    const component: Pixel[] = [];
    visited.add(startKey);

    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);

      for (const offset of NEIGHBOR_OFFSETS) {
        const neighbor = pixelByKey.get(
          pixelKey({ x: current.x + offset.dx, y: current.y + offset.dy }),
        );

        if (!neighbor) {
          continue;
        }

        const neighborKey = pixelKey(neighbor);

        if (visited.has(neighborKey)) {
          continue;
        }

        visited.add(neighborKey);
        stack.push(neighbor);
      }
    }

    components.push(component);
  }

  return components;
}

function getNearestNeighborPixels(
  pixels: Pixel[],
  current: { x: number; y: number },
  grid: BrushGrid,
): Pixel[] {
  if (pixels.length === 0) return [];

  const remaining = new Map<string, Pixel>(pixels.map((pixel) => [pixelKey(pixel), pixel]));
  const ordered: Pixel[] = [];
  let lastDir: { dx: number; dy: number } | null = null;
  let last: Pixel | null = null;
  let position = current;

  while (remaining.size > 0) {
    let next: Pixel | null = null;

    if (last && lastDir) {
      const candidate = remaining.get(pixelKey({ x: last.x + lastDir.dx, y: last.y + lastDir.dy }));
      if (candidate) {
        next = candidate;
      }
    }

    if (!next && last) {
      for (const offset of NEIGHBOR_OFFSETS) {
        const candidate = remaining.get(pixelKey({ x: last.x + offset.dx, y: last.y + offset.dy }));
        if (candidate) {
          next = candidate;
          break;
        }
      }
    }

    if (!next) {
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of remaining.values()) {
        const target = toCanvasPosition(candidate, grid);
        const distance = Math.abs(target.x - position.x) + Math.abs(target.y - position.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          next = candidate;
        }
      }
    }

    if (!next) break;

    if (last) {
      const dx = next.x - last.x;
      const dy = next.y - last.y;
      const isUnitStep = Math.abs(dx) + Math.abs(dy) === 1;
      lastDir = isUnitStep ? { dx, dy } : null;
    }
    ordered.push(next);
    remaining.delete(pixelKey(next));
    position = toCanvasPosition(next, grid);
    last = next;
  }

  return ordered;
}

function getNearestNeighborPixelsByComponents(
  pixels: Pixel[],
  current: { x: number; y: number },
  grid: BrushGrid,
): Pixel[] {
  const components = collectConnectedComponents(pixels);
  if (components.length <= 1) {
    return getNearestNeighborPixels(pixels, current, grid);
  }

  const remaining = components.slice();
  const ordered: Pixel[] = [];
  let position = current;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const component = remaining[i]!;
      for (const pixel of component) {
        const target = toCanvasPosition(pixel, grid);
        const distance = Math.abs(target.x - position.x) + Math.abs(target.y - position.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
          if (distance === 0) break;
        }
      }
    }

    const [chosen] = remaining.splice(bestIndex, 1);
    if (!chosen) break;

    const sub = getNearestNeighborPixels(chosen, position, grid);
    if (sub.length === 0) continue;

    ordered.push(...sub);
    const lastPixel = sub[sub.length - 1]!;
    position = toCanvasPosition(lastPixel, grid);
  }

  return ordered;
}


interface PixelRun {
  pixels: Pixel[];
  start: Pixel;
  end: Pixel;
}

interface PixelRunBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PixelRunComponent {
  runs: PixelRun[];
  bounds: PixelRunBounds;
}

interface OrderedRunResult {
  pixels: Pixel[];
  endPosition: { x: number; y: number };
  travelDistance: number;
}

function getRunBounds(run: PixelRun): PixelRunBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const pixel of run.pixels) {
    minX = Math.min(minX, pixel.x);
    minY = Math.min(minY, pixel.y);
    maxX = Math.max(maxX, pixel.x);
    maxY = Math.max(maxY, pixel.y);
  }

  return { minX, minY, maxX, maxY };
}

function mergeRunBounds(left: PixelRunBounds, right: PixelRunBounds): PixelRunBounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

function areRunBoundsNear(left: PixelRunBounds, right: PixelRunBounds, gap: number): boolean {
  return !(
    left.maxX + gap < right.minX ||
    right.maxX + gap < left.minX ||
    left.maxY + gap < right.minY ||
    right.maxY + gap < left.minY
  );
}

function collectRunComponents(runs: PixelRun[], gap: number): PixelRunComponent[] {
  if (runs.length === 0) {
    return [];
  }

  const boundsByRun = runs.map(getRunBounds);
  const visited = new Set<number>();
  const components: PixelRunComponent[] = [];

  for (let index = 0; index < runs.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }

    const stack = [index];
    visited.add(index);
    const componentRuns: PixelRun[] = [];
    let componentBounds = boundsByRun[index]!;

    while (stack.length > 0) {
      const currentIndex = stack.pop()!;
      const currentRun = runs[currentIndex];
      const currentBounds = boundsByRun[currentIndex];

      if (!currentRun || !currentBounds) {
        continue;
      }

      componentRuns.push(currentRun);
      componentBounds = mergeRunBounds(componentBounds, currentBounds);

      for (let nextIndex = 0; nextIndex < runs.length; nextIndex += 1) {
        if (visited.has(nextIndex)) {
          continue;
        }

        const nextBounds = boundsByRun[nextIndex];

        if (!nextBounds) {
          continue;
        }

        if (areRunBoundsNear(componentBounds, nextBounds, gap)) {
          visited.add(nextIndex);
          stack.push(nextIndex);
        }
      }
    }

    components.push({
      runs: componentRuns,
      bounds: componentBounds,
    });
  }

  return components;
}

function distanceToRunEndpoint(
  run: PixelRun,
  current: { x: number; y: number },
  grid: BrushGrid,
): number {
  const start = toCanvasPosition(run.start, grid);
  const end = toCanvasPosition(run.end, grid);

  return Math.min(
    Math.abs(start.x - current.x) + Math.abs(start.y - current.y),
    Math.abs(end.x - current.x) + Math.abs(end.y - current.y),
  );
}

function distanceToRunComponent(
  component: PixelRunComponent,
  current: { x: number; y: number },
  grid: BrushGrid,
): number {
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const run of component.runs) {
    bestDistance = Math.min(bestDistance, distanceToRunEndpoint(run, current, grid));
  }

  return bestDistance;
}

function orderRunsGreedy(
  runs: PixelRun[],
  current: { x: number; y: number },
  grid: BrushGrid,
): OrderedRunResult {
  const remaining = runs.slice();
  const orderedPixels: Pixel[] = [];
  let position = current;
  let travelDistance = 0;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    remaining.forEach((run, index) => {
      const distance = distanceToRunEndpoint(run, position, grid);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    const [run] = remaining.splice(bestIndex, 1);
    if (!run) {
      break;
    }

    const orderedRun = chooseRunDirection(run, position, grid);
    const first = orderedRun[0];
    const last = orderedRun[orderedRun.length - 1];

    if (first) {
      const firstPosition = toCanvasPosition(first, grid);
      travelDistance += Math.abs(firstPosition.x - position.x) + Math.abs(firstPosition.y - position.y);
    }

    orderedPixels.push(...orderedRun);

    if (last) {
      position = toCanvasPosition(last, grid);
    }
  }

  return {
    pixels: orderedPixels,
    endPosition: position,
    travelDistance,
  };
}

function orderRunComponentsGreedy(
  runs: PixelRun[],
  current: { x: number; y: number },
  grid: BrushGrid,
  profile: DrawingProfile,
): OrderedRunResult {
  const componentGap = Math.max(3, profile.brushSize * 2);
  const remaining = collectRunComponents(runs, componentGap);
  const orderedPixels: Pixel[] = [];
  let position = current;
  let travelDistance = 0;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    remaining.forEach((component, index) => {
      const distance = distanceToRunComponent(component, position, grid);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    const [component] = remaining.splice(bestIndex, 1);

    if (!component) {
      break;
    }

    const orderedComponent = orderRunsGreedy(component.runs, position, grid);
    orderedPixels.push(...orderedComponent.pixels);
    travelDistance += orderedComponent.travelDistance;
    position = orderedComponent.endPosition;
  }

  return {
    pixels: orderedPixels,
    endPosition: position,
    travelDistance,
  };
}

function buildHorizontalRuns(pixels: Pixel[]): PixelRun[] {
  const rows = new Map<number, Pixel[]>();

  for (const pixel of pixels) {
    const row = rows.get(pixel.y);
    if (row) {
      row.push(pixel);
    } else {
      rows.set(pixel.y, [pixel]);
    }
  }

  const runs: PixelRun[] = [];

  for (const row of rows.values()) {
    const sorted = [...row].sort((left, right) => left.x - right.x);
    let current: Pixel[] = [];

    for (const pixel of sorted) {
      const previous = current[current.length - 1];

      if (!previous || pixel.x === previous.x + 1) {
        current.push(pixel);
        continue;
      }

      const start = current[0];
      const end = current[current.length - 1];
      if (start && end) {
        runs.push({ pixels: current, start, end });
      }

      current = [pixel];
    }

    const start = current[0];
    const end = current[current.length - 1];
    if (start && end) {
      runs.push({ pixels: current, start, end });
    }
  }

  return runs;
}

function buildVerticalRuns(pixels: Pixel[]): PixelRun[] {
  const cols = new Map<number, Pixel[]>();

  for (const pixel of pixels) {
    const col = cols.get(pixel.x);
    if (col) {
      col.push(pixel);
    } else {
      cols.set(pixel.x, [pixel]);
    }
  }

  const runs: PixelRun[] = [];

  for (const col of cols.values()) {
    const sorted = [...col].sort((top, bottom) => top.y - bottom.y);
    let current: Pixel[] = [];

    for (const pixel of sorted) {
      const previous = current[current.length - 1];

      if (!previous || pixel.y === previous.y + 1) {
        current.push(pixel);
        continue;
      }

      const start = current[0];
      const end = current[current.length - 1];
      if (start && end) {
        runs.push({ pixels: current, start, end });
      }

      current = [pixel];
    }

    const start = current[0];
    const end = current[current.length - 1];
    if (start && end) {
      runs.push({ pixels: current, start, end });
    }
  }

  return runs;
}

function chooseRunDirection(
  run: PixelRun,
  current: { x: number; y: number },
  grid: BrushGrid,
): Pixel[] {
  const startPosition = toCanvasPosition(run.start, grid);
  const endPosition = toCanvasPosition(run.end, grid);

  const startDistance =
    Math.abs(startPosition.x - current.x) + Math.abs(startPosition.y - current.y);
  const endDistance =
    Math.abs(endPosition.x - current.x) + Math.abs(endPosition.y - current.y);

  return startDistance <= endDistance ? run.pixels : [...run.pixels].reverse();
}

function estimateRunPlanDistance(
  runs: PixelRun[],
  current: { x: number; y: number },
  grid: BrushGrid,
): number {
  const remaining = runs.slice();
  let position = current;
  let total = 0;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    remaining.forEach((run, index) => {
      const start = toCanvasPosition(run.start, grid);
      const end = toCanvasPosition(run.end, grid);
      const distance = Math.min(
        Math.abs(start.x - position.x) + Math.abs(start.y - position.y),
        Math.abs(end.x - position.x) + Math.abs(end.y - position.y),
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    const [run] = remaining.splice(bestIndex, 1);
    if (!run) break;

    const ordered = chooseRunDirection(run, position, grid);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];

    if (first) {
      const firstPos = toCanvasPosition(first, grid);
      total += Math.abs(firstPos.x - position.x) + Math.abs(firstPos.y - position.y);
    }

    if (last) {
      position = toCanvasPosition(last, grid);
    }
  }

  return total;
}

function getRunOptimizedPixels(
  pixels: Pixel[],
  current: { x: number; y: number },
  grid: BrushGrid,
  profile: DrawingProfile,
): Pixel[] {
  if (pixels.length <= 1) {
    return pixels;
  }

  const horizontalRuns = buildHorizontalRuns(pixels);
  const verticalRuns = buildVerticalRuns(pixels);

  const candidates = [
    orderRunComponentsGreedy(horizontalRuns, current, grid, profile),
    orderRunComponentsGreedy(verticalRuns, current, grid, profile),
    orderRunsGreedy(horizontalRuns, current, grid),
    orderRunsGreedy(verticalRuns, current, grid),
  ];

  const best = candidates.reduce((selected, candidate) =>
    candidate.travelDistance < selected.travelDistance ? candidate : selected,
  );

  return best.pixels;
}


function getOrderedPixelsForColor(
  pixelsByColor: Map<number, Pixel[]>,
  colorIndex: number,
  current: { x: number; y: number },
  profile: DrawingProfile,
  grid: BrushGrid,
  pathStrategy: PathStrategy,
): Pixel[] {
  const pixels = pixelsByColor.get(colorIndex);
  if (!pixels || pixels.length === 0) return [];

  if (pathStrategy === "nearest") {
    return getNearestNeighborPixelsByComponents(pixels, current, grid);
  }

  if (pathStrategy === "runs") {
    return getRunOptimizedPixels(pixels, current, grid, profile);
  }

  if (profile.brushSize === 1) {
    return getLegacyScanlinePixels(pixels);
  }

  const components = collectConnectedComponents(pixels);
  const legacyPixels = rotatePixelsToNearestStart(
    getLegacyScanlinePixels(pixels),
    current,
    grid,
  );

  if (components.length <= 1) {
    return legacyPixels;
  }

  let orderedPixels: Pixel[];

  if (
    components.length <= EXACT_COMPONENT_ORDER_LIMIT &&
    pixels.length <= EXACT_COMPONENT_PIXEL_LIMIT
  ) {
    orderedPixels = findOptimalComponentOrder(components, current, grid);
  } else {
    orderedPixels = greedyComponentOrder(components, current, grid);
  }

  const optimizedDistance = estimateTravelDistance(current, orderedPixels, grid);
  const legacyDistance = estimateTravelDistance(current, legacyPixels, grid);

  return optimizedDistance < legacyDistance ? orderedPixels : legacyPixels;
}

function greedyComponentOrder(
  components: Pixel[][],
  current: { x: number; y: number },
  grid: BrushGrid,
): Pixel[] {
  const remaining = [...components];
  const orderedPixels: Pixel[] = [];
  let currentPosition = current;

  while (remaining.length > 0) {
    let selectedIndex = 0;
    let selectedDistance = Number.POSITIVE_INFINITY;
    let selectedOrder: Pixel[] = [];

    remaining.forEach((component, index) => {
      const candidate = chooseBestSerpentineOrder(component, currentPosition, grid);

      if (candidate.length === 0) return;

      const firstPixel = candidate[0];
      if (!firstPixel) return;

      const start = toCanvasPosition(firstPixel, grid);
      const distance =
        Math.abs(start.x - currentPosition.x) + Math.abs(start.y - currentPosition.y);

      if (distance < selectedDistance) {
        selectedDistance = distance;
        selectedIndex = index;
        selectedOrder = candidate;
      }
    });

    const lastPixel = selectedOrder[selectedOrder.length - 1];

    if (selectedOrder.length > 0) {
      orderedPixels.push(...selectedOrder);
    }

    if (lastPixel) {
      currentPosition = toCanvasPosition(lastPixel, grid);
    }

    remaining.splice(selectedIndex, 1);
  }

  return orderedPixels;
}

function findOptimalComponentOrder(
  components: Pixel[][],
  current: { x: number; y: number },
  grid: BrushGrid,
): Pixel[] {
  if (components.length <= 1) {
    return chooseBestSerpentineOrder(components[0] ?? [], current, grid);
  }

  // Pre-compute top-down and bottom-up serpentine rows for each component
  const precomputed = components.map((comp) => ({
    topDown: buildSerpentineRows(comp, false),
    bottomUp: buildSerpentineRows(comp, true),
  }));

  function bestVariant(
    pre: (typeof precomputed)[number],
    pos: { x: number; y: number },
  ): { pixels: Pixel[]; endPos: { x: number; y: number } } {
    const td = rotatePixelsToNearestStart(pre.topDown, pos, grid);
    const bu = rotatePixelsToNearestStart(pre.bottomUp, pos, grid);

    const tdStart = td[0];
    const buStart = bu[0];

    if (!tdStart) {
      const last = bu[bu.length - 1];
      return { pixels: bu, endPos: last ? toCanvasPosition(last, grid) : pos };
    }
    if (!buStart) {
      const last = td[td.length - 1];
      return { pixels: td, endPos: last ? toCanvasPosition(last, grid) : pos };
    }

    const tdPos = toCanvasPosition(tdStart, grid);
    const buPos = toCanvasPosition(buStart, grid);
    const tdDist = Math.abs(tdPos.x - pos.x) + Math.abs(tdPos.y - pos.y);
    const buDist = Math.abs(buPos.x - pos.x) + Math.abs(buPos.y - pos.y);

    if (tdDist <= buDist) {
      const last = td[td.length - 1];
      return { pixels: td, endPos: last ? toCanvasPosition(last, grid) : pos };
    }
    const last = bu[bu.length - 1];
    return { pixels: bu, endPos: last ? toCanvasPosition(last, grid) : pos };
  }

  let bestOrder: Pixel[] = [];
  let bestDistance = Number.POSITIVE_INFINITY;

  function* permute<T>(arr: T[]): Generator<T[]> {
    if (arr.length <= 1) {
      yield arr;
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const p of permute(rest)) {
        yield [arr[i]!, ...p];
      }
    }
  }

  const indices = [...Array(components.length).keys()];

  for (const order of permute(indices)) {
    let pos = current;
    let totalDist = 0;
    const ordered: Pixel[] = [];

    for (const idx of order) {
      const pre = precomputed[idx];
      if (!pre) continue;
      const variant = bestVariant(pre, pos);

      if (variant.pixels.length === 0) continue;

      const first = variant.pixels[0];
      if (first) {
        const startPos = toCanvasPosition(first, grid);
        totalDist += Math.abs(startPos.x - pos.x) + Math.abs(startPos.y - pos.y);
      }

      ordered.push(...variant.pixels);
      pos = variant.endPos;
    }

    if (totalDist < bestDistance) {
      bestDistance = totalDist;
      bestOrder = ordered;
    }
  }

  return bestOrder;
}

function toCanvasPosition(
  point: { x: number; y: number },
  grid: BrushGrid,
): { x: number; y: number } {
  return gridCellToCanvasCenter(grid, point);
}

function moveTo(
  current: { x: number; y: number },
  target: { x: number; y: number },
  grid: BrushGrid,
): DrawCommand[] {
  const canvasTarget = toCanvasPosition(target, grid);
  const dx = canvasTarget.x - current.x;
  const dy = canvasTarget.y - current.y;

  if (dx === 0 && dy === 0) {
    return [];
  }

  return [moveCommand(dx, dy)];
}

function estimateTravelDistance(
  current: { x: number; y: number },
  pixels: Pixel[],
  grid: BrushGrid,
): number {
  let total = 0;
  let currentPosition = current;

  for (const pixel of pixels) {
    const next = toCanvasPosition(pixel, grid);
    total += Math.abs(next.x - currentPosition.x) + Math.abs(next.y - currentPosition.y);
    currentPosition = next;
  }

  return total;
}

function resolveStartOffset(profile: DrawingProfile): { dx: number; dy: number } | null {
  if (profile.startCursor === "top-left") {
    return null;
  }

  const dx =
    profile.centerToTopLeftDx !== 0 ? profile.centerToTopLeftDx : -Math.floor(profile.canvasWidth / 2);
  const dy =
    profile.centerToTopLeftDy !== 0 ? profile.centerToTopLeftDy : -Math.floor(profile.canvasHeight / 2);

  if (dx === 0 && dy === 0) {
    return null;
  }

  return { dx, dy };
}

function shouldStartFromCanvasCenter(profile: DrawingProfile): boolean {
  return profile.startCursor === "center";
}


function prioritiseLineLikePaletteColours(
  colours: Array<{ colorIndex: number; colorHex: string; pixelCount?: number }>,
): Array<{ colorIndex: number; colorHex: string; pixelCount?: number }> {
  return [...colours].sort((a, b) => {
    const aInfo = paletteColourPriorityInfo(a.colorHex, a.pixelCount ?? 0);
    const bInfo = paletteColourPriorityInfo(b.colorHex, b.pixelCount ?? 0);

    // 第一优先：线稿候选色必须排在普通填充色前。
    if (aInfo.isLineLike !== bInfo.isLineLike) {
      return aInfo.isLineLike ? -1 : 1;
    }

    if (aInfo.isLineLike && bInfo.isLineLike) {
      // 第二优先：最深色先注入，确保 PC0 是最深的线稿/黑线候选。
      if (aInfo.luma !== bInfo.luma) {
        return aInfo.luma - bInfo.luma;
      }

      // 第三优先：同样深度时，像素更多的主勾线优先。
      if (aInfo.pixelCount !== bInfo.pixelCount) {
        return bInfo.pixelCount - aInfo.pixelCount;
      }

      // 第四优先：综合线稿分数。
      if (aInfo.lineScore !== bInfo.lineScore) {
        return bInfo.lineScore - aInfo.lineScore;
      }

      return a.colorIndex - b.colorIndex;
    }

    // 非线稿色保持原色号顺序，避免填充/阴影层次乱跳。
    return a.colorIndex - b.colorIndex;
  });
}

function paletteColourPriorityInfo(hex: string, pixelCount: number): {
  isLineLike: boolean;
  lineScore: number;
  luma: number;
  pixelCount: number;
} {
  const rgb = parsePaletteHexLite(hex);
  const luma = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114;
  const chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);

  const isLineLike =
    luma <= 58 ||
    (luma <= 82 && chroma <= 32) ||
    (luma <= 74 && chroma > 32);

  // 像素数量权重要高：最深但只有几个像素的小装饰，不应排在主勾线前。
  const countScore = Math.sqrt(Math.max(0, pixelCount)) * 18;
  const darknessScore = Math.max(0, 105 - luma) * 2.8;
  const lowChromaLineBonus = chroma <= 28 && luma <= 90 ? 35 : 0;
  const darkColourLineBonus = chroma > 28 && luma <= 74 ? 18 : 0;

  const lineScore =
    (isLineLike ? 1000 : 0) +
    countScore +
    darknessScore +
    lowChromaLineBonus +
    darkColourLineBonus -
    Math.max(0, chroma - 60) * 0.4;

  return {
    isLineLike,
    lineScore,
    luma,
    pixelCount,
  };
}

function lineLikePalettePriority(hex: string): number {
  const rgb = parsePaletteHexLite(hex);
  const luma = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114;
  const chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);

  let score = 0;

  // 最重要：黑色 / 深灰线稿。
  if (luma <= 42) {
    score += 100;
  } else if (luma <= 62) {
    score += 72;
  } else if (luma <= 85 && chroma <= 28) {
    score += 45;
  }

  // 低饱和深色通常是轮廓、五官、阴影线。
  if (chroma <= 22 && luma <= 95) {
    score += 24;
  }

  // 有色深线，例如深棕、深蓝、深红，也应靠前。
  if (chroma > 22 && luma <= 72) {
    score += 18;
  }

  return score;
}

function parsePaletteHexLite(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.trim().replace(/^#/, "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized.padEnd(6, "0").slice(0, 6);

  return {
    r: Number.parseInt(value.slice(0, 2), 16) || 0,
    g: Number.parseInt(value.slice(2, 4), 16) || 0,
    b: Number.parseInt(value.slice(4, 6), 16) || 0,
  };
}


function getUsedPaletteColors(pixelMap: PixelMap): Array<{ colorIndex: number; colorHex: string; pixelCount: number }> {
  const colorByIndex = new Map<number, { colorHex: string; pixelCount: number }>();

  for (const row of pixelMap) {
    for (const pixel of row) {
      if (pixel.alpha <= 0 || pixel.colorIndex < 0) {
        continue;
      }

      const existing = colorByIndex.get(pixel.colorIndex);
      if (existing) {
        existing.pixelCount += 1;
      } else {
        colorByIndex.set(pixel.colorIndex, {
          colorHex: pixel.colorHex,
          pixelCount: 1,
        });
      }
    }
  }

  return [...colorByIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([colorIndex, info]) => ({
      colorIndex,
      colorHex: info.colorHex,
      pixelCount: info.pixelCount,
    }));
}

function canExtendRun(run: Pixel[], pixel: Pixel): boolean {
  const previous = run[run.length - 1];

  if (!previous) {
    return true;
  }

  if (run.length === 1) {
    return (
      (previous.y === pixel.y && Math.abs(previous.x - pixel.x) === 1) ||
      (previous.x === pixel.x && Math.abs(previous.y - pixel.y) === 1)
    );
  }

  const prevPrev = run[run.length - 2];
  if (!prevPrev) {
    return (
      previous.y === pixel.y && Math.abs(previous.x - pixel.x) === 1
    );
  }

  const isHorizontal = prevPrev.y === previous.y;

  if (isHorizontal) {
    return previous.y === pixel.y && Math.abs(previous.x - pixel.x) === 1;
  }

  return previous.x === pixel.x && Math.abs(previous.y - pixel.y) === 1;
}

function appendPixelRun(
  commands: DrawCommand[],
  run: Pixel[],
  current: { x: number; y: number },
  profile: DrawingProfile,
  grid: BrushGrid,
): { x: number; y: number } {
  const firstPixel = run[0];
  const lastPixel = run[run.length - 1];

  if (!firstPixel || !lastPixel) {
    return current;
  }

  commands.push(...moveTo(current, firstPixel, grid));

  if (run.length === 1) {
    commands.push(drawCommand(profile.drawButton));
  } else {
    const firstPosition = toCanvasPosition(firstPixel, grid);
    const lastPosition = toCanvasPosition(lastPixel, grid);
    commands.push(lineCommand(lastPosition.x - firstPosition.x, lastPosition.y - firstPosition.y));
  }

  return toCanvasPosition(lastPixel, grid);
}

function appendOrderedPixels(
  commands: DrawCommand[],
  orderedPixels: Pixel[],
  current: { x: number; y: number },
  profile: DrawingProfile,
  grid: BrushGrid,
): { x: number; y: number } {
  let currentPosition = current;
  let run: Pixel[] = [];

  for (const pixel of orderedPixels) {
    if (canExtendRun(run, pixel)) {
      run.push(pixel);
      continue;
    }

    currentPosition = appendPixelRun(commands, run, currentPosition, profile, grid);
    run = [pixel];
  }

  return appendPixelRun(commands, run, currentPosition, profile, grid);
}

export function generateScanlineCommands(
  pixelMap: PixelMap,
  profile: DrawingProfile,
  pathStrategy: PathStrategy = "scanline",
): DrawCommand[] {
  const commands: DrawCommand[] = [];
  const grid = createBrushGrid(profile);
  let current = { x: 0, y: 0 };

  commands.push(
    inputConfigCommand(
      DEFAULT_SAFE_INPUT_TIMING.buttonPressMs,
      DEFAULT_SAFE_INPUT_TIMING.inputDelayMs,
      DEFAULT_SAFE_INPUT_TIMING.homeMs,
    ),
  );

  if (shouldStartFromCanvasCenter(profile)) {
    current = {
      x: Math.floor(profile.canvasWidth / 2),
      y: Math.floor(profile.canvasHeight / 2),
    };
  } else {
    const startOffset = resolveStartOffset(profile);
    if (startOffset) {
      commands.push(moveCommand(startOffset.dx, startOffset.dy));
    } else {
      commands.push(homeCommand());
    }
  }

  // Pre-group pixels by color to avoid repeated full-map scans
  const pixelsByColor = groupPixelsByColor(pixelMap);

  if (profile.colorMode === "mono") {
    const usedColorIndexes = [profile.startColorIndex];
    let selectedColor: number | null = profile.startColorIndex;

    for (const colorIndex of usedColorIndexes) {
      if (selectedColor !== colorIndex) {
        commands.push(colorCommand(colorIndex));
        selectedColor = colorIndex;
      }

      const orderedPixels = getOrderedPixelsForColor(pixelsByColor, colorIndex, current, profile, grid, pathStrategy);
      current = appendOrderedPixels(commands, orderedPixels, current, profile, grid);
    }
  } else if (profile.colorMode === "palette") {
    const usedColors = prioritiseLineLikePaletteColours(getUsedPaletteColors(pixelMap));

    for (let batchStart = 0; batchStart < usedColors.length; batchStart += PALETTE_SLOT_COUNT) {
      const batch = usedColors.slice(batchStart, batchStart + PALETTE_SLOT_COUNT);
      let selectedSlot: number | null = null;

      batch.forEach((color, slotIndex) => {
        commands.push(paletteConfigCommand(slotIndex, color.colorHex));
      });

      for (const [slotIndex, color] of batch.entries()) {
        if (selectedSlot !== slotIndex) {
          commands.push(colorCommand(slotIndex));
          selectedSlot = slotIndex;
        }

        const orderedPixels = getOrderedPixelsForColor(pixelsByColor, color.colorIndex, current, profile, grid, pathStrategy);
        current = appendOrderedPixels(commands, orderedPixels, current, profile, grid);
      }
    }
  } else {
    const usedColors = getUsedPaletteColors(pixelMap);
    let didResetOfficialPaletteState = false;

    for (let batchStart = 0; batchStart < usedColors.length; batchStart += PALETTE_SLOT_COUNT) {
      const batch = usedColors.slice(batchStart, batchStart + PALETTE_SLOT_COUNT);
      let selectedSlot: number | null = null;

      if (!didResetOfficialPaletteState) {
        commands.push(basicPaletteResetCommand());
        didResetOfficialPaletteState = true;
      }

      batch.forEach((color, slotIndex) => {
        const cell = officialPaletteCellFromIndex(color.colorIndex);
        commands.push(basicPaletteConfigCommand(slotIndex, cell.row, cell.col));
      });

      for (const [slotIndex, color] of batch.entries()) {
        if (selectedSlot !== slotIndex) {
          commands.push(colorCommand(slotIndex));
          selectedSlot = slotIndex;
        }

        const orderedPixels = getOrderedPixelsForColor(pixelsByColor, color.colorIndex, current, profile, grid, pathStrategy);
        current = appendOrderedPixels(commands, orderedPixels, current, profile, grid);
      }
    }
  }

  commands.push(endCommand());
  return commands;
}

export function estimateRuntimeMs(commands: DrawCommand[], profile: DrawingProfile): number {
  let timing = {
    buttonPressMs: profile.buttonPressDuration,
    inputDelayMs: profile.inputDelay,
    homeMs: profile.homeDuration,
  };

  return commands.reduce((total, command) => {
    switch (command.type) {
      case "inputConfig":
        timing = {
          buttonPressMs: command.buttonPressMs,
          inputDelayMs: command.inputDelayMs,
          homeMs: command.homeMs,
        };
        return total;
      case "home":
        return total + timing.homeMs * 2 + timing.inputDelayMs;
      case "move":
        return (
          total +
          (Math.abs(command.dx) + Math.abs(command.dy)) *
            (timing.buttonPressMs + timing.inputDelayMs)
        );
      case "line":
        return (
          total +
          (Math.abs(command.dx) + Math.abs(command.dy) + 1) *
            (timing.buttonPressMs + timing.inputDelayMs)
        );
      case "draw":
      case "press":
        return total + timing.buttonPressMs + timing.inputDelayMs;
      case "color":
        return total + profile.colorChangeDuration;
      case "paletteConfig":
        return total + profile.colorChangeDuration * 6;
      case "basicPaletteConfig":
        return total + profile.colorChangeDuration * 4;
      case "basicPaletteReset":
        return total + timing.inputDelayMs;
      case "wait":
        return total + command.ms;
      case "pause":
      case "resume":
      case "end":
        return total + timing.inputDelayMs;
      default:
        return total;
    }
  }, 0);
}
