<script setup lang="ts">
import { computed } from "vue";
import { useGameInfo } from "@/store";

const gameInfoStore = useGameInfo();

const _currentRound = computed(() => gameInfoStore.currentRound);
const _currentMultiplier = computed(() => gameInfoStore.currentMultiplier);
const _currentPlayer = computed(() =>
	gameInfoStore.playersList.find((p) => p.id === gameInfoStore.currentPlayerIdInRound)
);
const _isMyTurn = computed(() => gameInfoStore.isMyTurn);
</script>

<template>
	<div class="round-info" :class="{ 'is-my-turn': _isMyTurn }">
		<span class="round">第{{ _currentRound }}回合</span>
		<span class="multiplier">当前倍率：{{ _currentMultiplier }}倍</span>
		<span class="turn">
			轮到：
			<b>{{ _currentPlayer?.user.username || "未知" }}</b>
			<em v-if="_isMyTurn">(你)</em>
		</span>
	</div>
</template>

<style scoped lang="scss">
.round-info {
	color: var(--color-text-white);
	background-color: var(--color-second);
	text-shadow: var(--text-shadow);
	display: flex;
	justify-content: space-around;
	align-items: center;
	padding: 0.4rem 1.2rem;
	border: 0.4rem solid rgba($color: #ffffff, $alpha: 0.5);
	border-top: 0;
	border-radius: 0 0 1rem 1rem;
	transition: box-shadow 0.2s ease, transform 0.2s ease;

	& > .round {
		font-size: 1.5rem;
		margin-right: 2rem;
		line-height: 1.2;
	}

	& > .multiplier {
		font-size: 1rem;
		line-height: 1.2;
	}

	& > .turn {
		font-size: 0.95rem;
		line-height: 1.2;
		b {
			margin: 0 0.2rem;
			color: #ffffff;
		}
		em {
			margin-left: 0.2rem;
			font-style: normal;
			color: var(--color-text-white);
		}
	}

	&.is-my-turn {
		box-shadow: 0 0 0.6rem rgba(255, 255, 255, 0.6), 0 0 1rem rgba(255, 193, 15, 0.6);
		transform: translateY(0.1rem);
	}
}
</style>
