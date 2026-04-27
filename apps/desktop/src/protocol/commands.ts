import type { ControllerButton } from "../types.js";

export type DrawCommand =
  | { type: "home" }
  | { type: "move"; dx: number; dy: number }
  | { type: "draw"; button: ControllerButton }
  | { type: "press"; button: ControllerButton }
  | { type: "color"; index: number }
  | { type: "paletteConfig"; slot: number; colorHex: string }
  | { type: "wait"; ms: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "end" };

export function homeCommand(): DrawCommand {
  return { type: "home" };
}

export function moveCommand(dx: number, dy: number): DrawCommand {
  return { type: "move", dx, dy };
}

export function drawCommand(button: ControllerButton): DrawCommand {
  return { type: "draw", button };
}

export function pressButtonCommand(button: ControllerButton): DrawCommand {
  return { type: "press", button };
}

export function colorCommand(index: number): DrawCommand {
  return { type: "color", index };
}

export function paletteConfigCommand(slot: number, colorHex: string): DrawCommand {
  return { type: "paletteConfig", slot, colorHex };
}

export function waitCommand(ms: number): DrawCommand {
  return { type: "wait", ms };
}

export function pauseCommand(): DrawCommand {
  return { type: "pause" };
}

export function resumeCommand(): DrawCommand {
  return { type: "resume" };
}

export function endCommand(): DrawCommand {
  return { type: "end" };
}
