import {readdir, readFile, stat} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';

export interface SourceFile {
  /** Path relative to the code version root: <cartridge>/cartridge/... */
  path: string;
  content: string;
}

export const ANALYZED_EXTENSIONS = ['.js', '.ds', '.isml', '.json', '.xml', '.properties'];
const MAX_FILE_BYTES = 1_000_000;

export function isAnalyzed(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.includes('/node_modules/') || lower.includes('/static/') || lower.endsWith('.min.js')) return false;
  return ANALYZED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Loads analyzable files from a local folder (a downloaded code version or a repo). */
export async function loadLocalSources(root: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = join(dir, name);
      const st = await stat(full);
      if (st.isDirectory()) await walk(full);
      else {
        const rel = relative(root, full).split(sep).join('/');
        if (isAnalyzed(rel) && st.size <= MAX_FILE_BYTES) files.push({path: rel, content: await readFile(full, 'utf8')});
      }
    }
  }
  await walk(root);
  return files;
}

export function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

export function lineText(content: string, line: number): string {
  return (content.split('\n')[line - 1] ?? '').trim().slice(0, 200);
}

export function cartridgeOf(path: string): string {
  return path.split('/')[0];
}
