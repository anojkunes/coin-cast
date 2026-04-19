import type { MarketAssetClass } from '@coin-cast/core';

const marketAliases: Record<string, MarketAssetClass> = {
  crypto: 'crypto',
  stock: 'stock',
  stocks: 'stock',
};

export const parseMarketRunMode = (
  marketArgument = process.argv.slice(2)[0],
): MarketAssetClass => {
  const normalizedArgument = marketArgument?.trim().toLowerCase();

  if (!normalizedArgument) {
    throw new Error(
      "Missing market run mode. Use 'crypto' or 'stock'. Try `npm run dev:crypto` or `npm run dev:stocks`.",
    );
  }

  const marketRunMode = marketAliases[normalizedArgument];
  if (!marketRunMode) {
    throw new Error(
      `Unsupported market run mode: ${marketArgument}. Use 'crypto' or 'stock'.`,
    );
  }

  return marketRunMode;
};
