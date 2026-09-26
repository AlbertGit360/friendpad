export declare const CANVAS: Readonly<{
    width: 1600;
    height: 1200;
}>;
export declare const PALETTE: Readonly<{
    white: "#FFFFFF";
    black: "#000000";
    accent: "#CCFF00";
}>;
/** Optional game colors; canonical Friend pixels remain black and white. */
export declare const GAME_PALETTE: Readonly<{
    meadow: "#B9D984";
    pond: "#7DB4DB";
    sun: "#F2CE68";
    coral: "#ED927E";
    lilac: "#B3A0D8";
}>;
export declare const PROJECTION: Readonly<{
    a: 0.8660254038;
    b: 0.28;
    scale: 1.5;
    width: 576;
    height: 384;
    cx: 800;
    cy: 690;
}>;
export declare const PROP_CANVAS: Readonly<{
    width: 240;
    height: 240;
    anchorX: 120;
    anchorY: 180;
}>;
export declare const PROP_TYPES: readonly ["tree", "flower", "bench", "planter", "terminal", "crate", "pipe", "tank", "crystal", "rock", "vent", "antenna", "solar", "dish", "buoy", "reeds", "bridge", "circuit"];
export type WorldPropType = typeof PROP_TYPES[number];
export type WorldPoint = readonly [number, number];
export type WorldRect = Readonly<{
    x: number;
    y: number;
    w: number;
    h: number;
}>;
export type WorldAnchor = Readonly<{
    x: number;
    y: number;
    sprite?: number;
}>;
export type WorldProp = Readonly<{
    type: WorldPropType;
    x: number;
    y: number;
    scale?: number;
    /** Optional local world-coordinate footprint, scaled with the prop. Null is passable. */
    footprint?: WorldRect | null;
}>;
export type WorldSignal = Readonly<{
    x: number;
    y: number;
    kind: "currency" | "node";
}>;
export type WorldChunk = WorldRect & Readonly<{
    stage: "void" | "wireframe" | "floating";
    lift?: number;
}>;
export type WorldConfig = Readonly<{
    id: string;
    name: string;
    family: string;
    setting: string;
    shape: string;
    summary: string;
    variant: "complete" | "loading";
    geometry: Readonly<{
        polygons: readonly (readonly WorldPoint[])[];
        holes: readonly (readonly WorldPoint[])[];
        depth: number;
    }>;
    props: readonly WorldProp[];
    /** Canonical composition anchors only. Rendering never resolves their legacy sprite indexes. */
    actors: readonly WorldAnchor[];
    paths: readonly Readonly<{
        points: readonly WorldPoint[];
        width: number;
    }>[];
    patches: readonly (WorldRect & Readonly<{
        pattern: "dither" | "dense" | "grid" | "hatch" | "water";
    }>)[];
    signals: readonly WorldSignal[];
    missingChunks: readonly WorldChunk[];
    collision?: Readonly<{
        blocked: readonly WorldRect[];
    }>;
}>;
export type WorldActor = Readonly<{
    id?: string;
    x: number;
    y: number;
    rows: readonly string[];
    pixelScale?: number;
}>;
export type WorldRenderOptions = Readonly<{
    actors?: readonly WorldActor[];
    signals?: boolean;
    background?: "transparent" | "black";
    /** Apply GAME_PALETTE to terrain and props. Monochrome artwork is the default. */
    color?: boolean;
}>;
export type PropRenderOptions = Readonly<{
    color?: boolean;
}>;
export type WorldObjectLayer = Readonly<{
    kind: "prop" | "signal";
    x: number;
    y: number;
    depth: number;
    svg: string;
}>;
export type WorldLayers = Readonly<{
    width: number;
    height: number;
    terrainSvg: string;
    objects: readonly WorldObjectLayer[];
}>;
/** Validate untrusted JSON once, then share the immutable result with rendering and movement. */
export declare function validateWorld(value: unknown): WorldConfig;
export declare function project(x: number, y: number, lift?: number): [number, number];
/** Inverse of the canonical camera. Returned world coordinates are not rounded. */
export declare function unproject(screenX: number, screenY: number, lift?: number): [number, number];
/** Ground membership excludes every courtyard hole and all three missing-chunk stages. */
export declare function worldContains(world: WorldConfig, location: WorldPoint): boolean;
/** Game collision additions; these footprints are not claimed to be on-chain terrain data. */
export declare const PROP_FOOTPRINTS: Readonly<Record<WorldPropType, Readonly<{
    w: number;
    h: number;
}> | null>>;
/** Collision uses a disk in world coordinates, including exact clearance from terrain edges. */
export declare function isWorldWalkable(world: WorldConfig, location: WorldPoint, radius?: number): boolean;
/** Stable painter's order. Put static layers and dynamic actors in the same list. */
export declare function sortWorldItems<T extends Readonly<{
    x: number;
    y: number;
}>>(items: readonly T[]): T[];
/** Full-canvas static layers. Decode them once, then interleave upright live actors by x + y. */
export declare function renderWorldLayers(world: WorldConfig, options?: Omit<WorldRenderOptions, "actors">): WorldLayers;
/** Self-contained vector world export, optionally populated with current caller-supplied frames. */
export declare function renderWorld(world: WorldConfig, options?: WorldRenderOptions): string;
/** Reusable canonical prop fragment. Use renderProp for a complete standalone SVG. */
export declare function propArtwork(type: WorldPropType, id?: string, options?: PropRenderOptions): string;
/** Native-scale transparent asset; ground anchor is PROP_CANVAS.anchorX/anchorY. */
export declare function renderProp(type: WorldPropType, options?: PropRenderOptions): string;
export declare const WORLD_PRESETS: readonly WorldConfig[];
/** Returns an immutable validated scene; copy with structuredClone before editing. */
export declare function getWorldPreset(id: string): WorldConfig;
