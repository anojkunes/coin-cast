import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CachedGdeltNewsFeedRepository } from '../src/index';

describe('CachedGdeltNewsFeedRepository', () => {
  it('loads cached headlines from an artifact file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coin-cast-gdelt-'));
    const artifactPath = join(directory, 'headlines.json');

    await writeFile(
      artifactPath,
      JSON.stringify({
        market: 'crypto',
        fetchedAt: '2026-04-21T12:00:00.000Z',
        headlines: [
          {
            title: 'Older headline',
            description: 'First headline',
            author: 'Reporter A',
            link: 'https://example.com/older',
            publishedAt: new Date('2026-04-21T10:00:00Z').getTime(),
          },
          {
            title: 'Newer headline',
            description: 'Second headline',
            author: 'Reporter B',
            link: 'https://example.com/newer',
            publishedAt: new Date('2026-04-21T11:00:00Z').getTime(),
          },
        ],
      }),
      'utf8',
    );

    const repository = new CachedGdeltNewsFeedRepository(artifactPath);
    const headlines = await repository.getHeadlines();

    expect(headlines).toHaveLength(2);
    expect(headlines.map((headline) => headline.title)).toEqual(['Newer headline', 'Older headline']);
  });

  it('returns an empty list when the artifact is unavailable', async () => {
    const repository = new CachedGdeltNewsFeedRepository('/tmp/does-not-exist-headlines.json');
    await expect(repository.getHeadlines()).resolves.toEqual([]);
  });
});
