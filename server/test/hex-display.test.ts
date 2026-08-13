import { describe, expect, it } from "vitest";
import {
  compactHexDisplay,
  deleteAcrossHexDisplaySpace,
  formatHexDisplay,
  hexDisplayCaret,
  MAX_HEX_BUSINESS_LENGTH,
  MAX_HEX_DISPLAY_LENGTH,
} from "../../frontend/src/hex-display.js";

describe("HEX editor display", () => {
  it.each([
    ["123456AB", "12 34 56 AB"],
    ["1", "1"],
    ["123", "12 3"],
    ["12 34\n56 AB", "12 34 56 AB"],
  ])("按字节显示空格：%s", (value, expected) => {
    expect(formatHexDisplay(value)).toBe(expected);
  });

  it("显示空格不进入业务原值", () => {
    expect(compactHexDisplay("12 34 56 AB")).toBe("123456AB");
  });

  it("显示空格不减少或扩大 HEX 业务容量", () => {
    expect(MAX_HEX_DISPLAY_LENGTH).toBe(1_572_863);
    expect(compactHexDisplay("A".repeat(MAX_HEX_BUSINESS_LENGTH + 1))).toHaveLength(
      MAX_HEX_BUSINESS_LENGTH,
    );
  });

  it.each([
    [2, 2, 2],
    [3, 3, 4],
    [8, 8, 11],
    [4, 5, 6],
  ])("校正 HEX 显示光标：%d/%d", (rawOffset, rawLength, expected) => {
    expect(hexDisplayCaret(rawOffset, rawLength)).toBe(expected);
  });

  it("退格跨过显示空格时删除前一个 HEX 字符", () => {
    expect(deleteAcrossHexDisplaySpace("12 34", 3, "backward")).toEqual({
      value: "134",
      caret: 1,
    });
  });

  it("Delete 跨过显示空格时删除后一个 HEX 字符", () => {
    expect(deleteAcrossHexDisplaySpace("12 34", 2, "forward")).toEqual({
      value: "124",
      caret: 3,
    });
  });

  it("不在显示空格边界时交给浏览器正常编辑", () => {
    expect(deleteAcrossHexDisplaySpace("12 34", 1, "backward")).toBeNull();
  });
});
