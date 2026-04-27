import * as iq from "image-q";

import type { ColorMode, Pixel, PixelMap, RgbColor } from "../types.js";
import {
  colorDistanceSquared,
  compositeOnWhite,
  luminance,
  parseHexColor,
  rgbToHex,
} from "../utils/colors.js";

function buildMonoPixelMap(
  image: {
    width: number;
    height: number;
    channels: number;
    data: Buffer;
  },
  options: {
    monoThreshold: number;
    palette: string[];
  },
): PixelMap {
  const monoPalette = options.palette.slice(0, 2);
  const pixelMap: PixelMap = [];

  for (let y = 0; y < image.height; y += 1) {
    const row: Pixel[] = [];

    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * image.channels;
      const r = image.data[offset] ?? 0;
      const g = image.data[offset + 1] ?? 0;
      const b = image.data[offset + 2] ?? 0;
      const a = image.channels >= 4 ? (image.data[offset + 3] ?? 255) : 255;
      const rgb = compositeOnWhite(r, g, b, a);
      const colorIndex = luminance(rgb) < options.monoThreshold ? 0 : Math.min(1, monoPalette.length - 1);

      row.push({
        x,
        y,
        colorIndex,
        colorHex: monoPalette[colorIndex] ?? monoPalette[0] ?? "#000000",
      });
    }

    pixelMap.push(row);
  }

  return pixelMap;
}

function buildPalettePixelMap(
  image: {
    width: number;
    height: number;
    channels: number;
    data: Buffer;
  },
  options: {
    palette: string[];
  },
): PixelMap {
  const source = iq.utils.PointContainer.fromBuffer(image.data, image.width, image.height);
  const palette = iq.buildPaletteSync([source], {
    colors: Math.max(2, options.palette.length),
    paletteQuantization: "wuquant",
    colorDistanceFormula: "euclidean-bt709",
  });
  const reduced = iq.applyPaletteSync(source, palette, {
    colorDistanceFormula: "euclidean-bt709",
    imageQuantization: "nearest",
  });
  const palettePoints = palette.getPointContainer().getPointArray();
  const paletteHexes = palettePoints.map((point) =>
    rgbToHex({ r: point.r, g: point.g, b: point.b }),
  );
  const paletteIndexByHex = new Map<string, number>();

  paletteHexes.forEach((hex, index) => {
    if (!paletteIndexByHex.has(hex)) {
      paletteIndexByHex.set(hex, index);
    }
  });

  const reducedPixels = reduced.toUint8Array();
  const pixelMap: PixelMap = [];

  for (let y = 0; y < image.height; y += 1) {
    const row: Pixel[] = [];

    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const colorHex = rgbToHex({
        r: reducedPixels[offset] ?? 0,
        g: reducedPixels[offset + 1] ?? 0,
        b: reducedPixels[offset + 2] ?? 0,
      });
      const colorIndex = paletteIndexByHex.get(colorHex) ?? 0;

      row.push({
        x,
        y,
        colorIndex,
        colorHex,
      });
    }

    pixelMap.push(row);
  }

  return pixelMap;
}

function buildFixedPalettePixelMap(
  image: {
    width: number;
    height: number;
    channels: number;
    data: Buffer;
  },
  paletteEntries: Array<{
    colorHex: string;
    colorIndex: number;
    rgb: RgbColor;
  }>,
): PixelMap {
  const pixelMap: PixelMap = [];

  for (let y = 0; y < image.height; y += 1) {
    const row: Pixel[] = [];

    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * image.channels;
      const r = image.data[offset] ?? 0;
      const g = image.data[offset + 1] ?? 0;
      const b = image.data[offset + 2] ?? 0;
      const a = image.channels >= 4 ? (image.data[offset + 3] ?? 255) : 255;
      const rgb = compositeOnWhite(r, g, b, a);

      let nearestColor = paletteEntries[0];
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const color of paletteEntries) {
        const distance = colorDistanceSquared(rgb, color.rgb);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestColor = color;
        }
      }

      row.push({
        x,
        y,
        colorIndex: nearestColor?.colorIndex ?? 0,
        colorHex: nearestColor?.colorHex ?? "#000000",
      });
    }

    pixelMap.push(row);
  }

  return pixelMap;
}

function findNearestPaletteEntry(
  rgb: RgbColor,
  paletteEntries: Array<{
    colorHex: string;
    colorIndex: number;
    rgb: RgbColor;
  }>,
) {
  let nearestColor = paletteEntries[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const entry of paletteEntries) {
    const distance = colorDistanceSquared(rgb, entry.rgb);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestColor = entry;
    }
  }

  return nearestColor;
}

function buildOfficialPalettePixelMap(
  image: {
    width: number;
    height: number;
    channels: number;
    data: Buffer;
  },
  options: {
    palette: string[];
    colorCount: number;
  },
): PixelMap {
  const officialPaletteEntries = options.palette.map((colorHex, colorIndex) => ({
    colorHex,
    colorIndex,
    rgb: parseHexColor(colorHex),
  }));
  const source = iq.utils.PointContainer.fromBuffer(image.data, image.width, image.height);
  const adaptivePalette = iq.buildPaletteSync([source], {
    colors: Math.max(2, Math.min(options.colorCount, options.palette.length)),
    paletteQuantization: "wuquant",
    colorDistanceFormula: "euclidean-bt709",
  });
  const adaptivePalettePoints = adaptivePalette.getPointContainer().getPointArray();
  const selectedEntries: Array<{
    colorHex: string;
    colorIndex: number;
    rgb: RgbColor;
  }> = [];
  const seenOfficialIndexes = new Set<number>();

  for (const point of adaptivePalettePoints) {
    const nearestEntry = findNearestPaletteEntry(
      { r: point.r, g: point.g, b: point.b },
      officialPaletteEntries,
    );

    if (!nearestEntry || seenOfficialIndexes.has(nearestEntry.colorIndex)) {
      continue;
    }

    selectedEntries.push(nearestEntry);
    seenOfficialIndexes.add(nearestEntry.colorIndex);
  }

  if (selectedEntries.length === 0 && officialPaletteEntries[0]) {
    selectedEntries.push(officialPaletteEntries[0]);
  }

  return buildFixedPalettePixelMap(image, selectedEntries);
}

export function quantizePixels(
  image: {
    width: number;
    height: number;
    channels: number;
    data: Buffer;
  },
  options: {
    colorMode: ColorMode;
    colorCount: number;
    monoThreshold: number;
    palette: string[];
  },
): PixelMap {
  if (options.colorMode === "mono") {
    return buildMonoPixelMap(image, options);
  }

  if (options.colorMode === "official") {
    return buildOfficialPalettePixelMap(image, options);
  }

  return buildPalettePixelMap(image, options);
}
