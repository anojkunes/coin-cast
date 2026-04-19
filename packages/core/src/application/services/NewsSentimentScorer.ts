import type { MarketAsset } from '../../domain/models/MarketAsset';
import type { NewsFeed } from '../../domain/models/NewsFeed';

export interface AssetNewsSentiment {
  score: number;
  matchedHeadlines: string[];
}

const POSITIVE_TERMS = [
  'adoption',
  'approval',
  'breakout',
  'bull',
  'bullish',
  'gain',
  'growth',
  'launch',
  'milestone',
  'partnership',
  'rally',
  'record',
  'surge',
  'upgrade',
  'upside',
  'win',
];

const NEGATIVE_TERMS = [
  'bear',
  'bearish',
  'breach',
  'crash',
  'delay',
  'downgrade',
  'dump',
  'exploit',
  'fraud',
  'hack',
  'lawsuit',
  'liquidation',
  'plunge',
  'risk',
  'selloff',
  'scam',
];

const normalizeText = (value: string): string => value.toLowerCase();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const wordBoundaryPattern = (term: string): RegExp =>
  new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');

const sentimentFromText = (text: string): number => {
  const lowered = normalizeText(text);
  let score = 0;

  for (const term of POSITIVE_TERMS) {
    if (lowered.includes(term)) {
      score += 1;
    }
  }

  for (const term of NEGATIVE_TERMS) {
    if (lowered.includes(term)) {
      score -= 1;
    }
  }

  return Math.tanh(score / 3);
};

const relevanceForAsset = (headline: NewsFeed, asset: MarketAsset): number => {
  const combined = `${headline.title} ${headline.description}`.toLowerCase();
  const name = asset.name.toLowerCase();
  const symbol = asset.symbol.toLowerCase();

  if (combined.includes(name)) {
    return 1;
  }

  if (wordBoundaryPattern(symbol).test(combined)) {
    return 0.7;
  }

  return 0;
};

const recencyWeight = (publishedAt: number, now: number): number => {
  const hoursOld = Math.max(0, (now - publishedAt) / 3_600_000);
  return Math.exp(-hoursOld / 36);
};

export class NewsSentimentScorer {
  score(asset: MarketAsset, headlines: NewsFeed[]): AssetNewsSentiment {
    const now = Date.now();
    const matchedHeadlines: string[] = [];
    let weightedScore = 0;
    let totalWeight = 0;

    for (const headline of headlines) {
      const relevance = relevanceForAsset(headline, asset);
      if (relevance === 0) {
        continue;
      }

      const titleText = `${headline.title} ${headline.description}`;
      const headlineScore = sentimentFromText(titleText);
      const weight = relevance * recencyWeight(headline.publishedAt, now);

      matchedHeadlines.push(headline.title);
      weightedScore += headlineScore * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) {
      return { score: 0, matchedHeadlines: [] };
    }

    return {
      score: clamp(weightedScore / totalWeight, -1, 1),
      matchedHeadlines,
    };
  }
}
