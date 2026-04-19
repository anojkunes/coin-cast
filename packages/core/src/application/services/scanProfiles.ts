import type { MarketAsset, MarketAssetClass } from '../../domain/models/MarketAsset';

export interface SignalScanProfile {
  assetClass: MarketAssetClass;
  marketDisplayName: string;
  assetNounSingular: string;
  assetNounPlural: string;
  benchmarkDisplayLabel: string;
  benchmarkPrimary: MarketAsset;
  benchmarkSecondary: MarketAsset;
}

export const cryptoScanProfile: SignalScanProfile = {
  assetClass: 'crypto',
  marketDisplayName: 'Crypto',
  assetNounSingular: 'coin',
  assetNounPlural: 'coins',
  benchmarkDisplayLabel: 'BTC and ETH',
  benchmarkPrimary: {
    id: 'XXBTZUSD',
    symbol: 'BTC',
    name: 'Bitcoin',
    assetClass: 'crypto',
    marketSegment: 'crypto',
  },
  benchmarkSecondary: {
    id: 'XETHZUSD',
    symbol: 'ETH',
    name: 'Ethereum',
    assetClass: 'crypto',
    marketSegment: 'crypto',
  },
};

export const stockScanProfile: SignalScanProfile = {
  assetClass: 'stock',
  marketDisplayName: 'Stocks',
  assetNounSingular: 'stock',
  assetNounPlural: 'stocks',
  benchmarkDisplayLabel: 'SPY and QQQ',
  benchmarkPrimary: {
    id: 'SPY',
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    assetClass: 'stock',
    marketSegment: 'etf',
  },
  benchmarkSecondary: {
    id: 'QQQ',
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust',
    assetClass: 'stock',
    marketSegment: 'etf',
  },
};
