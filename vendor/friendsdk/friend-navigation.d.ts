import { type WorldConfig, type WorldPoint } from "./friend-world.js";
/** A small, local navigation grid. Every traversed and simplified segment is collision checked. */
export declare function createWorldNavigator(world: WorldConfig, radius?: number, spacing?: number): {
    route: (from: WorldPoint, to: WorldPoint) => WorldPoint[] | null;
    segmentClear: (from: WorldPoint, to: WorldPoint) => boolean;
};
