// Minimal type shim: viem is loaded at runtime from a pinned CDN build (see index.html import map).
declare module 'viem' {
  export type Address = `0x${string}`;
  export type Hex = `0x${string}`;
  export function createPublicClient(opts: any): any;
  export function http(url?: string, opts?: any): any;
  export function encodeFunctionData(opts: { abi: readonly any[]; functionName: string; args?: readonly any[] }): Hex;
  export function parseAbi(sigs: readonly string[]): readonly any[];
  export function getAddress(a: string): Address;
  export function isAddress(a: string): boolean;
  export function parseUnits(v: string, d: number): bigint;
  export function formatUnits(v: bigint, d: number): string;
  export function defineChain(c: any): any;
}
