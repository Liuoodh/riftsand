/**
 * `[MultiplayerDialogSettings]` section — the skirmish setup defaults.
 *
 * Reference: redalert2/src/game/rules/MpDialogSettings.ts
 *
 * Every field is optional *and stays undefined when the key is absent*, which is
 * the point: the skirmish dialog distinguishes "the rules file did not say" from
 * "the rules file said 0", and falls back to its own default only in the former
 * case. Do not collapse these to numbers with defaults.
 */
export interface MpDialogSettingsData {
    minMoney?: number;
    money?: number;
    maxMoney?: number;
    moneyIncrement?: number;
    minUnitCount?: number;
    unitCount?: number;
    maxUnitCount?: number;
    crates?: boolean;
    gameSpeed?: number;
    mcvRedeploys?: boolean;
    shortGame?: boolean;
    superWeapons?: boolean;
    techLevel?: number;
    alliesAllowed?: boolean;
    allyChangeAllowed?: boolean;
    mustAlly?: boolean;
    bridgeDestruction?: boolean;
    multiEngineer?: boolean;
}

export class MpDialogSettings {
    minMoney?: number;
    money?: number;
    maxMoney?: number;
    moneyIncrement?: number;
    minUnitCount?: number;
    unitCount?: number;
    maxUnitCount?: number;
    crates?: boolean;
    gameSpeed?: number;
    mcvRedeploys?: boolean;
    shortGame?: boolean;
    superWeapons?: boolean;
    techLevel?: number;
    alliesAllowed?: boolean;
    allyChangeAllowed?: boolean;
    mustAlly?: boolean;
    bridgeDestruction?: boolean;
    multiEngineer?: boolean;

    read(data: MpDialogSettingsData = {}): MpDialogSettings {
        this.minMoney = data.minMoney;
        this.money = data.money;
        this.maxMoney = data.maxMoney;
        this.moneyIncrement = data.moneyIncrement;
        this.minUnitCount = data.minUnitCount;
        this.unitCount = data.unitCount;
        this.maxUnitCount = data.maxUnitCount;
        this.crates = data.crates;
        this.gameSpeed = data.gameSpeed;
        this.mcvRedeploys = data.mcvRedeploys;
        this.shortGame = data.shortGame;
        this.superWeapons = data.superWeapons;
        this.techLevel = data.techLevel;
        this.alliesAllowed = data.alliesAllowed;
        this.allyChangeAllowed = data.allyChangeAllowed;
        this.mustAlly = data.mustAlly;
        this.bridgeDestruction = data.bridgeDestruction;
        this.multiEngineer = data.multiEngineer;
        return this;
    }
}
