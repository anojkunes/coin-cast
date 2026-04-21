import nlp from 'compromise';

import type { MarketAsset } from '../../domain/models/MarketAsset';
import type { NewsFeed } from '../../domain/models/NewsFeed';

export interface AssetNewsSentiment {
  score: number;
  matchedHeadlines: string[];
}

interface ParsedHeadlineTerm {
  raw: string;
  normalized: string;
  tags: Set<string>;
}

interface HeadlineCandidate {
  raw: string;
  normalized: string;
  entityLike: boolean;
  cryptoContext: boolean;
  uppercaseTicker: boolean;
}

interface HeadlineAnalysis {
  rawCombined: string;
  normalizedCombined: string;
  candidatesByNormalized: Map<string, HeadlineCandidate[]>;
}

interface CompromiseTerm {
  text?: string;
  tags?: string[];
}

interface CompromiseSentence {
  terms?: CompromiseTerm[];
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

const CRYPTO_CONTEXT_TERMS = new Set([
  'airdrop',
  'blockchain',
  'chain',
  'coin',
  'crypto',
  'dao',
  'defi',
  'exchange',
  'layer',
  'mainnet',
  'mining',
  'network',
  'nft',
  'oracle',
  'protocol',
  'staking',
  'token',
  'wallet',
  'web3',
]);

const ENTITY_TAGS = new Set([
  'Acronym',
  'Actor',
  'Currency',
  'Organization',
  'Person',
  'ProperNoun',
]);

const normalizeText = (value: string): string => value.toLowerCase();

const normalizeForPhraseMatch = (value: string): string =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wordBoundaryPattern = (term: string): RegExp =>
  new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');

const upperSymbolPattern = (term: string): RegExp =>
  new RegExp(`(^|[^A-Z0-9])${escapeRegExp(term)}([^A-Z0-9]|$)`);

const phraseBoundaryPattern = (term: string): RegExp =>
  new RegExp(`(^| )${escapeRegExp(term).replace(/ /g, ' +')}( |$)`, 'i');

const isTickerAlias = (value: string): boolean =>
  /^[A-Z0-9]{2,12}$/.test(value.trim());

const isTitleCaseToken = (value: string): boolean =>
  /^[A-Z][a-z0-9]{1,15}$/.test(value.trim());

const hasEntityTags = (tags: Set<string>): boolean =>
  Array.from(ENTITY_TAGS).some((tag) => tags.has(tag));

const collectAssetAliases = (asset: MarketAsset): string[] => {
  const aliases: string[] = [];
  const seen = new Set<string>();

  for (const value of [asset.name, ...(asset.aliases ?? [])]) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    aliases.push(trimmed);
  }

  return aliases;
};

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

const fallbackTickerRelevance = (
  alias: string,
  asset: MarketAsset,
  analysis: HeadlineAnalysis,
): number => {
  const normalizedAlias = normalizeForPhraseMatch(alias);
  if (!normalizedAlias) {
    return 0;
  }

  const candidates = analysis.candidatesByNormalized.get(normalizedAlias) ?? [];
  let strongest = 0;

  for (const candidate of candidates) {
    if (!candidate.cryptoContext) {
      continue;
    }

    if (!candidate.entityLike && !candidate.uppercaseTicker) {
      continue;
    }

    strongest = Math.max(strongest, alias === asset.symbol ? 0.45 : 0.4);
  }

  return strongest;
};

