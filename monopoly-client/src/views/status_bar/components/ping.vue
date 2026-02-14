<script setup lang='ts'>
import { useGameInfo, useNetStatus } from '@/store';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { computed } from 'vue';
const gameInfoStore = useGameInfo();
const netStatusStore = useNetStatus();
const pingTextColor = computed(() => {
  const ping = gameInfoStore.ping;
  let colorName = "success";
  if (ping > 50) {
    colorName = "error";
  } else if (ping > 30) {
    colorName = "warning";
  }
  if (netStatusStore.state === "reconnecting" || netStatusStore.state === "offline") {
    colorName = "error";
  }
  return colorName;
});

const statusText = computed(() => {
  if (netStatusStore.state === "reconnecting") {
    return netStatusStore.reconnectMax > 0
      ? `重连中 ${netStatusStore.reconnectAttempt}/${netStatusStore.reconnectMax}`
      : "重连中";
  }
  if (netStatusStore.state === "connecting") return "连接中";
  if (netStatusStore.state === "offline") return "已断开";
  if (netStatusStore.lastRestoredAt > 0) return "已恢复";
  if (gameInfoStore.ping >= 150) return "网络波动";
  return "已连接";
});

const statusTextColor = computed(() => {
  if (netStatusStore.state === "reconnecting" || netStatusStore.state === "offline") return "error";
  if (netStatusStore.state === "connecting") return "warning";
  if (netStatusStore.lastRestoredAt > 0) return "success";
  if (gameInfoStore.ping >= 150) return "warning";
  return "success";
});
</script>

<template>
  <div class="ping-container">
    <div class="ping-line" :style="{ color: `var(--color-text-${pingTextColor})` }">
      <FontAwesomeIcon icon="wifi" /> {{ gameInfoStore.ping }}ms
    </div>
    <div class="status-line" :style="{ color: `var(--color-text-${statusTextColor})` }">
      {{ statusText }}
    </div>
  </div>
</template>

<style lang='scss' scoped>
.ping-container {
  padding: .2rem;
  font-size: 1rem;
  user-select: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.1rem;
}

.ping-line {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.status-line {
  font-size: 0.78rem;
  opacity: 0.9;
}
</style>
