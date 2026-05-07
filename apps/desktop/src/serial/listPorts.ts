import net from "node:net";
import os from "node:os";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export interface SerialPortInfo {
  path: string;
  label: string;
}

const ESP_PORT = 8080;
const ESP_PROBE_COMMAND = "SEQ 1234abcd 1 I\n";

export function preferSerialPath(path: string): string {
  return path.trim();
}

function isUsableIpv4(address: string): boolean {
  return (
    /^\d+\.\d+\.\d+\.\d+$/u.test(address) &&
    !address.startsWith("127.") &&
    !address.startsWith("169.254.") &&
    !address.startsWith("100.") &&
    !address.startsWith("10.17.") &&
    !address.startsWith("100.110.")
  );
}

function subnetFromIpv4(address: string): string | null {
  if (!isUsableIpv4(address)) {
    return null;
  }

  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  return `${parts[0]}.${parts[1]}.${parts[2]}.`;
}

function getSubnetsFromNodeNetworkInterfaces(): string[] {
  const subnets = new Set<string>();

  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) {
        continue;
      }

      const subnet = subnetFromIpv4(info.address);
      if (subnet) {
        subnets.add(subnet);
      }
    }
  }

  return [...subnets];
}

async function getSubnetsFromIfconfig(): Promise<string[]> {
  try {
    const { stdout } = await execFile("ifconfig", [], { timeout: 3000 });
    const subnets = new Set<string>();
    const lines = stdout.split(/\r?\n/u);
    let currentInterface = "";

    for (const line of lines) {
      const interfaceMatch = /^([a-zA-Z0-9_.:-]+):\s/u.exec(line);
      if (interfaceMatch?.[1]) {
        currentInterface = interfaceMatch[1];
      }

      const inetMatch = /\binet\s+(?:addr:)?(\d+\.\d+\.\d+\.\d+)/u.exec(line);
      if (!inetMatch?.[1]) {
        continue;
      }

      const address = inetMatch[1];
      const subnet = subnetFromIpv4(address);

      if (!subnet) {
        continue;
      }

      // Android hotspot interfaces are commonly ap0 / swlan0 / softap0.
      // Prefer the current hotspot subnet, but keep any usable local /24 subnet
      // as fallback for devices that expose a different interface name.
      if (/^(ap\d*|swlan\d*|softap\d*|wlan1)$/u.test(currentInterface)) {
        return [subnet];
      }

      subnets.add(subnet);
    }

    return [...subnets];
  } catch {
    return [];
  }
}

async function getCandidateSubnets(): Promise<string[]> {
  const subnets = new Set<string>();

  for (const subnet of await getSubnetsFromIfconfig()) {
    subnets.add(subnet);
  }

  for (const subnet of getSubnetsFromNodeNetworkInterfaces()) {
    subnets.add(subnet);
  }

  return [...subnets];
}

function probeEsp(ip: string, timeoutMs = 450): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok: boolean) => {
      if (done) {
        return;
      }

      done = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      socket.write(ESP_PROBE_COMMAND);
    });

    socket.once("data", (chunk) => {
      const text = chunk.toString("utf8");
      finish(text.includes("OK 1234abcd 1") || text.includes("INFO transport="));
    });

    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    socket.connect(ESP_PORT, ip);
  });
}

async function discoverEspIps(): Promise<string[]> {
  const subnets = await getCandidateSubnets();
  const ips: string[] = [];

  for (const subnet of subnets) {
    for (let host = 2; host <= 254; host += 1) {
      ips.push(`${subnet}${host}`);
    }
  }

  const found: string[] = [];
  const concurrency = 96;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < ips.length) {
      const ip = ips[cursor];
      cursor += 1;

      if (!ip) {
        continue;
      }

      if (await probeEsp(ip)) {
        found.push(ip);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ips.length) }, () => worker()),
  );

  return [...new Set(found)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function listPortInfos(): Promise<SerialPortInfo[]> {
  const discoveredIps = await discoverEspIps();

  return discoveredIps.map((ip) => ({
    path: ip,
    label: `${ip} | ESP32-S3 Wi-Fi 节点（自动发现）`,
  }));
}

export async function listPorts(): Promise<string[]> {
  const ports = await listPortInfos();
  return ports.map((port) => port.path);
}
