import { describe, expect, it } from "vitest";
import {
  CUSTOM_CHECKSUM_MAX_INPUT_BYTES,
  executeCustomChecksumScript,
} from "../src/core/custom-checksum-sandbox.js";

describe("custom checksum QuickJS sandbox", () => {
  it("只暴露只读 bytes，不暴露 Node、网络或宿主对象", () => {
    const globals = executeCustomChecksumScript(
      "return [typeof process, typeof require, typeof fetch, typeof WebAssembly, typeof inputHex, globalThis.constructor.constructor('return typeof process')()].join(',');",
      Buffer.from([1, 2, 3]),
    );
    expect(globals).toBe("undefined,undefined,undefined,undefined,undefined,undefined");
    expect(() => executeCustomChecksumScript("bytes[0] = 9; return bytes[0];", Buffer.from([1])))
      .toThrow();
  });

  it("每次使用全新上下文，不在脚本之间保留全局状态", () => {
    expect(executeCustomChecksumScript("globalThis.leakedValue = 7; return leakedValue;", Buffer.alloc(0)))
      .toBe(7);
    expect(executeCustomChecksumScript("return typeof leakedValue;", Buffer.alloc(0)))
      .toBe("undefined");
  });

  it("中断死循环并限制内存、栈和输入大小", () => {
    expect(() => executeCustomChecksumScript("while (true) {}", Buffer.alloc(0)))
      .toThrow("interrupted");
    expect(() => executeCustomChecksumScript("return new ArrayBuffer(100 * 1024 * 1024);", Buffer.alloc(0)))
      .toThrow("out of memory");
    expect(() => executeCustomChecksumScript("function recurse() { return recurse(); } return recurse();", Buffer.alloc(0)))
      .toThrow();
    expect(executeCustomChecksumScript("return bytes.length;", Buffer.alloc(CUSTOM_CHECKSUM_MAX_INPUT_BYTES)))
      .toBe(CUSTOM_CHECKSUM_MAX_INPUT_BYTES);
    expect(() => executeCustomChecksumScript("return 0;", Buffer.alloc(CUSTOM_CHECKSUM_MAX_INPUT_BYTES + 1)))
      .toThrow("不能超过");
  });
});
