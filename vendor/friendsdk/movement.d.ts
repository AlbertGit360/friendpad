import { type WorldConfig, type WorldPoint } from "./friend-world.js";
import type { SpriteFacing } from "./generation-sprites.js";
export type MovementState = Readonly<{
    position: WorldPoint;
    facing: SpriteFacing;
    walking: boolean;
    destination: WorldPoint | null;
}>;
/** Host owns DOM events and animation frames; movement stays in world coordinates. */
export declare function createWorldMovement(world: WorldConfig, spawn: WorldPoint, options?: {
    speed?: number;
    radius?: number;
}): {
    readonly state: Readonly<{
        position: WorldPoint;
        facing: SpriteFacing;
        walking: boolean;
        destination: WorldPoint | null;
    }>;
    /** Returns whether a key is handled. Clear held keys with stop() on blur/pause. */
    setKey(key: string, pressed: boolean): boolean;
    moveTo(point: WorldPoint): boolean;
    stop: () => void;
    reset(): void;
    /** Delta is milliseconds; a suspended tab advances by at most 40 ms. */
    update(deltaMs: number): MovementState;
};
