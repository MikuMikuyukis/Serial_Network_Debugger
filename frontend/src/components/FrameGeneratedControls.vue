<script setup lang="ts">
import { computed } from "vue";
import type { HexFrameConfig, HexFrameDataField } from "../types";

const props = defineProps<{
  config?: HexFrameConfig;
  disabled?: boolean;
  compact?: boolean;
}>();

const emit = defineEmits<{
  update: [fieldId: string, value: string];
  commit: [fieldId: string, value: string];
}>();

const fields = computed(() => (props.config?.enabled ? props.config.fields.filter(
  (field): field is HexFrameDataField => field.kind === "data" && field.source === "generated" && Boolean(field.generator && field.generator.control !== "none"),
) : []));

function numericValue(field: HexFrameDataField): number {
  const value = Number(field.value);
  return Number.isFinite(value) ? value : 0;
}

function updateNumber(field: HexFrameDataField, event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  emit("update", field.id, value);
}

function commitNumber(field: HexFrameDataField, event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  emit("update", field.id, value);
  emit("commit", field.id, value);
}

function updateAndCommit(field: HexFrameDataField, value: string): void {
  emit("update", field.id, value);
  emit("commit", field.id, value);
}

function bitChecked(field: HexFrameDataField, bit: number): boolean {
  return (integerValue(field) & (1n << BigInt(bit))) !== 0n;
}

function toggleBit(field: HexFrameDataField, bit: number, checked: boolean): void {
  const mask = 1n << BigInt(bit);
  const value = checked ? integerValue(field) | mask : integerValue(field) & ~mask;
  updateAndCommit(field, value.toString());
}

function selectBit(field: HexFrameDataField, bit: number): void {
  updateAndCommit(field, (1n << BigInt(bit)).toString());
}

function byteEnabled(field: HexFrameDataField, byteIndex: number): boolean {
  const shift = byteShift(field, byteIndex);
  return ((integerValue(field) >> shift) & 0xffn) !== 0n;
}

function toggleByte(field: HexFrameDataField, byteIndex: number, checked: boolean): void {
  const shift = byteShift(field, byteIndex);
  const mask = 0xffn << shift;
  const value = checked ? integerValue(field) | mask : integerValue(field) & ~mask;
  updateAndCommit(field, value.toString());
}

function byteShift(field: HexFrameDataField, byteIndex: number): bigint {
  const length = field.byte_length ?? 1;
  const significance = field.byte_order === "big" ? length - byteIndex - 1 : byteIndex;
  return BigInt(significance * 8);
}

function integerValue(field: HexFrameDataField): bigint {
  try {
    return BigInt(field.value || "0");
  } catch {
    return 0n;
  }
}

function bitCount(field: HexFrameDataField): number {
  return (field.byte_length ?? 1) * 8;
}

function enumOptions(field: HexFrameDataField): Array<{ label: string; value: string }> {
  return (field.generator?.options ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.lastIndexOf("=");
      return separator < 0
        ? { label: item, value: item }
        : { label: item.slice(0, separator).trim(), value: item.slice(separator + 1).trim() };
    });
}
</script>

<template>
  <div v-if="fields.length" class="generated-controls" :class="{ compact }">
    <div v-for="field in fields" :key="field.id" class="generated-control">
      <div class="generated-control-heading">
        <strong>{{ field.generator?.control_name || field.name }}</strong>
        <code>{{ field.value }}</code>
      </div>

      <template v-if="field.generator?.control === 'uint_slider' || field.generator?.control === 'int_slider' || field.generator?.control === 'float32_slider' || field.generator?.control === 'float64_slider' || field.generator?.control === 'bcd_slider'">
        <div class="generated-slider-row">
          <input
            type="range"
            :min="field.generator.minimum"
            :max="field.generator.maximum"
            :step="field.generator.step"
            :value="numericValue(field)"
            :disabled="disabled"
            @input="updateNumber(field, $event)"
            @change="commitNumber(field, $event)"
          />
          <input
            class="generated-number-input"
            type="number"
            :min="field.generator.minimum"
            :max="field.generator.maximum"
            :step="field.generator.step"
            :value="numericValue(field)"
            :disabled="disabled"
            @input="updateNumber(field, $event)"
            @change="commitNumber(field, $event)"
          />
        </div>
      </template>

      <div v-else-if="field.generator?.control === 'bit_checkboxes'" class="generated-toggle-grid bits">
        <label v-for="bit in bitCount(field)" :key="bit"><input type="checkbox" :checked="bitChecked(field, bit - 1)" :disabled="disabled" @change="toggleBit(field, bit - 1, ($event.target as HTMLInputElement).checked)" /><span>B{{ bit - 1 }}</span></label>
      </div>

      <div v-else-if="field.generator?.control === 'bit_radio'" class="generated-toggle-grid bits">
        <label v-for="bit in bitCount(field)" :key="bit"><input type="radio" :name="`generated-${field.id}`" :checked="integerValue(field) === (1n << BigInt(bit - 1))" :disabled="disabled" @change="selectBit(field, bit - 1)" /><span>B{{ bit - 1 }}</span></label>
      </div>

      <div v-else-if="field.generator?.control === 'byte_switches'" class="generated-toggle-grid bytes">
        <label v-for="byte in (field.byte_length ?? 1)" :key="byte"><input type="checkbox" :checked="byteEnabled(field, byte - 1)" :disabled="disabled" @change="toggleByte(field, byte - 1, ($event.target as HTMLInputElement).checked)" /><span>Byte {{ byte }}</span></label>
      </div>

      <select v-else-if="field.generator?.control === 'enum'" :value="field.value" :disabled="disabled" @change="updateAndCommit(field, ($event.target as HTMLSelectElement).value)">
        <option v-for="option in enumOptions(field)" :key="`${option.label}-${option.value}`" :value="option.value">{{ option.label }}</option>
      </select>
    </div>
  </div>
</template>
