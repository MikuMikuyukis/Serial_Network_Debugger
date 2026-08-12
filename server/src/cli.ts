import { createApp } from "./http/app.js";

interface CliOptions {
  host: string;
  port: number;
}

function parseArguments(arguments_: string[]): CliOptions {
  let host = "127.0.0.1";
  let port = 8_765;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--host") {
      host = arguments_[++index] ?? "";
      if (!host) throw new Error("--host 需要一个地址");
    } else if (argument === "--port") {
      port = Number(arguments_[++index]);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("--port 必须是 1 到 65535 之间的整数");
      }
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        "Serial Network Debugger\n\n" +
        "用法: npm start -- [--host 127.0.0.1] [--port 8765]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  return { host, port };
}

const options = parseArguments(process.argv.slice(2));
const app = await createApp({ logger: true });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "正在关闭服务");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  const address = await app.listen(options);
  app.log.info(`Serial Network Debugger 已启动：${address}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
