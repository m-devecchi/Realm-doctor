import {createHash} from 'node:crypto';

/**
 * Turns a log message into a stable template so that the same error with
 * different ids, numbers or values groups under one signature.
 */
export function normalizeMessage(message: string): string {
  return (
    message
      // keep only the first line; stack traces vary
      .split('\n')[0]
      // quoted values
      .replace(/"[^"]{0,200}"/g, '"<V>"')
      .replace(/'[^']{0,200}'/g, "'<V>'")
      // UUIDs and long hex
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
      .replace(/\b[0-9a-f]{16,}\b/gi, '<HEX>')
      // mixed alphanumeric ids (session ids, basket ids, order tokens)
      .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{10,}\b/g, '<ID>')
      // numbers, line numbers included: they change between code versions
      .replace(/\b\d+(?:[.,]\d+)?\b/g, '<N>')
      // masked placeholders collapse
      .replace(/<(EMAIL|IP|PHONE|TOKEN|SECRET|CARD\?)>/g, '<V>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
  );
}

export function signatureId(template: string): string {
  return createHash('sha1').update(template).digest('hex').slice(0, 10);
}
