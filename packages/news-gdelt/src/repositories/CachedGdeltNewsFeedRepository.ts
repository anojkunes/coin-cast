import { readFile } from 'node:fs/promises';

import { createLogger, type NewsFeed, type NewsFeedRepository } from '@coin-cast/core';

interface CachedHeadlinesArtifact {
  market?: string;
  fetchedAt?: string;
  headlines?: NewsFeed[];
}

const isNewsFeed = (value: unknown): value is NewsFeed => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<NewsFeed>;
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.author === 'string' &&
    typeof candidate.link === 'string' &&
    typeof candidate.publishedAt === 'number'
  );
};

const sortByNewest = (headlines: NewsFeed[]): NewsFeed[] =>
  [...headlines].sort((left, right) => right.publishedAt - left.publishedAt);

export class CachedGdeltNewsFeedRepository implements NewsFeedRepository {
  private readonly logger = createLogger('cached-gdelt-news-feed-repository');

  constructor(private readonly artifactPath: string) {}

  async getHeadlines(): Promise<NewsFeed[]> {
    try {
      const contents = await readFile(this.artifactPath, 'utf8');
      const parsed = JSON.parse(contents) as CachedHeadlinesArtifact | NewsFeed[];
      const headlines = Array.isArray(parsed)
        ? parsed.filter(isNewsFeed)
        : (parsed.headlines ?? []).filter(isNewsFeed);

      this.logger.info('Loaded cached GDELT headlines', {
        artifactPath: this.artifactPath,
        headlines: headlines.length,
      });

      return sortByNewest(headlines);
    } catch (error) {
      this.logger.error('Failed to read cached GDELT headlines', {
        artifactPath: this.artifactPath,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
