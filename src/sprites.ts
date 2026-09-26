// Canonical walking sprites for Generations Friends, read on-chain from the FriendSDK sprite registry.
// Mirrors FriendSDK `generation-sprites` (Apache-2.0): 64 × uint256 frames = idle[down,up,left,right]×8 + walk[…]×8,
// each a 16×16 one-bit mask, bit 0 = top-left.
import { parseAbi } from 'viem';
import { client } from './chain.js';

export const SPRITE_REGISTRY = '0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D';
const abi = parseAbi([
  'function familyOf(uint256 tokenId) pure returns (uint8)',
  'function seedOf(uint256 tokenId) pure returns (uint32)',
  'function frames(uint8 id, uint32 seed) view returns (uint256[64])',
]);
export const FACINGS = ['down', 'up', 'left', 'right'] as const;
export type Facing = typeof FACINGS[number];

export interface FriendSprites {
  tokenId: string;
  familyId: number;
  /** [idle|walk][facing][frame] → canvas with the black mask + 1px white halo (18×18) */
  clips: { idle: Record<Facing, HTMLCanvasElement[]>; walk: Record<Facing, HTMLCanvasElement[]> };
}

const cache = new Map<string, Promise<FriendSprites>>();
const LS = 'friendpad.sprite.';

function frameCanvas(bitmap: bigint): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 18;
  const g = c.getContext('2d')!;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && ((bitmap >> BigInt(y * 16 + x)) & 1n) === 1n;
  g.fillStyle = '#fff';
  for (let y = -1; y <= 16; y++) for (let x = -1; x <= 16; x++) {
    if (on(x, y)) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (on(x + dx, y + dy)) { near = true; break; }
    if (near) g.fillRect(x + 1, y + 1, 1, 1);
  }
  g.fillStyle = '#000';
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (on(x, y)) g.fillRect(x + 1, y + 1, 1, 1);
  return c;
}

function build(tokenId: string, familyId: number, frames: bigint[]): FriendSprites {
  const canv = frames.map(frameCanvas);
  const clip = (offset: number) => Object.fromEntries(FACINGS.map((f, i) => [f, canv.slice(offset + i * 8, offset + i * 8 + 8)])) as Record<Facing, HTMLCanvasElement[]>;
  return { tokenId, familyId, clips: { idle: clip(0), walk: clip(32) } };
}

export function readSprites(tokenId: string): Promise<FriendSprites> {
  if (cache.has(tokenId)) return cache.get(tokenId)!;
  const p = (async () => {
    try {
      const raw = localStorage.getItem(LS + tokenId);
      if (raw) { const j = JSON.parse(raw); return build(tokenId, j.f, j.fr.map((h: string) => BigInt('0x' + h))); }
    } catch { /* ignore */ }
    const id = BigInt(tokenId);
    const [familyId, seed] = await Promise.all([
      client.readContract({ address: SPRITE_REGISTRY, abi, functionName: 'familyOf', args: [id] }),
      client.readContract({ address: SPRITE_REGISTRY, abi, functionName: 'seedOf', args: [id] }),
    ]);
    const frames: bigint[] = [...await client.readContract({ address: SPRITE_REGISTRY, abi, functionName: 'frames', args: [familyId, seed] })].map((x: any) => BigInt(x));
    if (frames.length !== 64) throw new Error('registry returned unexpected frame count');
    try { localStorage.setItem(LS + tokenId, JSON.stringify({ f: Number(familyId), fr: frames.map(b => b.toString(16)) })); } catch { /* quota */ }
    return build(tokenId, Number(familyId), frames);
  })();
  p.catch(() => cache.delete(tokenId));
  cache.set(tokenId, p);
  return p;
}

/** Colossus (family 6) has no up/down frames: keep the last horizontal direction, like the SDK reader. */
export function spriteFrame(s: FriendSprites, facing: Facing, walking: boolean, frame: number, lastSide: 'left' | 'right') {
  const f: Facing = s.familyId === 6 && (facing === 'up' || facing === 'down') ? lastSide : facing;
  return s.clips[walking ? 'walk' : 'idle'][f][frame & 7];
}