const relevanceForAsset = (
  asset: MarketAsset,
  analysis: HeadlineAnalysis,
): number => {
  const aliases = collectAssetAliases(asset);

  let strongest = 0;

  for (const alias of aliases) {
    if (isTickerAlias(alias)) {
      if (upperSymbolPattern(alias).test(analysis.rawCombined)) {
        strongest = Math.max(strongest, alias === asset.symbol ? 0.7 : 0.65);
        continue;
      }

      if (asset.assetClass === 'crypto') {
        strongest = Math.max(strongest, fallbackTickerRelevance(alias, asset, analysis));
      }

      continue;
    }

    const normalizedAlias = normalizeForPhraseMatch(alias);
    if (!normalizedAlias) {
      continue;
    }

    if (phraseBoundaryPattern(normalizedAlias).test(analysis.normalizedCombined)) {
      strongest = Math.max(strongest, alias === asset.name ? 1 : 0.9);
      continue;
    }

    if (
      normalizedAlias.includes(' ') &&
      wordBoundaryPattern(normalizedAlias).test(analysis.normalizedCombined)
    ) {
      strongest = Math.max(strongest, alias === asset.name ? 1 : 0.9);
    }
  }

  return strongest;
};

const recencyWeight = (publishedAt: number, now: number): number => {
  const hoursOld = Math.max(0, (now - publishedAt) / 3_600_000);
  return Math.exp(-hoursOld / 36);
};

export class NewsSentimentScorer {
  private readonly headlineAnalysisCache = new Map<string, HeadlineAnalysis>();

  private analyzeHeadline(headline: NewsFeed): HeadlineAnalysis {
    const cacheKey = `${headline.publishedAt}|${headline.title}|${headline.description}`;
    const cached = this.headlineAnalysisCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const rawCombined = `${headline.title} ${headline.description}`;
    const normalizedCombined = normalizeForPhraseMatch(rawCombined);
    const sentences = nlp(rawCombined).json() as CompromiseSentence[];
    const terms: ParsedHeadlineTerm[] = sentences.flatMap((sentence) =>
      (sentence.terms ?? [])
        .map((term) => {
          const raw = term.text?.trim() ?? '';
          const normalized = normalizeForPhraseMatch(raw);
          if (!raw || !normalized) {
            return null;
          }

          return {
            raw,
            normalized,
            tags: new Set(term.tags ?? []),
          };
        })
        .filter((term): term is ParsedHeadlineTerm => term !== null),
    );

    const candidatesByNormalized = new Map<string, HeadlineCandidate[]>();

    for (let index = 0; index < terms.length; index += 1) {
      const term = terms[index];
      const windowStart = Math.max(0, index - 2);
      const windowEnd = Math.min(terms.length - 1, index + 2);
      const cryptoContext = terms
        .slice(windowStart, windowEnd + 1)
        .some((windowTerm, windowIndex) => {
          if (windowStart + windowIndex === index) {
            return false;
          }

          return CRYPTO_CONTEXT_TERMS.has(windowTerm.normalized);
        });
      const uppercaseTicker = isTickerAlias(term.raw);
      const entityLike = uppercaseTicker || isTitleCaseToken(term.raw) || hasEntityTags(term.tags);

      if (!entityLike && !cryptoContext) {
        continue;
      }

      const existing = candidatesByNormalized.get(term.normalized) ?? [];
      existing.push({
        raw: term.raw,
        normalized: term.normalized,
        entityLike,
        cryptoContext,
        uppercaseTicker,
      });
      candidatesByNormalized.set(term.normalized, existing);
    }

    const analysis = {
      rawCombined,
      normalizedCombined,
      candidatesByNormalized,
    };

    if (this.headlineAnalysisCache.size >= 2_048) {
      this.headlineAnalysisCache.clear();
    }

    this.headlineAnalysisCache.set(cacheKey, analysis);
    return analysis;
  }

  score(asset: MarketAsset, headlines: NewsFeed[]): AssetNewsSentiment {
    const now = Date.now();
    const matchedHeadlines: string[] = [];
    let weightedScore = 0;
    let totalWeight = 0;

    for (const headline of headlines) {
      const analysis = this.analyzeHeadline(headline);
      const relevance = relevanceForAsset(asset, analysis);
      if (relevance === 0) {
        continue;
      }

      const headlineScore = sentimentFromText(analysis.rawCombined);
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
