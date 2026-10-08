import {type Finding} from '../lib/finding.js';
import {lineOf, lineText, type SourceFile} from './source.js';

const HEAVY_API = /\b(ProductMgr|CatalogMgr|OrderMgr|CustomObjectMgr|CustomerMgr|ProductSearchModel|SystemObjectMgr)\b/g;
const REMOTE_INCLUDE = /<isinclude\s+[^>]*url\s*=/gi;
const UNENCODED = /<isprint\b[^>]*encoding\s*=\s*["']off["'][^>]*>/gi;
const LOOP_BLOCK = /<isloop\b[\s\S]*?<\/isloop>/gi;
const REMOTE_INCLUDE_THRESHOLD = 5;

export function analyzeIsml(file: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const c = file.content;
  const loc = (i: number) => `${file.path}:${lineOf(c, i)}`;
  const ex = (i: number) => lineText(c, lineOf(c, i));

  // ISML-001 unencoded output
  for (const m of c.matchAll(UNENCODED)) {
    findings.push({
      rule: 'ISML-001',
      category: 'code',
      severity: 'high',
      title: 'Unencoded output (isprint encoding="off")',
      evidence: [{location: loc(m.index ?? 0), excerpt: ex(m.index ?? 0)}],
      impact: 'XSS risk if the value contains user input or data from unchecked imports.',
      fix: 'Remove encoding="off" or limit it to managed, sanitized HTML content (e.g. content assets).',
    });
  }

  // Ranges of isloop blocks
  const loops: Array<[number, number]> = [];
  for (const m of c.matchAll(LOOP_BLOCK)) loops.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const inLoop = (i: number) => loops.some(([s, e]) => i >= s && i < e);

  // ISML-002 heavy API calls in the template
  const seenLines = new Set<number>();
  for (const m of c.matchAll(HEAVY_API)) {
    const i = m.index ?? 0;
    const line = lineOf(c, i);
    if (seenLines.has(line)) continue;
    seenLines.add(line);
    const looped = inLoop(i);
    findings.push({
      rule: 'ISML-002',
      category: 'code',
      severity: looped ? 'high' : 'medium',
      title: `Business API in template${looped ? ' inside isloop' : ''}: ${m[1]}`,
      evidence: [{location: loc(i), excerpt: ex(i)}],
      impact: looped
        ? 'Database access for every loop item during rendering: slow pages and quota.'
        : 'Data access logic in the template: hard to cache and test.',
      fix: 'Prepare the data in the controller or a model and pass it to the template.',
    });
  }

  // ISML-003 remote includes
  const includes = [...c.matchAll(REMOTE_INCLUDE)];
  const loopedIncludes = includes.filter((m) => inLoop(m.index ?? 0));
  for (const m of loopedIncludes) {
    findings.push({
      rule: 'ISML-003',
      category: 'code',
      severity: 'high',
      title: 'Remote include inside isloop',
      evidence: [{location: loc(m.index ?? 0), excerpt: ex(m.index ?? 0)}],
      impact: 'One extra server request for every loop item.',
      fix: 'Render the content with a local include or group it into a single remote include.',
    });
  }
  if (includes.length > REMOTE_INCLUDE_THRESHOLD) {
    findings.push({
      rule: 'ISML-004',
      category: 'code',
      severity: 'low',
      title: `Many remote includes in one template (${includes.length})`,
      evidence: [{location: loc(includes[0].index ?? 0), data: {count: includes.length}}],
      impact: 'Each remote include is a separate request: response time grows when they are not cached.',
      fix: 'Check the caching of every include and merge those with the same cache policy.',
    });
  }
  return findings;
}
