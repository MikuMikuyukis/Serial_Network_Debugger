import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";

export const CUSTOM_CHECKSUM_MAX_INPUT_BYTES = 64 * 1_024;
const CUSTOM_CHECKSUM_MEMORY_LIMIT_BYTES = 16 * 1_024 * 1_024;
const CUSTOM_CHECKSUM_STACK_LIMIT_BYTES = 512 * 1_024;
const CUSTOM_CHECKSUM_TIMEOUT_MS = 100;

const quickJs = await getQuickJS();

export function executeCustomChecksumScript(script: string, input: Uint8Array): unknown {
  if (input.byteLength > CUSTOM_CHECKSUM_MAX_INPUT_BYTES) {
    throw new Error(`自定义 JS 校验输入不能超过 ${CUSTOM_CHECKSUM_MAX_INPUT_BYTES} 字节`);
  }

  // A fresh WASM runtime prevents scripts from reaching Node globals or retaining state between runs.
  const runtime = quickJs.newRuntime();
  runtime.setMemoryLimit(CUSTOM_CHECKSUM_MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(CUSTOM_CHECKSUM_STACK_LIMIT_BYTES);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + CUSTOM_CHECKSUM_TIMEOUT_MS));
  const context = runtime.newContext();

  try {
    const bytes = JSON.stringify(Array.from(input));
    const source = `"use strict";\n(() => {\n`
      + "Object.defineProperties(globalThis, { process: { value: undefined }, require: { value: undefined }, fetch: { value: undefined }, WebAssembly: { value: undefined }, SharedArrayBuffer: { value: undefined }, Atomics: { value: undefined } });\n"
      + `const bytes = Object.freeze(${bytes});\n`
      + `${script}\n})()`;
    const result = context.evalCode(source, "custom-checksum.js");
    if (result.error) {
      const error = context.dump(result.error);
      result.error.dispose();
      throw new Error(quickJsErrorMessage(error));
    }
    try {
      return context.dump(result.value);
    } finally {
      result.value.dispose();
    }
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

function quickJsErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}
