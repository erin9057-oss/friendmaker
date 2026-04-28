import sharp from "sharp";

import type { RawImageData, ResizeMode } from "../types.js";
import { loadImage, type ImageSource } from "./loadImage.js";

export async function resizeImage(
  imageSource: ImageSource,
  options: {
    width: number;
    height: number;
    resizeMode: ResizeMode;
  },
): Promise<RawImageData> {
  const fit = options.resizeMode === "cover" ? "cover" : "contain";

  const { data, info } = await loadImage(imageSource)
    .resize(options.width, options.height, {
      fit,
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    data,
  };
}
