import type { NewsFeed } from '../../domain/models/NewsFeed';

export interface NewsFeedRepository {
  getHeadlines(): Promise<NewsFeed[]>;
}
