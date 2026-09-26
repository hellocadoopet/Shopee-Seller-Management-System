import pino from "pino";

/**
 * JSON logs (pm2 captures stdout). PII rule: log ids and statuses only — never message bodies,
 * push names or phone numbers.
 */
export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

/** Baileys is chatty and its debug logs carry jids/content, so it gets its own, quieter level. */
export const baileysLogLevel = process.env.BAILEYS_LOG_LEVEL ?? "warn";
