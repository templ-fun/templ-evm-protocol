import pino from 'pino';
const defaultLevel = process.env.NODE_ENV === 'test' ? 'warn' : 'info';
export const logger = pino({ level: process.env.LOG_LEVEL || defaultLevel });
