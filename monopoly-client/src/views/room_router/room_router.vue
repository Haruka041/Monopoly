<script setup lang="ts">
import { onMounted, computed, ref, reactive } from "vue";
import { useUserInfo, useUserList, useRoomList, useRoomInfo, useLoading } from "@/store";
import { useMonopolyClient } from "@/classes/monopoly-client/MonopolyClient";
import userCard from "@/components/common/user-card.vue";
import router from "@/router";
import { changeMyPassword, getUserByToken, updateMyProfile } from "@/utils/api/user";
import FPMessage from "@/components/utils/fp-message";
import { __FATPAPER_HOST__, __ICE_SERVER_PORT__ } from "@G/global.config";
import LoginExtra from "@/views/login/components/login-extra.vue";
import FpPopover from "@/components/utils/fp-popover/fp-popover.vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { getRandomPublicRoom } from "@/utils/api/room-router";
import { throttle } from "@/utils";
import FpDialog from "@/components/utils/fp-dialog/fp-dialog.vue";

const userInfoStore = useUserInfo();
const userListStore = useUserList();
const roomListStore = useRoomList();

const user = computed(() => userInfoStore);
const roomId = ref("");
const showProfileDialog = ref(false);
const profileAvatarInput = ref<HTMLInputElement | null>(null);
const profileAvatarPreview = ref("");
const profileForm = reactive({
	username: "",
	color: "#7cc35f",
	oldPassword: "",
	newPassword: "",
	avatarFile: undefined as File | undefined,
});
const isTokenUser = computed(() => Boolean(localStorage.getItem("token")));

onMounted(async () => {
	roomListStore.$reset();
	if (!userInfoStore.hasUserInfo()) {
		useLoading().showLoading("读取用户信息中");
		let token = localStorage.getItem("token") || "";
		if (token) {
			//账号登录
			try {
				const { id: userId, useraccount, username, avatar, color } = await getUserByToken(token);
				const userInfoStore = useUserInfo();
				userInfoStore.$patch({ userId, useraccount, username, avatar, color });
				useLoading().hideLoading();
				return;
			} catch (e: any) {
				FPMessage({ type: "error", message: e.message || e });
				handleLogout();
			}
		}
		let userInfo = localStorage.getItem("user") || "";
		if (userInfo) {
			//游客登录
			try {
				const { userId, useraccount = "", username, avatar = "", color } = JSON.parse(userInfo);
				const userInfoStore = useUserInfo();
				userInfoStore.$patch({ userId, useraccount, username, avatar, color });
				useLoading().hideLoading();
				return;
			} catch (e: any) {
				FPMessage({ type: "error", message: "读取用户信息失败, 请重新进行游客登记" });
				handleLogout();
			}
		}
		handleLogout();
	}
	roomId.value = localStorage.getItem("last-room-id") || "";
	resetProfileFormFromStore();
});

function handleLogout() {
	localStorage.removeItem("token");
	localStorage.removeItem("user");
	router.replace({ name: "login" });
}

async function handleJoinRoom(e: Event) {
	e.preventDefault();
	const _roomId = roomId.value;
	if (!_roomId) {
		FPMessage({ type: "error", message: "请输入房间号" });
		return;
	}
	await joinRoom(_roomId);
}

async function joinRoom(id: string) {
	try {
		const monopolyClient = await useMonopolyClient({
			iceServer: {
				host: __FATPAPER_HOST__,
				port: __ICE_SERVER_PORT__,
			},
		});
		useLoading().showLoading("正在尝试连接");
		localStorage.setItem("last-room-id", id);
		await monopolyClient.joinRoom(id);
	} catch (e: any) {
		FPMessage({ type: "error", message: e.message || e });
	} finally {
		useLoading().hideLoading();
	}
}

const randomRoomButtonDisable = ref(false);
let interval: any;
async function handleGetRandomPublicRoom(e: Event) {
	e.preventDefault();
	if (interval) clearInterval(interval);
	randomRoomButtonDisable.value = true;
	interval = setInterval(() => {
		randomRoomButtonDisable.value = false;
	}, 1000);
	try {
		const res = await getRandomPublicRoom();
		if (res.roomId) {
			FPMessage({ type: "success", message: "遇到等待的小伙伴了呢!" });
			await joinRoom(res.roomId);
		} else {
			FPMessage({ type: "error", message: "现在没有公开的房间喔" });
		}
	} catch (e: any) {
		FPMessage({ type: "error", message: e.message || e });
	}
}

