import {type Finding} from '../lib/finding.js';
import {lineOf, lineText, type SourceFile} from './source.js';

const IPV4 = /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d))\b/g;
const IGNORED_IPS = new Set(['127.0.0.1', '0.0.0.0', '255.255.255.255', '255.255.255.0']);
const POD_HOST = /\b([\w-]+(?:\.[\w-]+)*\.(?:demandware\.net|demandware\.com|commercecloud\.salesforce\.com))\b/gi;

/**
 * Static checks for a POD -> Hyperforce migration. The migration changes
 * instance hostnames and outbound IPs, so hardcoded values break integrations.
 */
export function analyzeHyperforce(file: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const c = file.content;

  for (const m of c.matchAll(IPV4)) {
    const ip = m[1];
    if (IGNORED_IPS.has(ip)) continue;
    const i = m.index ?? 0;
    const line = lineText(c, lineOf(c, i));
    // skip version strings like "version": "1.2.3.4"
    if (/version/i.test(line)) continue;
    findings.push({
      rule: 'HF-001',
      category: 'hyperforce',
      severity: 'medium',
      title: `Indirizzo IP hardcoded: ${ip}`,
      evidence: [{location: `${file.path}:${lineOf(c, i)}`, excerpt: line}],
      impact: 'Allowlist o endpoint basati su IP smettono di funzionare quando cambiano gli IP di uscita o di ingresso.',
      fix: 'Usare hostname e configurazione esterna; aggiornare le allowlist dei sistemi esterni con gli IP Hyperforce.',
    });
  }

  for (const m of c.matchAll(POD_HOST)) {
    const i = m.index ?? 0;
    findings.push({
      rule: 'HF-002',
      category: 'hyperforce',
      severity: 'medium',
      title: `Hostname di istanza hardcoded: ${m[1]}`,
      evidence: [{location: `${file.path}:${lineOf(c, i)}`, excerpt: lineText(c, lineOf(c, i))}],
      impact: "Dopo la migrazione l'hostname dell'istanza può cambiare: link, callback e integrazioni puntano al vecchio host.",
      fix: 'Ricavare host e URL a runtime (URLUtils, Site, System) o da una site preference.',
    });
  }
  return findings;
}
