export type MarketAssetClass = 'crypto' | 'stock';

export type MarketAssetSegment = 'crypto' | 'stock' | 'etf';

export interface MarketAsset {
  id: string;
  symbol: string;
  name: string;
  aliases?: string[];
  assetClass: MarketAssetClass;
  marketSegment?: MarketAssetSegment;
  marketCapRank?: number;
  currentPriceUsd?: number;
  change24hPercent?: number;
  volume24hUsd?: number;
  marketPageUrl?: string;
  marketPageLabel?: string;
}