function resetProfileFormFromStore() {
	profileForm.username = userInfoStore.username || "";
	profileForm.color = userInfoStore.color || "#7cc35f";
	profileForm.oldPassword = "";
	profileForm.newPassword = "";
	profileForm.avatarFile = undefined;
	profileAvatarPreview.value = userInfoStore.avatar || "";
}

function openProfileDialog() {
	resetProfileFormFromStore();
	showProfileDialog.value = true;
}

function handlePickAvatar() {
	profileAvatarInput.value?.click();
}

function handleProfileAvatarChange(e: Event) {
	const target = e.target as HTMLInputElement;
	const file = target.files?.[0];
	if (!file) return;
	profileForm.avatarFile = file;
	profileAvatarPreview.value = URL.createObjectURL(file);
}

async function handleSaveProfile() {
	try {
		if (!profileForm.username.trim()) {
			FPMessage({ type: "error", message: "用户名不能为空" });
			return;
		}
		if (isTokenUser.value) {
			const updated = await updateMyProfile({
				username: profileForm.username.trim(),
				color: profileForm.color,
				avatarFile: profileForm.avatarFile,
			});
			userInfoStore.$patch({
				userId: updated.id,
				useraccount: updated.useraccount || userInfoStore.useraccount,
				username: updated.username,
				avatar: updated.avatar,
				color: updated.color,
			});
			if (profileForm.oldPassword || profileForm.newPassword) {
				if (!profileForm.oldPassword || !profileForm.newPassword) {
					FPMessage({ type: "error", message: "修改密码时请同时填写旧密码和新密码" });
					return;
				}
				await changeMyPassword(profileForm.oldPassword, profileForm.newPassword);
			}
		} else {
			userInfoStore.$patch({
				username: profileForm.username.trim(),
				color: profileForm.color,
			});
			localStorage.setItem(
				"user",
				JSON.stringify({
					userId: userInfoStore.userId,
					useraccount: userInfoStore.useraccount,
					username: userInfoStore.username,
					avatar: userInfoStore.avatar,
					color: userInfoStore.color,
				})
			);
		}
		showProfileDialog.value = false;
		FPMessage({ type: "success", message: "账号资料已更新" });
	} catch (e: any) {
		FPMessage({ type: "error", message: e?.response?.data?.msg || e?.message || "保存失败" });
	}
}

async function handleJoinLastRoom() {
	const lastRoom = localStorage.getItem("last-room-id") || "";
	if (!lastRoom) {
		FPMessage({ type: "error", message: "还没有最近房间记录" });
		return;
	}
	roomId.value = lastRoom;
	await joinRoom(lastRoom);
}
</script>

<template>
	<LoginExtra></LoginExtra>
	<div class="hall-page">
		<div class="user-container">
			<userCard :avatar="user.avatar" :username="user.username" :color="user.color" />

			<div class="side-bar">
				<button class="profile" @click="openProfileDialog">账号设置</button>
				<button class="quit" @click="handleLogout">登出</button>
			</div>
		</div>
		<div class="join-room">
			<div class="title">Room-Router</div>
			<div class="describe">
				·输入房间号可加入房间，第一个使用房间号的将成为主机(房主)<br />
				·建议使用稍微复杂的房间号(防止误入别人的房间)<br />
			</div>
			<form @submit="handleJoinRoom">
				<input maxlength="12" v-model="roomId" type="text" placeholder="房间号(1-12个字符)" />
				<button type="submit">加入/创建房间</button>
				<button type="button" @click="handleJoinLastRoom">回到上次房间</button>
				<FpPopover placement="bottom">
					<template #default>
						<button class="random-room-button" :disabled="randomRoomButtonDisable" @click="handleGetRandomPublicRoom">
							<FontAwesomeIcon :icon="randomRoomButtonDisable ? 'hourglass-half' : 'shuffle'" />
						</button>
					</template>
					<template #content>
						<div class="tips">寻找随机的公开房间</div>
					</template>
				</FpPopover>
			</form>
		</div>
	</div>
	<FpDialog v-model:visible="showProfileDialog" @submit="handleSaveProfile">
		<template #title>
			<span style="font-size: 1.1rem">账号设置</span>
		</template>
		<div class="profile-form">
			<div class="row avatar-row">
				<div class="label">头像</div>
				<div class="avatar-box">
					<img v-if="profileAvatarPreview" :src="profileAvatarPreview" alt="avatar" />
					<div v-else class="avatar-empty">无头像</div>
					<button v-if="isTokenUser" type="button" @click="handlePickAvatar">选择头像</button>
					<input ref="profileAvatarInput" style="display: none" type="file" accept=".png,.jpg,.jpeg" @change="handleProfileAvatarChange" />
				</div>
			</div>
			<div class="row">
				<div class="label">昵称</div>
				<input v-model="profileForm.username" maxlength="20" />
			</div>
			<div class="row">
				<div class="label">代表色</div>
				<input v-model="profileForm.color" type="color" />
			</div>
			<div v-if="isTokenUser" class="row">
				<div class="label">旧密码</div>
				<input v-model="profileForm.oldPassword" type="password" placeholder="不改密码可留空" />
			</div>
			<div v-if="isTokenUser" class="row">
				<div class="label">新密码</div>
				<input v-model="profileForm.newPassword" type="password" placeholder="至少6位" />
			</div>
		</div>
	</FpDialog>
