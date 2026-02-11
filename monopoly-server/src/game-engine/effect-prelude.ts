// Runtime prelude injected before DB effect TS snippets.
// It must provide runtime symbols used by scripts, especially PlayerEvents and utils.
export const EFFECT_PRELUDE = `
var PlayerEvents;
(function (PlayerEvents) {
	PlayerEvents["GetPropertiesList"] = "GetPropertiesList";
	PlayerEvents["GetCardsList"] = "GetCardsList";
	PlayerEvents["GetMoney"] = "GetMoney";
	PlayerEvents["GetStop"] = "GetStop";
	PlayerEvents["GetIsBankrupted"] = "GetIsBankrupted";
	PlayerEvents["AnimationFinished"] = "AnimationFinished";
	PlayerEvents["Walk"] = "Walk";
	PlayerEvents["Tp"] = "Tp";
	PlayerEvents["BeforeSetPropertiesList"] = "BeforeSetPropertiesList";
	PlayerEvents["AfterSetPropertiesList"] = "AfterSetPropertiesList";
	PlayerEvents["BeforeGainProperty"] = "BeforeGainProperty";
	PlayerEvents["AfterGainProperty"] = "AfterGainProperty";
	PlayerEvents["BeforeRound"] = "BeforeRound";
	PlayerEvents["AfterRound"] = "AfterRound";
	PlayerEvents["BeforeLoseProperty"] = "BeforeLoseProperty";
	PlayerEvents["AfterLoseProperty"] = "AfterLoseProperty";
	PlayerEvents["BeforeSetCardsList"] = "BeforeSetCardsList";
	PlayerEvents["AfterSetCardsList"] = "AfterSetCardsList";
	PlayerEvents["BeforeGainCard"] = "BeforeGainCard";
	PlayerEvents["AfterGainCard"] = "AfterGainCard";
	PlayerEvents["BeforeLoseCard"] = "BeforeLoseCard";
	PlayerEvents["AfterLoseCard"] = "AfterLoseCard";
	PlayerEvents["BeforeSetMoney"] = "BeforeSetMoney";
	PlayerEvents["AfterSetMoney"] = "AfterSetMoney";
	PlayerEvents["BeforeGain"] = "BeforeGain";
	PlayerEvents["AfterGain"] = "AfterGain";
	PlayerEvents["BeforeCost"] = "BeforeCost";
	PlayerEvents["AfterCost"] = "AfterCost";
	PlayerEvents["BeforeStop"] = "BeforeStop";
	PlayerEvents["AfterStop"] = "AfterStop";
	PlayerEvents["BeforeTp"] = "BeforeTp";
	PlayerEvents["AfterTp"] = "AfterTp";
	PlayerEvents["BeforeWalk"] = "BeforeWalk";
	PlayerEvents["AfterWalk"] = "AfterWalk";
	PlayerEvents["BeforeSetBankrupted"] = "BeforeSetBankrupted";
	PlayerEvents["AfterSetBankrupted"] = "AfterSetBankrupted";
})(PlayerEvents || (PlayerEvents = {}));

const utils = {
	randomString: (length) => {
		const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		let randomString = "";
		for (let i = 0; i < length; i++) {
			const randomIndex = Math.floor(Math.random() * characters.length);
			randomString += characters.charAt(randomIndex);
		}
		return randomString;
	},
	randomInRange: (min, max) => {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}
};
`;
