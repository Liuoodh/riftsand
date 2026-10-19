/**
 * `[General]` crew block — who climbs out of a wrecked structure.
 *
 * Reference: redalert2/src/game/rules/general/CrewRules.ts
 * `crewEscape` and `survivorRate` are parsed by the reference but never read by
 * `CrewedTrait`, so they are kept for parity but flagged unused.
 */
export interface CrewRulesData {
    alliedCrew?: string;
    alliedSurvivorDivisor?: number;
    crewEscape?: number;
    sovietCrew?: string;
    sovietSurvivorDivisor?: number;
    survivorRate?: number;
}

export class CrewRules {
    alliedCrew = '';
    alliedSurvivorDivisor = 0;
    /** parsed by the reference, never read */
    crewEscape = 0;
    sovietCrew = '';
    sovietSurvivorDivisor = 0;
    /** parsed by the reference, never read */
    survivorRate = 0;

    read(data: CrewRulesData = {}): CrewRules {
        this.alliedCrew = data.alliedCrew ?? '';
        this.alliedSurvivorDivisor = data.alliedSurvivorDivisor ?? 0;
        this.crewEscape = data.crewEscape ?? 0;
        this.sovietCrew = data.sovietCrew ?? '';
        this.sovietSurvivorDivisor = data.sovietSurvivorDivisor ?? 0;
        this.survivorRate = data.survivorRate ?? 0;
        return this;
    }
}
