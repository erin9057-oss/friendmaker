import type { DrawingProfile, PixelizationResult } from "../types.js";
import type { ImageSource } from "./loadImage.js";
import { autoRemoveBackground } from "./removeBackground.js";
import { resizeImage } from "./resizeImage.js";
import { quantizePixels } from "./quantize.js";

export async function pixelizeImage(
  imageSource: ImageSource,
  profile: DrawingProfile,
  options?: {
    removeBackground?: boolean;
  },
): Promise<PixelizationResult> {
  const logicalWidth = Math.max(1, Math.ceil(profile.canvasWidth / profile.brushSize));
  const logicalHeight = Math.max(1, Math.ceil(profile.canvasHeight / profile.brushSize));

  const resizedImage = await resizeImage(imageSource, {
    width: logicalWidth,
    height: logicalHeight,
    resizeMode: profile.resizeMode,
  });
  const rawImage = options?.removeBackground ? autoRemoveBackground(resizedImage) : resizedImage;

  const pixelMap = quantizePixels(rawImage, {
    colorMode: profile.colorMode,
    colorCount: profile.colorCount,
    monoThreshold: profile.monoThreshold,
    palette: profile.palette,
  });

  const usedColorIndexes = Array.from(
    new Set(
      pixelMap.flatMap((row) =>
        row.filter((pixel) => pixel.alpha > 0).map((pixel) => pixel.colorIndex),
      ),
    ),
  ).sort((a, b) => a - b);

  return {
    pixelMap,
    usedColorIndexes,
  };
}
