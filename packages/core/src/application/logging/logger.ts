type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown> | undefined;

const isDebugEnabled = (): boolean =>
  process.env.COIN_CAST_VERBOSE_LOGS === 'true' ||
  process.env.LOG_LEVEL === 'debug';

const formatContext = (context: LogContext): string => {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }

  return ` ${JSON.stringify(context)}`;
};

const emit = (
  level: Exclude<LogLevel, 'debug'>,
  scope: string,
  message: string,
  context?: LogContext,
): void => {
  console[level](
    `${new Date().toISOString()} [${scope}] ${message}${formatContext(context)}`,
  );
};

export const createLogger = (scope: string) => ({
  debug(message: string, context?: LogContext): void {
    if (!isDebugEnabled()) {
      return;
    }

    console.info(
      `${new Date().toISOString()} [${scope}] ${message}${formatContext(context)}`,
    );
  },
  info(message: string, context?: LogContext): void {
    emit('info', scope, message, context);
  },
  warn(message: string, context?: LogContext): void {
    emit('warn', scope, message, context);
  },
  error(message: string, context?: LogContext): void {
    emit('error', scope, message, context);
  },
});
