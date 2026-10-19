/**
 * `[Powerups]` section — the crate payout table.
 *
 * Reference: redalert2/src/game/rules/PowerupsRules.ts
 *
 * The value format is preserved verbatim: `probShares,animName,waterAllowed,data`,
 * split on `,`. `animName` accepts the literal `<none>` (lower-cased before the
 * comparison) for payouts with no animation.
 *
 * `UNSUPPORTED_POWERUP_TYPES` is filtered out at read time, not at roll time — so
 * an unsupported entry never enters the table and can never be picked.
 */
import { PowerupType, UNSUPPORTED_POWERUP_TYPES } from '../type/PowerupType';

export interface PowerupEntry {
    type: PowerupType;
    probShares: number;
    animName?: string;
    waterAllowed: boolean;
    data?: string;
}

/** key = powerup name, value = `probShares,animName,waterAllowed,data` */
export type PowerupsRulesData = Record<string, string>;

export class PowerupsRules {
    powerups: PowerupEntry[] = [];

    read(data: PowerupsRulesData = {}): this {
        for (const [key, value] of Object.entries(data)) {
            const [probShares, animName, waterAllowed, extra] = value.split(',');
            const shares = Number(probShares);
            const type = PowerupType[key as keyof typeof PowerupType];
            if (type !== undefined) {
                if (!UNSUPPORTED_POWERUP_TYPES.includes(type)) {
                    this.powerups.push({
                        type,
                        probShares: shares,
                        animName: animName !== undefined && animName.toLowerCase() !== '<none>'
                            ? animName
                            : undefined,
                        waterAllowed: waterAllowed === 'yes',
                        data: extra,
                    });
                }
            }
            else {
                console.warn(`Unknown powerup "${key}". Skipping.`);
            }
        }
        return this;
    }
}
