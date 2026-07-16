import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  ...(config.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, ignore: 'pid,hostname' },
    },
  }),
  redact: {
    paths: [
      'email',
      '*.email',
      'customer.email',
      'data.customer.email',
      'subscriber.email',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  base: {
    env: config.NODE_ENV,
  },
});