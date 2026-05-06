import net from "node:net";
import os from "node:os";

export interface SerialPortInfo {
  path: string;
  label: string;
}

const ESP_PORT = 8080;
const ESP_PROBE_COMMAND = "SEQ 1234abcd 1 I\n";
const DEFAULT_CANDIDATES = [
  "192.168.150.247",
  "10.201.19.247",
];

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

function getCandidateSubnets(): string[] {
  const subnets = new Set<string>();

  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal || !isUsableIpv4(info.address)) {
        continue;
      }

      const parts = info.address.split(".");
      if (parts.length !== 4) {
        continue;
      }

      subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}.`);
    }
  }

  return [...subnets];
}

function probeEsp(ip: string, timeoutMs = 320): Promise<boolean> {
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
  const candidates = new Set<string>(DEFAULT_CANDIDATES);
  const subnets = getCandidateSubnets();

  for (const subnet of subnets) {
    for (let host = 2; host <= 254; host += 1) {
      candidates.add(`${subnet}${host}`);
    }
  }

  const ips = [...candidates];
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
  const ports: SerialPortInfo[] = [];

  for (const ip of discoveredIps) {
    ports.push({
      path: ip,
      label: `${ip} | ESP32-S3 Wi-Fi 节点（自动发现）`,
    });
  }

  for (const ip of DEFAULT_CANDIDATES) {
    if (discoveredIps.includes(ip)) {
      continue;
    }

    ports.push({
      path: ip,
      label: `${ip} | ESP32-S3 Wi-Fi 节点（候选）`,
    });
  }

  return ports;
}

export async function listPorts(): Promise<string[]> {
  const ports = await listPortInfos();
  return ports.map((port) => port.path);
}
