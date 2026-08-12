import dgram from "node:dgram";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EventBroker } from "../src/core/event-broker.js";
import { TcpClientTransport, TcpServerTransport } from "../src/transports/tcp.js";
import { UdpTransport } from "../src/transports/udp.js";
import { nextDataEvent, waitForSocketData } from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((operation) => operation()));
});

describe("network transports", () => {
  it("TCP Server 接收数据并广播至客户端", async () => {
    const broker = new EventBroker();
    const server = new TcpServerTransport(
      { mode: "tcp_server", host: "127.0.0.1", port: 0 },
      broker,
    );
    await server.start();
    cleanup.push(() => server.stop());
    const port = Number(server.snapshot().details.port);
    const client = net.createConnection(port, "127.0.0.1");
    cleanup.push(async () => client.destroy());
    await new Promise<void>((resolve) => client.once("connect", resolve));

    const receiving = nextDataEvent(broker, "rx");
    client.write("from-client");
    expect((await receiving).text).toBe("from-client");

    const clientData = waitForSocketData(client);
    const sending = nextDataEvent(broker, "tx");
    await server.send(Buffer.from("from-server"));
    expect((await clientData).toString()).toBe("from-server");
    expect((await sending).size).toBe(11);
  });

  it("TCP Client 使用真实流连接", async () => {
    const echoServer = net.createServer((socket) => {
      socket.once("data", (data) => socket.end(data.toString().toUpperCase()));
    });
    await new Promise<void>((resolve) => echoServer.listen(0, "127.0.0.1", resolve));
    cleanup.push(async () => new Promise<void>((resolve) => echoServer.close(() => resolve())));
    const address = echoServer.address();
    if (!address || typeof address === "string") throw new Error("未取得测试端口");
    const broker = new EventBroker();
    const client = new TcpClientTransport({
      mode: "tcp_client",
      host: "127.0.0.1",
      port: address.port,
      connect_timeout: 2,
    }, broker);
    await client.start();
    cleanup.push(() => client.stop());
    const receiving = nextDataEvent(broker, "rx");
    await client.send(Buffer.from("hello"));
    expect((await receiving).text).toBe("HELLO");
  });

  it("UDP 端点交换数据报并回复最近来源", async () => {
    const brokerB = new EventBroker();
    const endpointB = new UdpTransport({
      mode: "udp",
      local_host: "127.0.0.1",
      local_port: 0,
      remote_host: null,
      remote_port: null,
    }, brokerB);
    await endpointB.start();
    cleanup.push(() => endpointB.stop());
    const portB = Number(endpointB.snapshot().details.local_port);

    const brokerA = new EventBroker();
    const endpointA = new UdpTransport({
      mode: "udp",
      local_host: "127.0.0.1",
      local_port: 0,
      remote_host: "127.0.0.1",
      remote_port: portB,
    }, brokerA);
    await endpointA.start();
    cleanup.push(() => endpointA.stop());

    const receivedB = nextDataEvent(brokerB, "rx");
    await endpointA.send(Buffer.from("ping"));
    expect((await receivedB).text).toBe("ping");

    const receivedA = nextDataEvent(brokerA, "rx");
    await endpointB.send(Buffer.from("pong"));
    expect((await receivedA).text).toBe("pong");
  });

  it("UDP 标准库测试环境可使用本机回环", async () => {
    const socket = dgram.createSocket("udp4");
    await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
    expect(socket.address().port).toBeGreaterThan(0);
    socket.close();
  });
});
