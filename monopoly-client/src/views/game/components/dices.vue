<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useGameInfo, useUtil } from "@/store/index";
import { DiceRenderer } from "@/classes/three/DiceRenderer";
import { useRoomInfo } from "../../../store/index";

const utilStore = useUtil();
const gameInfoStore = useGameInfo();
const rollDiceResult = computed(() => utilStore.rollDiceResult);
const isRollDiceAnimationPlay = computed(() => utilStore.isRollDiceAnimationPlay);
const canRoll = computed(() => utilStore.canRoll);
const isMyTurn = computed(() => gameInfoStore.isMyTurn);
const roomInfoStore = useRoomInfo();

let diceRenderer: DiceRenderer | undefined;
const actionHint = ref("");
let actionHintToken = 0;

function showActionHint(text: string, duration = 800) {
	actionHint.value = text;
	const token = Date.now();
	actionHintToken = token;
	window.setTimeout(() => {
		if (actionHintToken === token) {
			actionHint.value = "";
		}
	}, duration);
}

const statusText = computed(() => {
	if (actionHint.value) return actionHint.value;
	if (isMyTurn.value && canRoll.value) return "轮到你了";
	if (isMyTurn.value) return isRollDiceAnimationPlay.value ? "掷骰中..." : "等待结算";
	return "等待其他玩家";
});

watch(rollDiceResult, (newRollResult) => {
	diceRenderer && diceRenderer.stopRotate(newRollResult);
});

watch(isRollDiceAnimationPlay, (animationPlay) => {
	if (!diceRenderer) return;
	if (animationPlay) {
		diceRenderer.startRotate();
	}
});

onMounted(async () => {
	const canvasEl = document.getElementById("game_dice_canvas") as HTMLCanvasElement;
	diceRenderer = new DiceRenderer(canvasEl, false, roomInfoStore.gameSetting.diceNum, 1.1, false, 2.1);
	await diceRenderer.initDice();
});

const emit = defineEmits(["roll"]);

function handleRollDice() {
	if (canRoll.value) {
		emit("roll");
		showActionHint("已提交");
	}
}
</script>

<template>
	<div class="dice-wrapper" :class="{ canroll: canRoll }">
		<canvas
			id="game_dice_canvas"
			class="dice-button"
			:disabled="!canRoll"
			@click="handleRollDice"
		/>
		<div class="dice-status" :class="{ 'is-my-turn': isMyTurn && canRoll }">
			{{ statusText }}
		</div>
	</div>
</template>

<style lang="scss" scoped>
.dice-wrapper {
	position: relative;
	width: 16rem;
	height: 10rem;

	&.canroll .dice-button {
		background-color: var(--color-second);
		animation: identifier 1.5s infinite ease-in-out;

		&:hover {
			background-color: var(--color-third);
		}
	}
}

.dice-button {
	width: 100% !important;
	height: 100% !important;
	cursor: pointer;
	border-radius: 2rem;
	border: 0.5rem solid rgba(255, 255, 255, 0.6);
	background-color: rgba(255, 255, 255, 0.5);
	transition: background-color 0.15s ease-in-out;
}

.dice-status {
	position: absolute;
	left: 50%;
	bottom: 0.4rem;
	transform: translateX(-50%);
	padding: 0.2rem 0.6rem;
	border-radius: 999px;
	font-size: 0.85rem;
	background-color: rgba(0, 0, 0, 0.35);
	color: #ffffff;
	box-shadow: var(--box-shadow);
	pointer-events: none;
	white-space: nowrap;

	&.is-my-turn {
		background-color: rgba(255, 193, 15, 0.9);
		color: #ffffff;
	}
}

@keyframes identifier {
	50% {
		background-color: var(--color-third);
	}
}
</style>
