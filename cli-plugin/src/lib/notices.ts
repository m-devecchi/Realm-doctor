/**
 * Things that limited an analysis without being an error (a cache that could not be written, a record cap
 * that cut a list). Low-level code adds them; the audit that called it drains them into the report notes.
 */
const notices = new Set<string>();

export function addNotice(message: string): void {
  notices.add(message);
}

export function drainNotices(): string[] {
  const out = [...notices];
  notices.clear();
  return out;
}
