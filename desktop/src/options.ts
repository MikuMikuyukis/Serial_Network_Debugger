import { join } from "node:path";

export interface DesktopOptions {
  instanceId: string;
  webHost: string;
  webPort: number;
  help: boolean;
}

export const DESKTOP_HELP = `Serial Network Debugger Desktop

用法：Serial Network Debugger [options]

  --instance <id>    独立实例 ID，默认 default
  --web-host <host>  Web 监听地址，默认 127.0.0.1
  --web-port <port>  Web 监听端口，0 表示自动分配，默认 0
  --help, -h         显示帮助

不同实例必须使用不同的 --instance；固定端口也必须互不冲突。
`;

export function parseDesktopOptions(arguments_: string[]): DesktopOptions {
  let instanceId = "default";
  let webHost = "127.0.0.1";
  let webPort = 0;
  let help = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument.startsWith("-psn_")) continue;

    const instanceValue = optionValue(argument, "--instance");
    if (instanceValue !== null) {
      instanceId = instanceValue || requireNextValue(arguments_, ++index, "--instance");
      continue;
    }
    const hostValue = optionValue(argument, "--web-host");
    if (hostValue !== null) {
      webHost = hostValue || requireNextValue(arguments_, ++index, "--web-host");
      continue;
    }
    const portValue = optionValue(argument, "--web-port");
    if (portValue !== null) {
      const rawPort = portValue || requireNextValue(arguments_, ++index, "--web-port");
      webPort = Number(rawPort);
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  if (!/^[A-Za-z0-9._-]{1,40}$/.test(instanceId) || instanceId === "." || instanceId === "..") {
    throw new Error("--instance 必须是 1 到 40 位字母、数字、点、下划线或连字符");
  }
  if (!webHost || webHost.length > 253 || /[\s/]/.test(webHost)) {
    throw new Error("--web-host 必须是有效的主机名或 IP 地址");
  }
  if (!Number.isInteger(webPort) || webPort < 0 || webPort > 65_535) {
    throw new Error("--web-port 必须是 0 到 65535 之间的整数");
  }
  return { instanceId, webHost, webPort, help };
}

export function desktopUserDataPath(defaultPath: string, instanceId: string): string {
  return instanceId === "default" ? defaultPath : join(defaultPath, "instances", instanceId);
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function optionValue(argument: string, name: string): string | null {
  if (argument === name) return "";
  return argument.startsWith(`${name}=`) ? argument.slice(name.length + 1) : null;
}

function requireNextValue(arguments_: string[], index: number, option: string): string {
  const value = arguments_[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} 需要一个值`);
  return value;
}
