import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@coin-cast/core': fromRoot('./packages/core/src/index.ts'),
      '@coin-cast/http-utils': fromRoot('./packages/http-utils/src/index.ts'),
      '@coin-cast/market-crypto': fromRoot('./packages/market-crypto/src/index.ts'),
      '@coin-cast/market-stocks': fromRoot('./packages/market-stocks/src/index.ts'),
      '@coin-cast/news-gdelt': fromRoot('./packages/news-gdelt/src/index.ts'),
      '@coin-cast/notifications-telegram': fromRoot(
        './packages/notifications-telegram/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'node',
  },
});
