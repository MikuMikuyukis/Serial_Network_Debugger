<script setup lang="ts">
import { computed, ref } from "vue";
import { Copy, FolderCog, Plus, Trash2, X } from "@lucide/vue";
import {
  copyConfigurationProfileData,
  loadConfigurationProfiles,
  MAX_CONFIGURATION_PROFILES,
  removeConfigurationProfileData,
  saveActiveProfileId,
  saveConfigurationProfiles,
  type ConfigurationProfile,
} from "../storage";

const props = defineProps<{
  activeProfileId: string;
  locked: boolean;
}>();

const emit = defineEmits<{
  select: [profileId: string];
  prepare: [];
  error: [message: string];
}>();

const profiles = ref<ConfigurationProfile[]>(loadConfigurationProfiles());
const profileNames = ref<Record<string, string>>(Object.fromEntries(profiles.value.map((profile) => [profile.id, profile.name])));
const dialogOpen = ref(false);
const activeProfile = computed(() => profiles.value.find((profile) => profile.id === props.activeProfileId) ?? profiles.value[0]!);

function selectProfile(profileId: string): void {
  if (profileId === props.activeProfileId || props.locked) return;
  try {
    saveActiveProfileId(profileId);
    emit("select", profileId);
  } catch {
    emit("error", "配置切换保存失败，请检查浏览器本地存储空间");
  }
}

function addProfile(): void {
  if (profiles.value.length >= MAX_CONFIGURATION_PROFILES) {
    emit("error", `全局配置最多保存 ${MAX_CONFIGURATION_PROFILES} 组`);
    return;
  }
  const now = new Date().toISOString();
  const profile: ConfigurationProfile = {
    id: createProfileId(),
    name: uniqueProfileName("新配置"),
    created_at: now,
    updated_at: now,
  };
  const nextProfiles = [...profiles.value, profile];
  if (!persistProfiles(nextProfiles)) return;
  profiles.value = nextProfiles;
  profileNames.value = { ...profileNames.value, [profile.id]: profile.name };
  selectProfile(profile.id);
}

function duplicateProfile(profile: ConfigurationProfile): void {
  if (profiles.value.length >= MAX_CONFIGURATION_PROFILES) {
    emit("error", `全局配置最多保存 ${MAX_CONFIGURATION_PROFILES} 组`);
    return;
  }
  const now = new Date().toISOString();
  const duplicate: ConfigurationProfile = {
    id: createProfileId(),
    name: uniqueProfileName(`${profile.name} 副本`),
    created_at: now,
    updated_at: now,
  };
  try {
    emit("prepare");
    copyConfigurationProfileData(profile.id, duplicate.id);
    const nextProfiles = [...profiles.value, duplicate];
    saveConfigurationProfiles(nextProfiles);
    profiles.value = nextProfiles;
    profileNames.value = { ...profileNames.value, [duplicate.id]: duplicate.name };
  } catch {
    removeConfigurationProfileData(duplicate.id);
    emit("error", "配置复制失败，请检查浏览器本地存储空间");
  }
}

function persistPendingState(): boolean {
  try {
    const now = new Date().toISOString();
    const nextProfiles = profiles.value.map((profile) => {
      const name = (profileNames.value[profile.id] ?? profile.name).trim().slice(0, 40);
      if (!name) throw new Error("配置名称不能为空");
      return name === profile.name ? profile : { ...profile, name, updated_at: now };
    });
    saveConfigurationProfiles(nextProfiles);
    profiles.value = nextProfiles;
    profileNames.value = Object.fromEntries(nextProfiles.map((profile) => [profile.id, profile.name]));
    return true;
  } catch (error) {
    profileNames.value = Object.fromEntries(profiles.value.map((profile) => [profile.id, profile.name]));
    emit("error", error instanceof Error ? error.message : "配置列表保存失败，请检查浏览器本地存储空间");
    return false;
  }
}

defineExpose({ persistPendingState });

