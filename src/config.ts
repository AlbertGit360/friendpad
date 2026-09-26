// Friendpad configuration. Addresses below were verified on-chain (see README "Recon").

export const CHAIN = {
  id: 4663,
  hexId: '0x1237',
  name: 'Robinhood Chain',
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  explorerApi: 'https://robinhoodchain.blockscout.com/api/v2',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
} as const;

export const ADDR = {
  generations: '0x14c49e6118f46525de9ab41a51cbaa3c6ebf181d',
  genesis: '0x116eaa62241751e0c98da43d458600c6c17cd361',
  activationManager: '0xd4a35e11318e3679168d409184b788bcf9f283ac',
  rf: '0x0779369854d3ecdea927206718ffd7730c67b71f',
  weth: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  registry6551: '0x000000006551c19487814612e58FE06813775758',
  tbaImplementation: '0xED038886c002B285EB0f74971e967B02F6af8ea5',
} as const;

/** Placeholder address used in calldata for contracts that do not exist yet (simulated). */
export const SIM_CONTRACT = '0x000000000000000000000000000000000000f00d' as const;

/** Pixel grid per generation (Gen-1 is the rarest and gets the sharpest image). */
/** Drawing tier 0 = Genesis: the sharpest grid and the only tier drawn in colour. */
export const GRID_BY_GEN: Record<number, number> = { 0: 128, 1: 96, 2: 72, 3: 56, 4: 44, 5: 34, 6: 26 };
/** Genesis Friends (1,000,000 RF denomination, reward weight ×2) draw at the Genesis tier. */
export const GENESIS_GEN = 0;
export const tierName = (g: number) => (g === 0 ? 'Genesis' : `Gen-${g}`);
/** Genesis colour palette: FriendSDK GAME_PALETTE + the collection's mono and signal green + three shading tones. */
export const GENESIS_PALETTE = ['#000000', '#F4F4F0', '#CCFF00', '#B9D984', '#7DB4DB', '#F2CE68', '#ED927E', '#B3A0D8', '#4A4A47', '#9A9A96', '#7A4A3A', '#2F4F7F', '#4F7F3A'];

export const ECON = {
  launchFeeRF: 100,
  launchBurnShare: 0.5, // "Proof of Burn": 50% burned, 50% seeds the token's Friend-dividend pool (mirrors ActivationManager._pay)
  /** Fixed platform fee, charged on every trade ON TOP of the creator-set tax. */
  platformFee: 0.001,
  /** Creator-set tax bounds. 5% cap prevents honeypot-style sell taxes. */
  maxTax: 0.05,
  /** Friend dividends + RF burn must be at least this share of the creator-set tax. */
  ecosystemFloor: 0.25,
  /** Warn on token cards above this tax. */
  warnTax: 0.03,
  /** Optional creator buy at launch: at most this share of total supply (untaxed, first trade on the curve). */
  creatorBuyMaxShare: 0.20,
  creatorLockDays: [0, 1, 7, 30] as readonly number[],
  /** Simulated RF price used to convert WETH tax into RF. */
  rfPerWeth: 400_000,
  // Bonding curve (constant product with virtual reserves, pump-style)
  totalSupply: 1_000_000_000,
  curveSupply: 800_000_000,
  virtualWeth: 3,
  virtualTokens: 1_073_000_000,
  graduationWeth: 12, // "graduates" to DEX in production (future work)
  defaultMinDividendBalance: 1_000_000, // tokens a Friend wallet must hold to earn dividends
  holderMapTopN: 18,
} as const;

/** Reward-weight multiplier for dividends: 1x … ~2x, log-scaled on the Friend's on-chain reward weight (RF). */
export function weightMultiplier(rewardWeightRF: number): number {
  if (!rewardWeightRF || rewardWeightRF <= 0) return 1;
  return 1 + Math.min(1, Math.log10(1 + rewardWeightRF) / 6);
}

export const STORAGE_KEY = 'friendpad.sim.v1';

/** Per-token tax, fixed at launch. Rates are fractions of trade volume; allocation fractions sum to 1. */
export interface TaxConfig {
  buy: number;
  sell: number;
  alloc: { dividends: number; creator: number; burn: number };
}
/** Default: 1% buy / 1% sell creator tax (+ 0.1% platform on top), split 40% Friend dividends / 30% creator / 30% burn. */
export const DEFAULT_TAX: TaxConfig = { buy: 0.01, sell: 0.01, alloc: { dividends: 0.4, creator: 0.3, burn: 0.3 } };
export const TAX_PRESETS: Record<string, TaxConfig> = {
  balanced: DEFAULT_TAX,
  'burn-heavy': { buy: 0.02, sell: 0.02, alloc: { dividends: 0.2, creator: 0.2, burn: 0.6 } },
  'dividend-heavy': { buy: 0.02, sell: 0.02, alloc: { dividends: 0.7, creator: 0.2, burn: 0.1 } },
  'no tax': { buy: 0, sell: 0, alloc: { dividends: 0.4, creator: 0.3, burn: 0.3 } },
};
/** Returns an error message, or '' when the config is valid. */
export function taxError(c: TaxConfig): string {
  if (c.buy < 0 || c.sell < 0 || c.buy > ECON.maxTax + 1e-9 || c.sell > ECON.maxTax + 1e-9) return `Taxes must be between 0% and ${ECON.maxTax * 100}%`;
  if (c.buy === 0 && c.sell === 0) return '';
  const total = c.alloc.dividends + c.alloc.creator + c.alloc.burn;
  if (Math.abs(total - 1) > 1e-6) return `Allocation must total 100% (now ${Math.round(total * 100)}%)`;
  if (c.alloc.dividends + c.alloc.burn < ECON.ecosystemFloor - 1e-9) return `Friend dividends + RF burn must be at least ${ECON.ecosystemFloor * 100}% of the tax`;
  return '';
}
export const pct = (x: number, d = 1) => `${+(x * 100).toFixed(d)}%`;
