// 注意：顶部千万不要引入 "serialport" 和 "node:fs"！

export interface SerialPortInfo {
  path: string;
  label: string;
}

// 保持接口兼容，原样返回咱们的 IP 地址
export function preferSerialPath(path: string): string {
  return path.trim();
}

// 伪装的局域网端口扫描器，直接塞入你的 ESP32-S3 IP
export async function listPortInfos(): Promise<SerialPortInfo[]> {
  return [
    {
      path: "10.201.19.247",
      label: "10.201.19.247 | ESP32-S3 Wi-Fi 节点"
    }
  ];
}

// 补上刚才漏掉的 listPorts 函数，满足 UI 端的调用逻辑
export async function listPorts(): Promise<string[]> {
  const ports = await listPortInfos();
  return ports.map((port) => port.label);
}