function removeProfile(profile: ConfigurationProfile): void {
  if (profile.id === props.activeProfileId || profiles.value.length <= 1) return;
  if (!window.confirm(`确定删除全局配置“${profile.name}”及其全部发送预设吗？`)) return;
  try {
    const nextProfiles = profiles.value.filter((item) => item.id !== profile.id);
    saveConfigurationProfiles(nextProfiles);
    profiles.value = nextProfiles;
    const nextNames = { ...profileNames.value };
    delete nextNames[profile.id];
    profileNames.value = nextNames;
    removeConfigurationProfileData(profile.id);
  } catch {
    emit("error", "配置删除失败，请检查浏览器本地存储空间");
  }
}

function persistProfiles(nextProfiles: ConfigurationProfile[]): boolean {
  try {
    saveConfigurationProfiles(nextProfiles);
    return true;
  } catch {
    emit("error", "配置列表保存失败，请检查浏览器本地存储空间");
    return false;
  }
}

function uniqueProfileName(base: string): string {
  const names = new Set(profiles.value.map((profile) => profile.name));
  if (!names.has(base)) return base.slice(0, 40);
  for (let index = 2; index <= MAX_CONFIGURATION_PROFILES + 1; index += 1) {
    const suffix = ` ${index}`;
    const name = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!names.has(name)) return name;
  }
  return `${base.slice(0, 32)} ${Date.now().toString().slice(-6)}`;
}

function createProfileId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
</script>

<template>
  <section class="profile-switcher" aria-label="全局配置">
    <span class="profile-label">配置</span>
    <select
      :value="activeProfile.id"
      :disabled="locked"
      title="切换全局配置"
      @change="selectProfile(($event.target as HTMLSelectElement).value)"
    >
      <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
    </select>
    <button class="profile-manage-button" type="button" title="管理全局配置" aria-label="管理全局配置" @click="dialogOpen = true">
      <FolderCog :size="17" />
    </button>
  </section>

  <Teleport to="body">
    <div v-if="dialogOpen" class="modal-backdrop" @mousedown.self="dialogOpen = false">
      <section class="settings-dialog profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
        <header class="dialog-header">
          <div>
            <span class="eyebrow">CONFIGURATION PROFILES</span>
            <h2 id="profile-dialog-title">全局配置</h2>
          </div>
          <button class="bar-icon-button" type="button" title="关闭" aria-label="关闭全局配置" @click="dialogOpen = false">
            <X :size="18" />
          </button>
        </header>

        <div class="dialog-body profile-list">
          <article v-for="profile in profiles" :key="profile.id" class="profile-list-item" :class="{ active: profile.id === activeProfileId }">
            <div class="profile-item-main">
              <input v-model="profileNames[profile.id]" maxlength="40" aria-label="配置名称" @change="persistPendingState" />
              <small>{{ profile.id === activeProfileId ? "当前配置" : "独立保存通信参数、发送区与发送预设" }}</small>
            </div>
            <button
              class="profile-use-button"
              type="button"
              :disabled="locked || profile.id === activeProfileId"
              @click="selectProfile(profile.id)"
            >
              {{ profile.id === activeProfileId ? "使用中" : "切换" }}
            </button>
            <button class="icon-button" type="button" title="复制配置" aria-label="复制配置" @click="duplicateProfile(profile)">
              <Copy :size="16" />
            </button>
            <button
              class="icon-button danger"
              type="button"
              title="删除配置"
              aria-label="删除配置"
              :disabled="profile.id === activeProfileId || profiles.length <= 1"
              @click="removeProfile(profile)"
            >
              <Trash2 :size="16" />
            </button>
          </article>
        </div>

        <footer class="dialog-footer profile-dialog-footer">
          <span v-if="locked">断开通信并停止周期发送后才能切换配置</span>
          <button class="dialog-button primary" type="button" :disabled="locked || profiles.length >= MAX_CONFIGURATION_PROFILES" @click="addProfile">
            <Plus :size="15" />新建空白配置
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
