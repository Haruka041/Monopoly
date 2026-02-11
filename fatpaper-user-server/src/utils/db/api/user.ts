import {User} from "../entities/user";
import AppDataSource from "../dbConnecter";
import {decryptPassword, generatePasswordHash, getRandomString, randomColor} from "../../index";

const userRepository = AppDataSource.getRepository(User);

export const createUser = async (
    useraccount: string,
    username: string,
    password: string,
    avatar: string,
    color?: string
) => {
    const user = await AppDataSource.manager.findOneBy(User, {useraccount});
    if (user) throw new Error("已经存在的账号名")
    const decryptedPassword = decryptPassword(password);
    if (!decryptedPassword) {
        throw new Error("客户端密码解密失败，请刷新页面后重试");
    }
    const {salt, passwordHash} = generatePasswordHash(decryptedPassword, getRandomString(16));

    const userToCreate = new User();
    userToCreate.useraccount = useraccount;
    userToCreate.username = username;
    userToCreate.password = passwordHash;
    userToCreate.salt = salt;
    userToCreate.avatar = avatar;
    userToCreate.color = color || randomColor();

    return await userRepository.save(userToCreate);
};

export const userLogin = async (useraccount: string, password: string, privateKey: string) => {
    const user = await AppDataSource.manager.findOneBy(User, {useraccount});
    if (user) {
        const decryptedPassword = decryptPassword(password);
        if (!decryptedPassword) throw new Error("客户端密码解密失败");
        const {passwordHash} = generatePasswordHash(decryptedPassword, user.salt);
        if (user.password === passwordHash) {
            return user;
        } else {
            throw new Error("密码错误");
        }
    } else {
        throw new Error("不存在的账号");
    }
};

export const deleteUser = async (id: string) => {
    const user = await userRepository.findOne({
        where: {id},
    });
    if (user) {
        return userRepository.remove(user);
    } else {
        null;
    }
};

export const getUserById = async (userId: string) => {
    const user = await AppDataSource.manager.findOne(User, {
        select: ["id", "useraccount", "username", "avatar", "color"],
        where: {id: userId},
    });
    if (user) {
        return user;
    } else {
        return null;
    }
};

export const getUserList = async (page: number, size: number) => {
    const userList = await userRepository.find({
        skip: (page - 1) * size,
        take: size,
        select: ["id", "username", "avatar", "color"],
    });
    // const total = Math.round((await userRepository.count()) / size);
    const total = await userRepository.count();
    return {userList, total};
};

export const isAdmin = async (openId: string) => {
    return openId === "o9eqR63E6wFQRAqUUcHs424HCNw4";
};

export const updateUserProfileById = async (
	userId: string,
	payload: {
		username?: string;
		avatar?: string;
		color?: string;
	}
) => {
	const user = await userRepository.findOne({
		where: { id: userId },
	});
	if (!user) {
		throw new Error("用户不存在");
	}
	if (payload.username !== undefined) {
		const username = payload.username.trim();
		if (!username) {
			throw new Error("用户名不能为空");
		}
		user.username = username;
	}
	if (payload.color !== undefined) {
		const color = payload.color.trim();
		if (!color) {
			throw new Error("颜色不能为空");
		}
		user.color = color;
	}
	if (payload.avatar !== undefined) {
		user.avatar = payload.avatar;
	}
	await userRepository.save(user);
	return {
		id: user.id,
		useraccount: user.useraccount,
		username: user.username,
		avatar: user.avatar,
		color: user.color,
	};
};

export const changeUserPasswordById = async (userId: string, oldPassword: string, newPassword: string) => {
	const user = await userRepository.findOne({
		where: { id: userId },
		select: ["id", "password", "salt"],
	});
	if (!user) {
		throw new Error("用户不存在");
	}
	const oldPlain = decryptPassword(oldPassword) || oldPassword;
	const newPlain = decryptPassword(newPassword) || newPassword;
	if (newPlain.length < 6) {
		throw new Error("新密码长度至少为6位");
	}

	const oldHash = generatePasswordHash(oldPlain, user.salt).passwordHash;
	if (oldHash !== user.password) {
		throw new Error("旧密码错误");
	}

	const { salt, passwordHash } = generatePasswordHash(newPlain, getRandomString(16));
	user.salt = salt;
	user.password = passwordHash;
	await userRepository.save(user);
	return true;
};
