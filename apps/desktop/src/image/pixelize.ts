import type { DrawingProfile, PixelizationResult } from "../types.js";
import type { ImageSource } from "./loadImage.js";
import { resizeImage } from "./resizeImage.js";
import { quantizePixels } from "./quantize.js";

export async function pixelizeImage(
  imageSource: ImageSource,
  profile: DrawingProfile,
): Promise<PixelizationResult> {
  const rawImage = await resizeImage(imageSource, {
    width: profile.canvasWidth,
    height: profile.canvasHeight,
    resizeMode: profile.resizeMode,
  });

  const pixelMap = quantizePixels(rawImage, {
    colorMode: profile.colorMode,
    colorCount: profile.colorCount,
    monoThreshold: profile.monoThreshold,
    palette: profile.palette,
  });

  const usedColorIndexes = Array.from(
    new Set(pixelMap.flatMap((row) => row.map((pixel) => pixel.colorIndex))),
  ).sort((a, b) => a - b);

  return {
    pixelMap,
    usedColorIndexes,
  };
}
