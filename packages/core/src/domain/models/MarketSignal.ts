import type { MarketAssetClass } from './MarketAsset';

export type SignalDirection = 'bullish' | 'bearish';

export interface MarketSignal {
  assetId: string;
  assetClass: MarketAssetClass;
  symbol: string;
  name: string;
  direction: SignalDirection;
  confidence: number;
  fiveHourProbabilityUp: number;
  actionRecommendation: 'buy' | 'sell' | 'wait' | 'avoid';
  expectedDurationHours: number;
  expectedDurationLabel: string;
  tradeSuitabilityScore: number;
  tradeVerdict: 'good' | 'mixed' | 'avoid';
  modelProbabilityUp: number;
  newsScore: number;
  qualityScore: number;
  marketConditionScore: number;
  relativeStrengthScore: number;
  orderBookScore?: number;
  orderBookSpreadPercent?: number;
  orderBookImbalance?: number;
  priceUsd?: number;
  change24hPercent?: number;
  marketPageUrl?: string;
  marketPageLabel?: string;
  reasons: string[];
}
