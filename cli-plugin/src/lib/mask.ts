/**
 * Masks personal data in log text before it is cached, printed or sent to an LLM.
 *
 * This is pattern-based and therefore best effort: it reliably removes emails,
 * IPs, phone numbers, card-like numbers, long numeric ids (order and customer
 * numbers) and session/token-like strings. Free-text names and addresses cannot
 * be detected reliably and are NOT guaranteed to be removed.
 */

const RULES: Array<[RegExp, string]> = [
  // Emails
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<EMAIL>'],
  // Card-like numbers: 13-19 digits, optionally grouped by spaces or dashes
  [/\b(?:\d[ -]?){12,18}\d\b/g, '<CARD?>'],
  // IPv4
  [/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, '<IP>'],
  // IPv6 (compact heuristic: at least 3 groups)
  [/\b(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}\b/g, '<IP>'],
  // Phone numbers with an international prefix
  [/\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g, '<PHONE>'],
  // Bearer / JWT-like tokens
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '<TOKEN>'],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1<TOKEN>'],
  // order / customer numbers after a keyword
  [/\b(order|ordine|customer|customerNo|customer_no|cliente)(\s*(?:no\.?|number|nr\.?|#)?\s*[:#=]?\s*)([A-Za-z0-9-]*\d[A-Za-z0-9-]{3,})/gi, '$1$2<NUM>'],
  // any other long pure-numeric id (8+ digits)
  [/\b\d{8,}\b/g, '<NUM>'],
  // key=value secrets
  [/((?:password|passwd|pwd|secret|api[_-]?key|token|authorization)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '$1<SECRET>'],
];

export function maskPII(text: string): string {
  let out = text;
  for (const [re, replacement] of RULES) out = out.replace(re, replacement);
  return out;
}
