export const MAX_HEX_BUSINESS_LENGTH = 1_048_576;
export const MAX_HEX_DISPLAY_LENGTH = MAX_HEX_BUSINESS_LENGTH
  + Math.floor((MAX_HEX_BUSINESS_LENGTH - 1) / 2);

export function compactHexDisplay(value: string): string {
  return value.replaceAll(/\s/g, "").slice(0, MAX_HEX_BUSINESS_LENGTH);
}

export function formatHexDisplay(value: string): string {
  return compactHexDisplay(value).replaceAll(/(..)(?=.)/g, "$1 ");
}

export function hexDisplayCaret(rawOffset: number, rawLength: number): number {
  const boundedOffset = Math.min(Math.max(rawOffset, 0), rawLength);
  const spacesBeforeCaret = Math.min(
    Math.floor(boundedOffset / 2),
    Math.floor(Math.max(rawLength - 1, 0) / 2),
  );
  return boundedOffset + spacesBeforeCaret;
}

export function deleteAcrossHexDisplaySpace(
  displayValue: string,
  caret: number,
  direction: "backward" | "forward",
): { value: string; caret: number } | null {
  const adjacentIndex = direction === "backward" ? caret - 1 : caret;
  if (displayValue[adjacentIndex] !== " ") return null;

  const value = compactHexDisplay(displayValue);
  const rawCaret = compactHexDisplay(displayValue.slice(0, caret)).length;
  const deleteIndex = direction === "backward" ? rawCaret - 1 : rawCaret;
  if (deleteIndex < 0 || deleteIndex >= value.length) return null;

  const nextValue = value.slice(0, deleteIndex) + value.slice(deleteIndex + 1);
  const nextRawCaret = direction === "backward" ? deleteIndex : rawCaret;
  return {
    value: nextValue,
    caret: hexDisplayCaret(nextRawCaret, nextValue.length),
  };
}
