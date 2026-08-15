import { readdir } from "node:fs/promises";
import { SerialPort } from "serialport";

export interface SerialPortInfo {
  device: string;
  description: string | null;
  manufacturer: string | null;
  hwid: string | null;
}

export function darwinPtyDevicePaths(entries: string[]): string[] {
  return entries
    .filter((entry) => /^ttys[0-9a-f]{3,}$/i.test(entry))
    .sort((left, right) => (
      Number.parseInt(left.slice(4), 16) - Number.parseInt(right.slice(4), 16)
      || left.localeCompare(right)
    ))
    .map((entry) => `/dev/${entry}`);
}

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const [detectedPorts, virtualPaths] = await Promise.all([
    SerialPort.list(),
    listDarwinPtyPaths(),
  ]);
  const ports = new Map<string, SerialPortInfo>();

  for (const port of detectedPorts) {
    const extended = port as typeof port & { friendlyName?: string };
    ports.set(port.path, {
      device: port.path,
      description: extended.friendlyName ?? port.manufacturer ?? null,
      manufacturer: port.manufacturer ?? null,
      hwid: port.pnpId ?? null,
    });
  }

  for (const device of virtualPaths) {
    if (ports.has(device)) continue;
    ports.set(device, {
      device,
      description: "PTY 虚拟串口",
      manufacturer: null,
      hwid: null,
    });
  }

  return [...ports.values()]
    .sort((left, right) => left.device.localeCompare(right.device, undefined, { numeric: true }));
}

async function listDarwinPtyPaths(): Promise<string[]> {
  if (process.platform !== "darwin") return [];
  try {
    return darwinPtyDevicePaths(await readdir("/dev"));
  } catch {
    return [];
  }
}
