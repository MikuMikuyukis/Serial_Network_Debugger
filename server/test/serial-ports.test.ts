import { describe, expect, it } from "vitest";
import { darwinPtyDevicePaths } from "../src/core/serial-ports.js";

describe("serial port discovery", () => {
  it("识别 macOS socat 创建的 PTY 从设备", () => {
    expect(darwinPtyDevicePaths([
      "ttys003",
      "tty.TESTSPP",
      "ptys002",
      "ttys002",
      "ttys00A",
      "ttys0",
      "ttys-invalid",
    ])).toEqual([
      "/dev/ttys002",
      "/dev/ttys003",
      "/dev/ttys00A",
    ]);
  });
});
