const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export interface RetryOptions {
  context: string;
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

interface RetryableHttpError {
  response?: {
    status?: number;
    headers?: Record<string, string | string[] | undefined>;
  };
}

const isRetryableStatus = (status: number | undefined): boolean =>
  status === 429 || (status != null && status >= 500);

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const status =
      'response' in error && typeof (error as RetryableHttpError).response?.status === 'number'
        ? (error as RetryableHttpError).response?.status
        : undefined;
    const message = 'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : undefined;

    return [message, status != null ? `status ${status}` : undefined].filter(Boolean).join(' | ') || '[unknown error]';
  }

  return String(error);
};

const readRetryAfterMs = (error: unknown, fallbackDelayMs: number): number => {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return fallbackDelayMs;
  }

  const retryAfter = (error as RetryableHttpError).response?.headers?.['retry-after'];
  const value = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
  const parsedSeconds = Number(value);

  if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
    return parsedSeconds * 1000;
  }

  return fallbackDelayMs;
};

export const retryWithBackoff = async <T>(
  request: () => Promise<T>,
  options: RetryOptions,
): Promise<T> => {
  const attempts = Math.max(1, Math.floor(options.maxAttempts));
  const initialDelayMs = Math.max(0, options.initialDelayMs);
  const maxDelayMs = Math.max(initialDelayMs, options.maxDelayMs);

  let delayMs = initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      const status =
        typeof error === 'object' && error !== null && 'response' in error
          ? Number((error as RetryableHttpError).response?.status)
          : undefined;
      const retryable = status == null || isRetryableStatus(status);

      if (!retryable || attempt === attempts) {
        break;
      }

      const nextDelayMs = Math.min(readRetryAfterMs(error, delayMs), maxDelayMs);
      console.warn(`${options.context} failed with status ${status ?? 'network'}; retrying in ${nextDelayMs}ms (attempt ${attempt}/${attempts})`);
      await sleep(nextDelayMs);
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }

  throw new Error(formatError(lastError));
};
