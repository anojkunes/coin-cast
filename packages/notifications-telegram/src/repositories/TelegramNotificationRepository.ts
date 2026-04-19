import axios, { type AxiosInstance } from 'axios';

import type { NotificationRepository } from '@coin-cast/core';
import { retryWithBackoff, sharedHttpAgentOptions } from '@coin-cast/http-utils';

export class TelegramNotificationRepository implements NotificationRepository {
  private readonly chatId: string;

  private readonly http: AxiosInstance;

  constructor(
    token: string,
    chatId: string,
    baseUrl: string,
    private readonly maxRetries = Number(process.env.API_RETRY_MAX_ATTEMPTS || 10),
    private readonly initialDelayMs = Number(process.env.API_RETRY_INITIAL_DELAY_MS || 1_000),
    private readonly maxDelayMs = Number(process.env.API_RETRY_MAX_DELAY_MS || 30_000),
    timeoutMs = 10_000,
  ) {
    if (!token) {
      throw new Error('Missing TELEGRAM_TOKEN');
    }

    if (!chatId) {
      throw new Error('Missing TELEGRAM_CHAT_ID');
    }

    this.chatId = chatId;
    this.http = axios.create({
      baseURL: `${baseUrl}${token}`,
      timeout: timeoutMs,
      ...sharedHttpAgentOptions,
    });
  }

  async send(message: string): Promise<void> {
    try {
      const response = await retryWithBackoff(
        () =>
          this.http.post('/sendMessage', {
            chat_id: this.chatId,
            text: message,
            disable_notification: false,
          }),
        {
          context: 'Telegram notification',
          maxAttempts: this.maxRetries,
          initialDelayMs: this.initialDelayMs,
          maxDelayMs: this.maxDelayMs,
        },
      );

      if (!response.data?.ok) {
        throw new Error(`Telegram API error: ${JSON.stringify(response.data)}`);
      }
    } catch (error: unknown) {
      const response = this.readResponse(error);
      const status = response?.status;
      const payload = response?.data;
      const messageText = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Telegram notification failed${status ? ` with status ${status}` : ''}: ${
          payload ? JSON.stringify(payload) : messageText
        }`,
      );
    }
  }

  private readResponse(error: unknown): { status?: number; data?: unknown } | undefined {
    if (typeof error !== 'object' || error === null || !('response' in error)) {
      return undefined;
    }

    return (error as { response?: { status?: number; data?: unknown } }).response;
  }
}
