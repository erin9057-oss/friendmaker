import type { ImageSource } from "../image/loadImage.js";
import { pixelizeImage } from "../image/pixelize.js";
import { renderPreviewToBuffer } from "../image/renderPreview.js";
import { estimateRuntimeMs, generateScanlineCommands } from "../path/scanline.js";
import { serializeCommands } from "../protocol/serializer.js";
import type { DrawingProfile, PixelMap } from "../types.js";

export interface DrawPlan {
  commands: string[];
  pixelMap: PixelMap;
  usedColorIndexes: number[];
  paletteHexes: string[];
  totalPixels: number;
  estimatedRuntimeMs: number;
  previewPng: Buffer;
}

export async function generateDrawPlan(
  imageSource: ImageSource,
  profile: DrawingProfile,
  previewScale = 12,
): Promise<DrawPlan> {
  const { pixelMap, usedColorIndexes } = await pixelizeImage(imageSource, profile);
  const previewPng = await renderPreviewToBuffer(pixelMap, previewScale);
  const commands = generateScanlineCommands(pixelMap, profile);
  const paletteHexes = Array.from(
    pixelMap
      .flatMap((row) => row.map((pixel) => [pixel.colorIndex, pixel.colorHex] as const))
      .reduce((map, [colorIndex, colorHex]) => map.set(colorIndex, colorHex), new Map<number, string>())
      .entries(),
  )
    .sort((a, b) => a[0] - b[0])
    .map(([, colorHex]) => colorHex);

  return {
    commands: serializeCommands(commands),
    pixelMap,
    usedColorIndexes,
    paletteHexes,
    totalPixels: pixelMap.length * (pixelMap[0]?.length ?? 0),
    estimatedRuntimeMs: estimateRuntimeMs(commands, profile),
    previewPng,
  };
}
