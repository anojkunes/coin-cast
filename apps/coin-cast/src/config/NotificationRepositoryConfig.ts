import type { NotificationRepository } from '@coin-cast/core';
import { TelegramNotificationRepository } from '@coin-cast/notifications-telegram';
import type { AppConfig } from './env';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not defined`);
  }

  return value;
};

export const telegramRepository = (config: AppConfig): NotificationRepository => {
  const token = required('TELEGRAM_TOKEN');
  const chatId = required('TELEGRAM_CHAT_ID');
  const url = required('TELEGRAM_BASE_URL');

  return new TelegramNotificationRepository(
    token,
    chatId,
    url,
    config.apiRetryMaxAttempts,
    config.apiRetryInitialDelayMs,
    config.apiRetryMaxDelayMs,
  );
};
