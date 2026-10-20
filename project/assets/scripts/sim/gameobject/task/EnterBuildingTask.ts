/**
 * Port of redalert2/src/game/gameobject/task/EnterBuildingTask.ts (59 lines).
 *
 * The shared spine of every "walk into a structure" order: capture, garrison,
 * repair, plant C4, infiltrate, bunker, recycler. Subclasses only answer
 * `isAllowed` (may *this* unit enter?) and `onEnter` (what happens then).
 *
 * The control flow is a two-phase latch, and the order of the checks matters:
 *
 * 1. **Cancel / abort / immobile → done immediately.** A cancelling task with
 *    no move in flight has nothing to undo; one that already pushed a move
 *    waits for that child to finish first.
 * 2. **`movePerformed && children.length` → wait.** Once the approach move is
 *    running this task becomes a spectator and just remembers the last tile it
 *    stood on *outside* the footprint (`lastOutsideTile`) — that tile is where
 *    `MoveOutsideTask` pushes the unit back to if entry turns out to be
 *    illegal, so it must be recorded before the unit steps in.
 * 3. **On the footprint → enter or bounce.** `isAllowed` is re-checked at the
 *    last possible moment because the world may have changed during the walk
 *    (someone else took the bunker, the building was captured, the engineer
 *    died). `onEnter` returning `false` is the *soft* refusal — a third
 *    outcome besides "not allowed" and "entered": the unit backs out without
 *    the task failing, which `PlantC4Task` uses to plant and retreat.
 * 4. **Not on the footprint and not yet moving → push `MoveInsideTask`.**
 *    `setBlocking(false)` is deliberate: the child must not stall the queue,
 *    because the parent is what decides when the whole thing is over.
 *
 * `preventOpportunityFire` starts `false` — an engineer walking to a derrick
 * still shoots back on the way — and is raised to `true` only once the move
 * actually starts. That is the difference between "approaching" and "committed".
 */
import { Task } from './system/Task';
import { MoveOutsideTask } from './move/MoveOutsideTask';
import { MoveInsideTask } from './move/MoveInsideTask';
import { EnterObjectEvent } from '../../event/EnterObjectEvent';

export class EnterBuildingTask extends Task {
    protected game: any;
    public target: any;
    private aborted: boolean = false;
    private movePerformed: boolean = false;
    public preventOpportunityFire: boolean = false;
    private lastOutsideTile: any;

    constructor(game: any, target: any) {
        super();
        this.game = game;
        this.target = target;
    }

    onTick(gameObject: any): boolean {
        if (
            (this.isCancelling() && (!this.movePerformed || this.children.length === 0)) ||
            this.aborted ||
            gameObject.moveTrait.isDisabled()
        ) {
            return true;
        }
        if (this.movePerformed && this.children.length) {
            if (
                gameObject.tile === this.lastOutsideTile ||
                this.game.map.tileOccupation.isTileOccupiedBy(gameObject.tile, this.target)
            ) {
                this.lastOutsideTile = gameObject.tile;
            }
            return false;
        }
        if (this.game.map.tileOccupation.isTileOccupiedBy(gameObject.tile, this.target)) {
            if (!this.isAllowed(gameObject) || this.isCancelling()) {
                this.children.push(new MoveOutsideTask(this.game, this.target, this.lastOutsideTile));
                this.aborted = true;
                return false;
            }
            this.game.events.dispatch(new EnterObjectEvent(this.target, gameObject));
            if (this.onEnter(gameObject) === false) {
                this.children.push(new MoveOutsideTask(this.game, this.target, this.lastOutsideTile));
                this.aborted = true;
                return false;
            }
        } else if (!this.movePerformed) {
            this.children.push(new MoveInsideTask(this.game, this.target).setBlocking(false));
            this.movePerformed = true;
            this.preventOpportunityFire = true;
        }
        return false;
    }

    getTargetLinesConfig(gameObject: any): any {
        return { target: this.target, pathNodes: [] };
    }

    protected isAllowed(gameObject: any): boolean {
        return true;
    }

    protected onEnter(gameObject: any): any {
        return true;
    }
}
