/**
 * Masks personal data in log text before it is cached, printed or sent to an LLM.
 *
 * This is pattern-based and therefore best effort: it reliably removes emails,
 * IPs, phone numbers, card-like numbers, long numeric ids (order and customer
 * numbers) and session/token-like strings. Free-text names and addresses cannot
 * be detected reliably and are NOT guaranteed to be removed.
 */

const RULES: Array<[RegExp, string]> = [
  // IBAN (before the numeric rules, which would cut it in pieces)
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, '<IBAN>'],
  // Italian codice fiscale
  [/\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b/gi, '<TAXID>'],
  // personal fields written as key=value or "key":"value" (names, addresses, phone, birthday)
  [
    /\b((?:first|last|sur|full|given|family|middle)[_ -]?name|address[12]?|street(?:[_ ]?address)?|city|zip(?:[_ ]?code)?|postal[_ ]?code|phone(?:[_ ]?(?:home|mobile|business))?|mobile|birthday|date[_ ]?of[_ ]?birth|dob)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&}\])]+)/gi,
    '$1$2<PII>',
  ],
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

/**
 * Independent second check, with patterns different from the masking rules: lists what still looks like
 * personal data in text that was already masked. Callers treat a non-empty result as "do not cache, do not
 * return the text" (fail closed).
 */
const RESIDUAL: Array<[string, RegExp]> = [
  ['email', /[^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,}/],
  ['iban', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,}/],
  ['digits', /\b\d{9,}\b/],
  ['personal-field', /\b(?:first|last|full)[_ -]?name["']?\s*[=:]\s*(?!["']?<)["']?\w/i],
];

export function residualPII(maskedText: string): string[] {
  return RESIDUAL.filter(([, re]) => re.test(maskedText)).map(([kind]) => kind);
}

/**
 * Hides credentials written as string literals in code (`apiKey: 'sk_live_...'`, `password = "..."`), so reading a
 * cartridge file for a finding does not send a secret to the model. Same names as rule JS-005.
 */
const CODE_SECRET = /((?:password|passwd|secret|api_?key|apikey|client_?secret|access_?token|private_?key)\w*["']?\s*[:=]\s*)(["'])([^"'\n]{6,})\2/gi;

export function maskCodeSecrets(code: string): string {
  return code.replace(CODE_SECRET, '$1$2<SECRET>$2');
}