</template>

<style lang="scss" scoped>
.hall-page {
	width: 100%;
	height: 100%;
	display: flex;
	//flex-direction: column;
	justify-content: center;
	align-items: center;

	& > div {
		border: 0.3rem solid rgba(255, 255, 255, 0.65);
		border-radius: 1.5rem;
		background-color: rgba(255, 255, 255, 0.65);
		backdrop-filter: blur(0.2rem);
	}

	.user-container {
		width: 18rem;
		height: 7.5rem;
		margin-right: 0.7rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		position: relative;
		overflow: hidden;

		& > .side-bar {
			position: absolute;
			right: 0;
			top: 0;
			display: flex;
			flex-direction: column;
			align-items: center;

			& > button {
				width: 100%;
				height: 1.8rem;
				border-radius: 0.2rem 1rem 0.2rem 0.6rem;
				font-size: 0.8rem;
				padding: 0 0.6rem;
				margin-bottom: 0.2rem;
			}
		}
	}

	.join-room {
		padding: 1rem;

		& .title {
			display: inline-block;
			font-size: 1.6rem;
			color: var(--color-primary);
			margin-bottom: 0.7rem;
			background-color: rgba(255, 255, 255, 0.45);
			padding: 0.4rem 0.8rem;
			border-radius: 1rem;
		}

		& .describe {
			font-size: 0.9rem;
			color: #393939;
			margin-bottom: 0.8rem;
			padding-left: 0.8rem;
		}

		& form {
			display: flex;
			justify-content: space-around;

			& .random-room-button {
				width: 3rem;
				padding: 0 0.6rem;
			}

			& .tips {
				width: max-content;
				margin-top: 4rem;
				font-size: 1.2rem;
				background-color: rgba(255, 255, 255, 0.7);
				border-radius: 0.7rem;
				padding: 0.6rem;
				color: var(--color-primary);
				text-shadow: var(--text-shadow);
			}
		}

		& input {
			height: 3rem;
		}

		& button {
			margin-left: 0.5rem;
			border-radius: 0.7rem;
			height: 3rem;
		}
	}
}

.profile-form {
	min-width: 18rem;
	.row {
		margin-bottom: 0.6rem;
		display: flex;
		align-items: center;
		.label {
			width: 4.2rem;
			color: var(--color-primary);
			font-size: 0.95rem;
		}
		input {
			flex: 1;
			height: 2rem;
			border-radius: 0.5rem;
			border: 0.1rem solid rgba(0, 0, 0, 0.12);
			padding: 0 0.6rem;
			box-sizing: border-box;
		}
	}
	.avatar-row {
		align-items: flex-start;
	}
	.avatar-box {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		img,
		.avatar-empty {
			width: 4.2rem;
			height: 4.2rem;
			border-radius: 0.8rem;
			border: 0.12rem solid rgba(0, 0, 0, 0.16);
			margin-bottom: 0.4rem;
			object-fit: cover;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 0.7rem;
			color: #666;
		}
		button {
			height: 2rem;
			border-radius: 0.5rem;
		}
	}
}
</style>
