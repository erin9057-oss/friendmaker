import type { DrawingProfile, Pixel, PixelMap } from "../types.js";
import {
  colorCommand,
  drawCommand,
  endCommand,
  homeCommand,
  moveCommand,
  paletteConfigCommand,
  type DrawCommand,
} from "../protocol/commands.js";

const PALETTE_SLOT_COUNT = 9;

function getPixelsByColor(pixelMap: PixelMap, colorIndex: number): Pixel[] {
  const rows = pixelMap.map((row) => row.filter((pixel) => pixel.colorIndex === colorIndex));

  return rows.flatMap((row, rowIndex) => {
    if (rowIndex % 2 === 0) {
      return row;
    }

    return [...row].reverse();
  });
}

function rotatePixelsToNearestStart(
  pixels: Pixel[],
  current: { x: number; y: number },
): Pixel[] {
  if (pixels.length <= 1) {
    return pixels;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  pixels.forEach((pixel, index) => {
    const distance = Math.abs(pixel.x - current.x) + Math.abs(pixel.y - current.y);

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

function moveTo(current: { x: number; y: number }, target: { x: number; y: number }): DrawCommand[] {
  const dx = target.x - current.x;
  const dy = target.y - current.y;

  if (dx === 0 && dy === 0) {
    return [];
  }

  return [moveCommand(dx, dy)];
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
  return (
    profile.startCursor === "center" &&
    profile.canvasWidth === 128 &&
    profile.canvasHeight === 128 &&
    profile.brushSize === 1
  );
}

function getUsedPaletteColors(pixelMap: PixelMap): Array<{ colorIndex: number; colorHex: string }> {
  const colorByIndex = new Map<number, string>();

  for (const row of pixelMap) {
    for (const pixel of row) {
      if (!colorByIndex.has(pixel.colorIndex)) {
        colorByIndex.set(pixel.colorIndex, pixel.colorHex);
      }
    }
  }

  return Array.from(colorByIndex.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([colorIndex, colorHex]) => ({ colorIndex, colorHex }));
}

export function generateScanlineCommands(
  pixelMap: PixelMap,
  profile: DrawingProfile,
): DrawCommand[] {
  const commands: DrawCommand[] = [];
  let current = { x: 0, y: 0 };

  if (shouldStartFromCanvasCenter(profile)) {
    // The in-game canvas opens with the cursor centered, so the 128x128 mono
    // workflow can start directly from the middle instead of re-homing first.
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

  if (profile.colorMode === "mono") {
    const usedColorIndexes = [profile.startColorIndex];
    let selectedColor: number | null = profile.startColorIndex;

    for (const colorIndex of usedColorIndexes) {
      if (selectedColor !== colorIndex) {
        commands.push(colorCommand(colorIndex));
        selectedColor = colorIndex;
      }

      const orderedPixels = shouldStartFromCanvasCenter(profile)
        ? rotatePixelsToNearestStart(getPixelsByColor(pixelMap, colorIndex), current)
        : getPixelsByColor(pixelMap, colorIndex);

      for (const pixel of orderedPixels) {
        commands.push(...moveTo(current, pixel));
        commands.push(drawCommand(profile.drawButton));
        current = { x: pixel.x, y: pixel.y };
      }
    }
  } else {
    const usedColors = getUsedPaletteColors(pixelMap);

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

        const orderedPixels = shouldStartFromCanvasCenter(profile)
          ? rotatePixelsToNearestStart(getPixelsByColor(pixelMap, color.colorIndex), current)
          : getPixelsByColor(pixelMap, color.colorIndex);

        for (const pixel of orderedPixels) {
          commands.push(...moveTo(current, pixel));
          commands.push(drawCommand(profile.drawButton));
          current = { x: pixel.x, y: pixel.y };
        }
      }
    }
  }

  commands.push(endCommand());
  return commands;
}

export function estimateRuntimeMs(commands: DrawCommand[], profile: DrawingProfile): number {
  return commands.reduce((total, command) => {
    switch (command.type) {
      case "home":
        return total + profile.homeDuration * 2 + profile.inputDelay;
      case "move":
        return (
          total +
          (Math.abs(command.dx) + Math.abs(command.dy)) *
            (profile.buttonPressDuration + profile.inputDelay)
        );
      case "draw":
      case "press":
        return total + profile.buttonPressDuration + profile.inputDelay;
      case "color":
        return total + profile.colorChangeDuration;
      case "paletteConfig":
        return total + profile.colorChangeDuration * 6;
      case "wait":
        return total + command.ms;
      case "pause":
      case "resume":
      case "end":
        return total + profile.inputDelay;
      default:
        return total;
    }
  }, 0);
}
