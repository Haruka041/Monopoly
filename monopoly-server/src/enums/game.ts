export enum GameOverRule {
	OnePlayerGoBroke, //一位玩家破产
	LeftOnePlayer, //只剩一位玩家
	Earn100000, //挣100000块钱
}

export enum OperateType {
	GameInitFinished = "GameInitFinished", //前端加载完毕
	RollDice = "RollDice", //前端掷骰子
	UseChanceCard = "UseChanceCard", //使用机会卡
	Animation = "AnimationComplete", //前端动画完成回馈
	BuyProperty = "BuyProperty", //买房子
	BuildHouse = "BuildHouse", //升级房子

	PauseGame = "PauseGame", //房主暂停游戏
	ResumeGame = "ResumeGame", //房主恢复游戏
}

export enum ChanceCardType {
	ToSelf = "ToSelf",
	ToOtherPlayer = "ToOtherPlayer",
	ToPlayer = "ToPlayer",
	ToProperty = "ToProperty",
	ToMapItem = "ToMapItem",
}

export enum GameLinkItem {
	Player = "Player",
	ChanceCard = "ChanceCard",
	Property = "Property",
	ArrivedEvent = "ArrivedEvent",
}

export enum PlayerEvents {
	GetPropertiesList = "GetPropertiesList",
	GetCardsList = "GetCardsList",
	GetMoney = "GetMoney",
	GetStop = "GetStop",
	GetIsBankrupted = "GetIsBankrupted",
	AnimationFinished = "AnimationFinished",
	Walk = "Walk",
	Tp = "Tp",

	BeforeSetPropertiesList = "BeforeSetPropertiesList",
	AfterSetPropertiesList = "AfterSetPropertiesList",

	BeforeGainProperty = "BeforeGainProperty",
	AfterGainProperty = "AfterGainProperty",

	BeforeRound = "BeforeRound",
	AfterRound = "AfterRound",

	BeforeLoseProperty = "BeforeLoseProperty",
	AfterLoseProperty = "AfterLoseProperty",

	BeforeSetCardsList = "BeforeSetCardsList",
	AfterSetCardsList = "AfterSetCardsList",

	BeforeGainCard = "BeforeGainCard",
	AfterGainCard = "AfterGainCard",

	BeforeLoseCard = "BeforeLoseCard",
	AfterLoseCard = "AfterLoseCard",

	BeforeSetMoney = "BeforeSetMoney",
	AfterSetMoney = "AfterSetMoney",

	BeforeGain = "BeforeGain",
	AfterGain = "AfterGain",

	BeforeCost = "BeforeCost",
	AfterCost = "AfterCost",

	BeforeStop = "BeforeStop",
	AfterStop = "AfterStop",

	BeforeTp = "BeforeTp",
	AfterTp = "AfterTp",

	BeforeWalk = "BeforeWalk",
	AfterWalk = "AfterWalk",

	BeforeSetBankrupted = "BeforeSetBankrupted",
	AfterSetBankrupted = "AfterSetBankrupted",
}
