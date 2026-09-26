// The bridge: REAL calldata for the Friend's ERC-6551 wallet. Built with viem, shown to the user, never sent.
import { encodeFunctionData, parseAbi, parseUnits } from 'viem';
import { ADDR, SIM_CONTRACT } from './config.js';
import { erc20Abi, tbaAbi } from './chain.js';

const friendpadAbi = parseAbi([
  'function claimDividends(address token) returns (uint256)',
  'function sell(address token, uint256 amount, uint256 minWethOut) returns (uint256)',
]);

export interface TxPreview {
  title: string;
  from: string; // who must send it (the NFT owner — only owner() may call execute)
  to: string; // the Friend's wallet (TBA)
  value: string;
  data: string;
  decoded: string[];
  notes: string[];
}

const amt = (x: number, d = 18) => parseUnits(x.toFixed(Math.min(d, 18)), d);

function execute(target: string, inner: `0x${string}`) {
  return encodeFunctionData({ abi: tbaAbi, functionName: 'execute', args: [target, 0n, inner, 0] });
}

/** Creator fees: WETH sitting in the Friend wallet → owner. Fully real contracts (WETH + TokenBoundAccount). */
export function claimCreatorFees(tba: string, owner: string, weth: number): TxPreview {
  const inner = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [owner, amt(weth)] });
  return {
    title: 'Claim creator fees (WETH)',
    from: owner, to: tba, value: '0', data: execute(ADDR.weth, inner),
    decoded: [
      `TokenBoundAccount(${tba}).execute(`,
      `  to        = ${ADDR.weth}  // WETH on Robinhood Chain`,
      `  value     = 0`,
      `  data      = transfer(${owner}, ${amt(weth)})`,
      `  operation = 0  // CALL (the only supported operation)`,
      `)`,
    ],
    notes: [
      'Real contracts: WETH and the Friend\'s ERC-6551 wallet. Only owner() == ownerOf(tokenId) may call execute.',
      'In the MVP the WETH balance is simulated, so this transaction would revert today. It would be sent in production.',
    ],
  };
}

/** Friend-only dividends: the Friend wallet claims RF from the (future) Friendpad contract. */
export function claimDividendsTx(tba: string, owner: string): TxPreview {
  const inner = encodeFunctionData({ abi: friendpadAbi, functionName: 'claimDividends', args: [SIM_CONTRACT] });
  return {
    title: 'Claim RF dividends into the Friend wallet',
    from: owner, to: tba, value: '0', data: execute(SIM_CONTRACT, inner),
    decoded: [
      `TokenBoundAccount(${tba}).execute(`,
      `  to        = ${SIM_CONTRACT}  // Friendpad dividend contract (SIMULATED address)`,
      `  value     = 0`,
      `  data      = claimDividends(token)`,
      `  operation = 0`,
      `)`,
    ],
    notes: ['Mirrors ActivationManager.claim(): rewards are paid to the Friend\'s own wallet, not to the human.', 'Friendpad contracts do not exist yet — target address is a placeholder.'],
  };
}

/** Withdraw RF from the Friend wallet to the owner (real RF + real TBA). */
export function withdrawRF(tba: string, owner: string, rf: number): TxPreview {
  const inner = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [owner, amt(rf)] });
  return {
    title: 'Withdraw RF from the Friend wallet',
    from: owner, to: tba, value: '0', data: execute(ADDR.rf, inner),
    decoded: [
      `TokenBoundAccount(${tba}).execute(`,
      `  to        = ${ADDR.rf}  // $RAREFRIENDS`,
      `  value     = 0`,
      `  data      = transfer(${owner}, ${amt(rf)})`,
      `  operation = 0`,
      `)`,
    ],
    notes: ['Real contracts. RF balance shown in Friendpad is simulated, so it would be sent in production.'],
  };
}

/** Move meme tokens from the human wallet into the Friend wallet (plain ERC-20 transfer, no execute needed). */
export function moveToFriend(owner: string, tba: string, tokens: number): TxPreview {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [tba, amt(tokens)] });
  return {
    title: 'Move tokens to the Friend wallet',
    from: owner, to: SIM_CONTRACT, value: '0', data,
    decoded: [`MemeToken(${SIM_CONTRACT}).transfer(`, `  to     = ${tba}  // Friend wallet (ERC-6551)`, `  amount = ${amt(tokens)}`, `)`],
    notes: ['Anyone can send tokens to a Friend wallet. Only tokens held by a Friend wallet earn Friend-only dividends.', 'Meme token address is simulated.'],
  };
}

/** Sell tokens held by the Friend wallet on the curve (owner drives the Friend wallet via execute). */
export function sellFromFriend(tba: string, owner: string, tokens: number, minOut: number): TxPreview {
  const inner = encodeFunctionData({ abi: friendpadAbi, functionName: 'sell', args: [SIM_CONTRACT, amt(tokens), amt(minOut)] });
  return {
    title: 'Sell from the Friend wallet',
    from: owner, to: tba, value: '0', data: execute(SIM_CONTRACT, inner),
    decoded: [
      `TokenBoundAccount(${tba}).execute(`,
      `  to        = ${SIM_CONTRACT}  // Friendpad curve (SIMULATED address)`,
      `  value     = 0`,
      `  data      = sell(token, ${amt(tokens)}, minOut=${amt(minOut)})`,
      `  operation = 0`,
      `)`,
    ],
    notes: ['WETH proceeds land in the Friend wallet; withdraw them with a WETH transfer execute().'],
  };
}

/** Move meme tokens out of the Friend wallet back to the owner (owner drives the Friend wallet via execute). */
export function moveFromFriend(tba: string, owner: string, tokens: number): TxPreview {
  const inner = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [owner, amt(tokens)] });
  return {
    title: 'Move tokens out of the Friend wallet',
    from: owner, to: tba, value: '0', data: execute(SIM_CONTRACT, inner),
    decoded: [
      `TokenBoundAccount(${tba}).execute(`,
      `  to        = ${SIM_CONTRACT}  // meme token (SIMULATED address)`,
      `  value     = 0`,
      `  data      = transfer(${owner}, ${amt(tokens)})`,
      `  operation = 0`,
      `)`,
    ],
    notes: ['Tokens that leave the Friend wallet stop earning Friend dividends.', 'Creator-buy tokens cannot be moved out while locked.'],
  };
}
