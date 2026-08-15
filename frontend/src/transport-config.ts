import type { TransportSettings } from "./storage";
import type { TransportConfig } from "./types";

export function buildTransportConfig(source: TransportSettings): TransportConfig {
  if (source.mode === "serial") {
    if (!source.serial.port.trim()) throw new Error("请选择要打开的串口设备");
    return { ...source.serial, port: source.serial.port.trim() };
  }
  if (source.mode === "tcp_client") {
    if (!source.tcpClient.host.trim()) throw new Error("请填写 TCP 远端地址");
    return { ...source.tcpClient, host: source.tcpClient.host.trim() };
  }
  if (source.mode === "tcp_server") {
    if (!source.tcpServer.host.trim()) throw new Error("请填写 TCP 监听地址");
    return { ...source.tcpServer, host: source.tcpServer.host.trim() };
  }

  const remoteHost = source.udp.remote_host?.trim() || null;
  const remotePort = source.udp.remote_port || null;
  if ((remoteHost === null) !== (remotePort === null)) {
    throw new Error("UDP 远端地址和端口必须同时填写或同时留空");
  }
  return {
    ...source.udp,
    local_host: source.udp.local_host.trim(),
    remote_host: remoteHost,
    remote_port: remotePort,
  };
}

export function areTransportConfigsEqual(left: TransportConfig, right: TransportConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
