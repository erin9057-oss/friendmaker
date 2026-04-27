import { once } from "node:events";

import { ReadlineParser } from "@serialport/parser-readline";
import { SerialPort } from "serialport";

import { preferSerialPath } from "./listPorts.js";
import type { ProgressUpdate, SenderControls } from "../types.js";

const DEVICE_LINE_PREFIXES = ["INFO ", "WARN ", "ERR ", "BOOT ", "rst:"] as const;

async function waitForOpen(port: SerialPort): Promise<void> {
  if (port.isOpen) {
    return;
  }

  await once(port, "open");
}

function isRecognizedDeviceLine(line: string): boolean {
  if (line === "OK" || line.startsWith("ERR")) {
    return true;
  }

  return DEVICE_LINE_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function sanitizeDeviceLine(rawLine: string | Buffer): string | null {
  const rawText = Buffer.isBuffer(rawLine) ? rawLine.toString("utf8") : rawLine;
  const cleanText = rawText
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/\r/g, "")
    .trim();

  if (cleanText.length === 0) {
    return null;
  }

  if (isRecognizedDeviceLine(cleanText)) {
    return cleanText;
  }

  const candidateIndexes = DEVICE_LINE_PREFIXES.map((prefix) => cleanText.lastIndexOf(prefix))
    .filter((index) => index >= 0);

  if (candidateIndexes.length === 0) {
    return null;
  }

  const candidate = cleanText.slice(Math.max(...candidateIndexes)).trim();
  return isRecognizedDeviceLine(candidate) ? candidate : null;
}

function waitForAck(
  parser: ReadlineParser,
  timeoutMs: number,
  onDeviceLine?: (line: string) => void,
): Promise<"OK"> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ACK after ${timeoutMs}ms.`));
    }, timeoutMs);

    const onData = (rawLine: string | Buffer) => {
      const line = sanitizeDeviceLine(rawLine);

      if (!line) {
        return;
      }

      if (line === "OK") {
        cleanup();
        resolve("OK");
        return;
      }

      if (line.startsWith("ERR")) {
        cleanup();
        reject(new Error(`Device returned ${line}`));
        return;
      }

      onDeviceLine?.(line);
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      parser.off("data", onData);
    };

    parser.on("data", onData);
  });
}

function getAckTimeoutForCommand(command: string, baseTimeoutMs: number): number {
  const trimmed = command.trim();

  if (trimmed === "H") {
    return Math.max(baseTimeoutMs, 6_000);
  }

  if (trimmed === "BT RESET") {
    return Math.max(baseTimeoutMs, 8_000);
  }

  if (trimmed.startsWith("M ")) {
    const match = /^M\s+(-?\d+)\s+(-?\d+)$/u.exec(trimmed);

    if (!match || match[1] === undefined || match[2] === undefined) {
      return baseTimeoutMs;
    }

    const dx = Number.parseInt(match[1], 10);
    const dy = Number.parseInt(match[2], 10);
    const steps = Math.abs(dx) + Math.abs(dy);

    // Each move step becomes one D-pad press on the ESP32 side. Give the board
    // enough room to finish long center-to-target moves before we expect `OK`.
    return Math.max(baseTimeoutMs, 1_500 + steps * 150);
  }

  if (trimmed === "BC RESET") {
    return Math.max(baseTimeoutMs, 4_000);
  }

  if (trimmed.startsWith("C ")) {
    // Palette slot switching walks through the in-game color menu before
    // returning to the canvas, so it needs substantially more time than a
    // simple button press.
    return Math.max(baseTimeoutMs, 7_000);
  }

  if (trimmed.startsWith("BC ")) {
    // Official/basic color configuration traverses multiple menu layers and a
    // wrapped 7x12 grid before returning to the canvas.
    return Math.max(baseTimeoutMs, 15_000);
  }

  if (trimmed.startsWith("PC ")) {
    return Math.max(baseTimeoutMs, 20_000);
  }

  return baseTimeoutMs;
}

function writeLine(port: SerialPort, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    port.write(`${line}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }

      port.drain((drainError) => {
        if (drainError) {
          reject(drainError);
          return;
        }

        resolve();
      });
    });
  });
}

export class SerialAckSender implements SenderControls {
  private paused = false;
  private stopped = false;

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    this.stopped = true;
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.stopped) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async send(
    commands: string[],
    options: {
      path: string;
      baudRate: number;
      ackTimeoutMs: number;
      retries: number;
      onProgress?: (progress: ProgressUpdate) => void;
      onDeviceLine?: (line: string) => void;
    },
  ): Promise<void> {
    const preferredPath = preferSerialPath(options.path);
    const port = new SerialPort({
      path: preferredPath,
      baudRate: options.baudRate,
      autoOpen: true,
    });

    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    try {
      await waitForOpen(port);

      for (const [index, command] of commands.entries()) {
        await this.waitWhilePaused();

        if (this.stopped) {
          break;
        }

        let attempt = 0;
        let sent = false;

        while (!sent) {
          try {
            await writeLine(port, command);
            await waitForAck(
              parser,
              getAckTimeoutForCommand(command, options.ackTimeoutMs),
              options.onDeviceLine,
            );
            sent = true;
          } catch (error) {
            if (attempt >= options.retries) {
              throw error;
            }

            const message = error instanceof Error ? error.message : String(error);
            options.onDeviceLine?.(
              `WARN retry command=${index + 1} attempt=${attempt + 1} reason=${message}`,
            );
            attempt += 1;
          }
        }

        options.onProgress?.({
          index: index + 1,
          total: commands.length,
          command,
        });
      }

      if (this.stopped) {
        await writeLine(port, "E");
      }
    } finally {
      if (port.isOpen) {
        await new Promise<void>((resolve, reject) => {
          port.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      }
    }
  }
}
