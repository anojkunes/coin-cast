import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GdeltNewsFeedRepository } from '../src/index';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedGet = vi.mocked(axios.get);

describe('GdeltNewsFeedRepository', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('loads JSONFeed headlines and deduplicates them across queries', async () => {
    mockedGet
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              title: 'Bitcoin rallies after partnership milestone',
              url: 'https://example.com/article-a',
              content_text: 'The market sees a bullish breakout.',
              date_published: '2026-04-10T10:00:00Z',
              authors: [{ name: 'Reporter One' }],
            },
            {
              title: 'Duplicate article',
              url: 'https://example.com/article-a',
              content_text: 'Should be deduplicated.',
              date_published: '2026-04-10T10:05:00Z',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          articles: [
            {
              title: 'Ethereum faces a hack scare',
              external_url: 'https://example.com/article-b',
              summary: 'A negative crypto headline.',
              date_published: '2026-04-10T11:00:00Z',
              author: 'Reporter Two',
            },
          ],
        },
      });

    const repository = new GdeltNewsFeedRepository(
      'https://example.com/gdelt',
      '24h',
      25,
      2,
      1,
      2,
      ['query-one', 'query-two'],
    );

    const headlines = await repository.getHeadlines();

    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(headlines).toHaveLength(2);
    expect(headlines[0]).toMatchObject({
      title: 'Ethereum faces a hack scare',
      link: 'https://example.com/article-b',
      author: 'Reporter Two',
      description: 'A negative crypto headline.',
      publishedAt: new Date('2026-04-10T11:00:00Z').getTime(),
    });
    expect(headlines[1]).toMatchObject({
      title: 'Bitcoin rallies after partnership milestone',
      link: 'https://example.com/article-a',
      author: 'Reporter One',
      description: 'The market sees a bullish breakout.',
      publishedAt: new Date('2026-04-10T10:00:00Z').getTime(),
    });
    expect(mockedGet.mock.calls[0]?.[1]).toMatchObject({
      params: {
        query: 'query-one',
        mode: 'artlist',
        format: 'jsonfeed',
        timespan: '24h',
        maxrecords: 25,
        sort: 'datedesc',
      },
    });
  });

  it('retries on 429 responses with exponential backoff', async () => {
    const retryError = {
      isAxiosError: true,
      response: { status: 429 },
      message: 'Too Many Requests',
    };

    mockedGet
      .mockRejectedValueOnce(retryError)
      .mockRejectedValueOnce(retryError)
      .mockResolvedValue({
        data: {
          items: [
            {
              title: 'Bitcoin rally after listing',
              url: 'https://example.com/retry',
              content_text: 'Recovered after retries.',
              date_published: '2026-04-10T12:00:00Z',
            },
          ],
        },
      });

    const repository = new GdeltNewsFeedRepository(
      'https://example.com/gdelt',
      '24h',
      25,
      3,
      1,
      2,
      ['query-one'],
    );

    const headlines = await repository.getHeadlines();

    expect(mockedGet).toHaveBeenCalledTimes(3);
    expect(headlines).toHaveLength(1);
    expect(headlines[0]?.title).toBe('Bitcoin rally after listing');
  });
});
