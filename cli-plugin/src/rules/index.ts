import {type Finding} from '../lib/finding.js';
import {analyzeHyperforce} from './hyperforce-rules.js';
import {analyzeIsml} from './isml-rules.js';
import {analyzeJs} from './js-rules.js';
import {type SourceFile} from './source.js';

export function analyzeCode(files: SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    const p = f.path.toLowerCase();
    if (p.endsWith('.js') || p.endsWith('.ds')) findings.push(...analyzeJs(f));
    else if (p.endsWith('.isml')) findings.push(...analyzeIsml(f));
  }
  return findings;
}

export function analyzeHyperforceReadiness(files: SourceFile[]): Finding[] {
  return files.flatMap(analyzeHyperforce);
}

export const RULES = [
  {id: 'JS-001', severity: 'high', title: 'Chiamata costosa (ProductMgr, OrderMgr, getVariants...) dentro un ciclo'},
  {id: 'JS-002', severity: 'high', title: 'SeekableIterator mai chiuso'},
  {id: 'JS-003', severity: 'medium', title: 'Transaction.wrap che contiene un ciclo'},
  {id: 'JS-004', severity: 'medium', title: 'HTTPClient diretto invece del service framework'},
  {id: 'JS-005', severity: 'high', title: 'Credenziale hardcoded'},
  {id: 'JS-006', severity: 'low', title: 'importPackage / importScript legacy'},
  {id: 'JS-007', severity: 'high', title: 'Ricerca ordini da controller storefront'},
  {id: 'JS-009', severity: 'low', title: 'Blocco catch vuoto'},
  {id: 'ISML-001', severity: 'high', title: 'isprint con encoding="off"'},
  {id: 'ISML-002', severity: 'medium/high', title: 'API di business nel template (high se dentro isloop)'},
  {id: 'ISML-003', severity: 'high', title: 'Remote include dentro isloop'},
  {id: 'ISML-004', severity: 'low', title: 'Troppi remote include nello stesso template'},
  {id: 'HF-001', severity: 'medium', title: 'Indirizzo IP hardcoded'},
  {id: 'HF-002', severity: 'medium', title: 'Hostname di istanza hardcoded'},
  {id: 'PROMO-001', severity: 'medium', title: 'Promo abilitata che non può scattare'},
  {id: 'PROMO-002', severity: 'high', title: 'Assegnazione promo/campagna orfana'},
  {id: 'PROMO-003', severity: 'medium/high', title: 'Date della promo fuori dalla campagna'},
  {id: 'PROMO-004', severity: 'high', title: 'Customer group inesistente o vuoto'},
  {id: 'PROMO-005', severity: 'high', title: 'Coupon mancante, disabilitato, senza codici o esaurito'},
  {id: 'PROMO-006', severity: 'high', title: 'Valuta della promo non usata dal sito'},
  {id: 'PROMO-007', severity: 'high', title: 'Esclusività globale insieme ad altre promo attive'},
  {id: 'PROMO-008', severity: 'medium', title: 'Promo esclusive senza rank o con rank duplicato'},
  {id: 'PROMO-009', severity: 'low', title: 'Stessa promo attiva in più campagne'},
] as const;
