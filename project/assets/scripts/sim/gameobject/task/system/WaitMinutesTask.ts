/**
 * Verbatim from redalert2/src/game/gameobject/task/system/WaitMinutesTask.ts (7 lines).
 *
 * Duration comes from rules.ini in **minutes at the base tick rate**, so the
 * conversion is `BASE_TICKS_PER_SECOND * minutes * 60` regardless of the player's
 * chosen game speed. `floor` not `round`: a "1 minute" reload must never be
 * shorter than 900 ticks.
 */
import { WaitTicksTask } from './WaitTicksTask';
import { GameSpeed } from '../../../GameSpeed';

export class WaitMinutesTask extends WaitTicksTask {
    constructor(minutes: number) {
        super(Math.floor(GameSpeed.BASE_TICKS_PER_SECOND * minutes * 60));
    }
}
