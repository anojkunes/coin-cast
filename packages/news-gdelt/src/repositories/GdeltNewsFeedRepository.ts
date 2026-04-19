import axios from 'axios';

import { createLogger, type NewsFeed, type NewsFeedRepository } from '@coin-cast/core';
import { retryWithBackoff, sharedHttpAgentOptions } from '@coin-cast/http-utils';

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const parseTimestamp = (value: unknown): number => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const defaultQueries = [
  '("crypto" OR cryptocurrency OR blockchain OR token OR altcoin OR web3 OR memecoin OR "meme coin" OR DeFi)',
  '(("hack" OR exploit OR listing OR delisting OR partnership OR launch OR approval OR lawsuit OR airdrop) AND (crypto OR cryptocurrency OR blockchain OR token OR coin))',
];

interface JsonFeedAuthor {
  name?: string;
}

interface JsonFeedItem {
  title?: string;
  url?: string;
  external_url?: string;
  content_text?: string;
  content_html?: string;
  summary?: string;
  date_published?: string;
  date_modified?: string;
  author?: string | JsonFeedAuthor;
  authors?: JsonFeedAuthor[];
}

interface GdeltJsonFeedResponse {
  items?: JsonFeedItem[];
  articles?: JsonFeedItem[];
}

export class GdeltNewsFeedRepository implements NewsFeedRepository {
  private readonly logger = createLogger('gdelt-news-feed-repository');

  constructor(
    private readonly baseUrl = process.env.GDELT_BASE_URL || 'https://api.gdeltproject.org/api/v2/doc/doc',
    private readonly timespan = process.env.GDELT_TIMESPAN || '24h',
    private readonly maxRecords = Number(process.env.GDELT_MAX_RECORDS || 50),
    private readonly maxRetries = Number(process.env.API_RETRY_MAX_ATTEMPTS || 10),
    private readonly initialDelayMs = Number(process.env.API_RETRY_INITIAL_DELAY_MS || 1_000),
    private readonly maxDelayMs = Number(process.env.API_RETRY_MAX_DELAY_MS || 30_000),
    private readonly queries = defaultQueries,
  ) {}

  async getHeadlines(): Promise<NewsFeed[]> {
    if (!this.baseUrl) {
      return [];
    }

    this.logger.info('Loading GDELT headlines', {
      baseUrl: this.baseUrl,
      queries: this.queries.length,
      timespan: this.timespan,
      maxRecords: this.maxRecords,
    });

    try {
      const queryResults = await Promise.all(this.queries.map((query) => this.fetchQuery(query)));
      const headlines: NewsFeed[] = [];
      const seen = new Set<string>();

      for (const result of queryResults) {
        for (const item of result) {
          const key = normalizeKey(item.link || item.title);
          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          headlines.push(item);
        }
      }

      const results = headlines.sort((left, right) => right.publishedAt - left.publishedAt);
      this.logger.info('GDELT headlines loaded', {
        headlines: results.length,
      });

      return results;
    } catch (error) {
      this.logger.error('Failed to load GDELT headlines', {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async fetchQuery(query: string): Promise<NewsFeed[]> {
    const response = await retryWithBackoff(
      () =>
        axios.get<GdeltJsonFeedResponse>(this.baseUrl, {
          params: {
            query,
            mode: 'artlist',
            format: 'jsonfeed',
            timespan: this.timespan,
            maxrecords: this.maxRecords,
            sort: 'datedesc',
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; CoinCastBot/1.0)',
            Accept: 'application/feed+json, application/json;q=0.9, */*;q=0.8',
          },
          ...sharedHttpAgentOptions,
          timeout: 15_000,
        }),
      {
        context: `GDELT news query`,
        maxAttempts: this.maxRetries,
        initialDelayMs: this.initialDelayMs,
        maxDelayMs: this.maxDelayMs,
      },
    );

    const items = toArray(response.data?.items ?? response.data?.articles);

    return items
      .map((item) => this.toNewsFeed(item))
      .filter((item): item is NewsFeed => item != null);
  }

  private toNewsFeed(item: JsonFeedItem): NewsFeed | null {
    const title = (item.title ?? '').trim();
    const link = (item.url ?? item.external_url ?? '').trim();
    if (!title || !link) {
      return null;
    }

    const description = stripHtml(
      (item.summary ?? item.content_text ?? item.content_html ?? '').toString(),
    );

    return {
      title,
      link,
      author: this.readAuthor(item),
      publishedAt: parseTimestamp(item.date_published ?? item.date_modified),
      description,
    };
  }

  private readAuthor(item: JsonFeedItem): string {
    if (Array.isArray(item.authors)) {
      const authors = item.authors.map((author) => (author?.name ?? '').trim()).filter(Boolean);
      if (authors.length > 0) {
        return authors.join(', ');
      }
    }

    if (typeof item.author === 'string') {
      return item.author.trim();
    }

    return (item.author?.name ?? '').trim();
  }
}
