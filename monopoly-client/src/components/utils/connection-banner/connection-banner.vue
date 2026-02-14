<script setup lang="ts">
import { computed } from "vue";
import { useNetStatus } from "@/store";
import { useRoute } from "vue-router";

const netStore = useNetStatus();
const route = useRoute();

const canShow = computed(() => {
	const inSession = route.name === "room" || route.name === "game";
	if (!inSession) return false;
	return (
		netStore.state === "reconnecting" ||
		netStore.state === "connecting" ||
		netStore.state === "offline" ||
		netStore.lastRestoredAt > 0
	);
});

const bannerText = computed(() => {
	if (netStore.state === "reconnecting") {
		if (netStore.reconnectMax > 0) {
			return `网络中断，正在重连 (${netStore.reconnectAttempt}/${netStore.reconnectMax})`;
		}
		return "网络中断，正在重连...";
	}
	if (netStore.state === "connecting") return "正在连接房间...";
	if (netStore.state === "offline") return "连接已断开，请稍后重试";
	if (netStore.lastRestoredAt > 0) return "已恢复连接";
	return "";
});

const bannerType = computed(() => {
	if (netStore.state === "offline") return "error";
	if (netStore.state === "reconnecting") return "warning";
	if (netStore.state === "connecting") return "info";
	if (netStore.lastRestoredAt > 0) return "success";
	return "info";
});
</script>

<template>
	<Transition name="fade">
		<div v-if="canShow" class="connection-banner" :class="bannerType">
			<span>{{ bannerText }}</span>
		</div>
	</Transition>
</template>

<style scoped lang="scss">
.connection-banner {
	position: fixed;
	top: 0.8rem;
	left: 50%;
	transform: translateX(-50%);
	z-index: 10001;
	padding: 0.4rem 1rem;
	border-radius: 999px;
	font-size: 0.9rem;
	box-shadow: var(--box-shadow);
	border: 0.2rem solid rgba(255, 255, 255, 0.6);
	backdrop-filter: blur(0.2rem);
	pointer-events: none;
	color: #ffffff;
	background-color: rgba(0, 0, 0, 0.55);

	&.success {
		background-color: rgba(40, 150, 60, 0.75);
	}

	&.warning {
		background-color: rgba(230, 162, 60, 0.85);
	}

	&.error {
		background-color: rgba(245, 108, 108, 0.85);
	}
}

.fade-enter-active,
.fade-leave-active {
	transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}
</style>
