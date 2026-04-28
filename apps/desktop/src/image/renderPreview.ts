import sharp from "sharp";

import type { DrawingProfile, PixelMap } from "../types.js";
import { ensureParentDirectory } from "../utils/fs.js";
import { parseHexColor } from "../utils/colors.js";

function buildPreviewBuffer(pixelMap: PixelMap, profile: DrawingProfile): Buffer {
  const height = profile.canvasHeight;
  const width = profile.canvasWidth;

  if (width === 0 || height === 0) {
    throw new Error("Cannot render preview for an empty pixel map.");
  }

  const buffer = Buffer.alloc(width * height * 4);
  const brushSize = Math.max(1, profile.brushSize);

  for (const row of pixelMap) {
    for (const pixel of row) {
      if (pixel.alpha <= 0 || pixel.colorIndex < 0) {
        continue;
      }

      const color = parseHexColor(pixel.colorHex);
      const originX = pixel.x * brushSize;
      const originY = pixel.y * brushSize;

      for (let dy = 0; dy < brushSize; dy += 1) {
        const canvasY = originY + dy;

        if (canvasY >= height) {
          break;
        }

        for (let dx = 0; dx < brushSize; dx += 1) {
          const canvasX = originX + dx;

          if (canvasX >= width) {
            break;
          }

          const offset = (canvasY * width + canvasX) * 4;
          buffer[offset] = color.r;
          buffer[offset + 1] = color.g;
          buffer[offset + 2] = color.b;
          buffer[offset + 3] = pixel.alpha;
        }
      }
    }
  }

  return buffer;
}

export async function renderPreviewToBuffer(
  pixelMap: PixelMap,
  profile: DrawingProfile,
  scale = 12,
): Promise<Buffer> {
  const height = profile.canvasHeight;
  const width = profile.canvasWidth;
  const buffer = buildPreviewBuffer(pixelMap, profile);

  return sharp(buffer, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .resize(width * scale, height * scale, {
      kernel: sharp.kernel.nearest,
      fit: "fill",
    })
    .png()
    .toBuffer();
}

export async function renderPreview(
  pixelMap: PixelMap,
  profile: DrawingProfile,
  outputPath: string,
  scale = 12,
): Promise<void> {
  await ensureParentDirectory(outputPath);

  const previewBuffer = await renderPreviewToBuffer(pixelMap, profile, scale);
  await sharp(previewBuffer).toFile(outputPath);
}
