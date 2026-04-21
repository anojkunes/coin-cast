import { describe, expect, it } from 'vitest';

import type { MarketAsset, NewsFeed } from '../src/index';
import { NewsSentimentScorer } from '../src/index';

const scorer = new NewsSentimentScorer();

const createHeadline = (title: string, description = ''): NewsFeed => ({
  title,
  description,
  author: 'Test',
  link: 'https://example.com',
  publishedAt: Date.now(),
});

describe('NewsSentimentScorer', () => {
  it('matches crypto news by canonical name aliases', () => {
    const asset: MarketAsset = {
      id: 'LINKUSD',
      symbol: 'LINK',
      name: 'Chainlink',
      aliases: ['LINK', 'Chainlink'],
      assetClass: 'crypto',
      marketSegment: 'crypto',
    };

    const result = scorer.score(asset, [
      createHeadline(
        'Chainlink partnership expands institutional adoption',
        'A bullish launch for the oracle network.',
      ),
    ]);

    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedHeadlines).toHaveLength(1);
  });

  it('does not match lowercase common words to uppercase crypto tickers', () => {
    const asset: MarketAsset = {
      id: 'LINKUSD',
      symbol: 'LINK',
      name: 'Chainlink',
      aliases: ['LINK', 'Chainlink'],
      assetClass: 'crypto',
      marketSegment: 'crypto',
    };

    const result = scorer.score(asset, [
      createHeadline(
        'The link between rates and inflation is weakening',
        'A macro note unrelated to crypto assets.',
      ),
    ]);

    expect(result.score).toBe(0);
    expect(result.matchedHeadlines).toHaveLength(0);
  });

  it('matches uppercase ticker aliases when a headline uses a non-Kraken ticker form', () => {
    const asset: MarketAsset = {
      id: 'XXBTZUSD',
      symbol: 'XBT',
      name: 'Bitcoin',
      aliases: ['XBT', 'BTC', 'Bitcoin'],
      assetClass: 'crypto',
      marketSegment: 'crypto',
    };

    const result = scorer.score(asset, [
      createHeadline(
        'BTC rally extends after crypto approval',
        'Bitcoin sees another bullish surge.',
      ),
    ]);

    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedHeadlines).toHaveLength(1);
  });

  it('matches title-cased crypto ticker mentions when nearby crypto context is present', () => {
    const asset: MarketAsset = {
      id: 'ADAUSD',
      symbol: 'ADA',
      name: 'Cardano',
      aliases: ['ADA', 'Cardano'],
      assetClass: 'crypto',
      marketSegment: 'crypto',
    };

    const result = scorer.score(asset, [
      createHeadline(
        'Ada coin surges after exchange partnership',
        'The token sees another bullish upgrade.',
      ),
    ]);

    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedHeadlines).toHaveLength(1);
  });

  it('does not match title-cased human names without crypto context', () => {
    const asset: MarketAsset = {
      id: 'ADAUSD',
      symbol: 'ADA',
      name: 'Cardano',
      aliases: ['ADA', 'Cardano'],
      assetClass: 'crypto',
      marketSegment: 'crypto',
    };

    const result = scorer.score(asset, [
      createHeadline(
        'Ada Lovelace biography wins publishing award',
        'A new release explores her life and work.',
      ),
    ]);

    expect(result.score).toBe(0);
    expect(result.matchedHeadlines).toHaveLength(0);
  });
});
