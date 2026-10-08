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
      title: 'Output senza encoding (isprint encoding="off")',
      evidence: [{location: loc(m.index ?? 0), excerpt: ex(m.index ?? 0)}],
      impact: 'Rischio XSS se il valore contiene dati inseriti da utenti o da import non controllati.',
      fix: 'Rimuovere encoding="off" o limitarlo a contenuti HTML gestiti e sanificati (es. content asset).',
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
      title: `API di business nel template${looped ? ' dentro isloop' : ''}: ${m[1]}`,
      evidence: [{location: loc(i), excerpt: ex(i)}],
      impact: looped
        ? 'Accesso al database per ogni elemento del ciclo durante il rendering: pagine lente e quota.'
        : 'Logica di accesso ai dati nel template: difficile da cachare e da testare.',
      fix: 'Preparare i dati nel controller o in un model e passarli al template.',
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
      title: 'Remote include dentro isloop',
      evidence: [{location: loc(m.index ?? 0), excerpt: ex(m.index ?? 0)}],
      impact: 'Una richiesta server aggiuntiva per ogni elemento del ciclo.',
      fix: 'Rendere il contenuto con un local include o raggruppare in un solo remote include.',
    });
  }
  if (includes.length > REMOTE_INCLUDE_THRESHOLD) {
    findings.push({
      rule: 'ISML-004',
      category: 'code',
      severity: 'low',
      title: `Molti remote include nello stesso template (${includes.length})`,
      evidence: [{location: loc(includes[0].index ?? 0), data: {count: includes.length}}],
      impact: 'Ogni remote include è una richiesta separata: aumenta il tempo di risposta se non sono in cache.',
      fix: 'Verificare la cache di ogni include e accorpare quelli con la stessa politica di cache.',
    });
  }
  return findings;
}
