<script setup lang="ts">
import { useRoomInfo, useUtil } from "@/store/index";
import { computed } from "vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

const roomInfoStore = useRoomInfo();
const utilStore = useUtil();

const _roundTotalTime = roomInfoStore.gameSetting.roundTime;
const _waitingFor = computed(() => utilStore.waitingFor);
const _timeOut = computed(() => utilStore.timeOut);
const _isUrgent = computed(() => !_timeOut.value && _waitingFor.value.remainingTime > 0 && _waitingFor.value.remainingTime <= 5);

const _blockWidth = computed(() => `${(_waitingFor.value.remainingTime / _roundTotalTime) * 100}%`);
</script>

<template>
	<div class="countdown-timer" :class="{ urgent: _isUrgent }">
		<div class="block" :style="{ width: _blockWidth }"></div>
		<div class="text" v-if="!_timeOut">
			<FontAwesomeIcon icon="clock" /><span
				>{{ _waitingFor.eventMsg }}: {{ _waitingFor.remainingTime }} 秒</span
			>
		</div>
		<div class="text" v-else><FontAwesomeIcon icon="clock-rotate-left" /><span>等待下一步</span></div>
	</div>
</template>

<style lang="scss" scoped>
.countdown-timer {
	width: max-content;
	display: flex;
	justify-content: space-around;
	align-items: center;
	font-size: 1.4rem;
	background-color: var(--color-third);
	padding: 1.2rem;
	border-radius: 1rem;
	border: 0.4rem solid rgba(255, 255, 255, 0.5);
	box-sizing: border-box;
	box-shadow: var(--box-shadow);
	overflow: hidden;
	transition: width 0.3s ease-in-out;

	position: relative;
	z-index: 100000;

	& > .block {
		position: absolute;
		left: 0;
		top: 0;
		height: 100%;
		z-index: 1;
		background-color: var(--color-second);
		transition: width 0.3s ease-in-out;
	}

	& > .text {
		color: var(--color-text-white);
		white-space: nowrap;
		z-index: 2;
		line-height: 1.2;
		letter-spacing: 0.01em;

		& > * {
			margin: 0 0.4rem;
		}
	}

	&.urgent {
		box-shadow: 0 0 1rem rgba(245, 108, 108, 0.8);
		animation: urgent-pulse 0.9s ease-in-out infinite;
		border-color: rgba(255, 255, 255, 0.8);

		& > .block {
			background-color: var(--color-text-error);
		}
	}
}

@keyframes urgent-pulse {
	0% {
		transform: scale(1);
	}
	50% {
		transform: scale(1.02);
	}
	100% {
		transform: scale(1);
	}
}
</style>
