import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

const customFormat = printf(({ level, message, timestamp }) => {
  return `[${timestamp}] ${level}: ${message}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    colorize(),
    customFormat
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: `worker-${process.env.WORKER_NAME || 'unknown'}.log`,
      level: 'info'
    }),
    new winston.transports.File({ 
      filename: `worker-${process.env.WORKER_NAME || 'unknown'}-error.log`,
      level: 'error'
    })
  ]
});