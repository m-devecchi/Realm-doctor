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
      title: `Hardcoded IP address: ${ip}`,
      evidence: [{location: `${file.path}:${lineOf(c, i)}`, excerpt: line}],
      impact: 'IP-based allowlists or endpoints stop working when outbound or inbound IPs change.',
      fix: 'Use hostnames and external configuration; update the allowlists of external systems with the Hyperforce IPs.',
    });
  }

  for (const m of c.matchAll(POD_HOST)) {
    const i = m.index ?? 0;
    findings.push({
      rule: 'HF-002',
      category: 'hyperforce',
      severity: 'medium',
      title: `Hardcoded instance hostname: ${m[1]}`,
      evidence: [{location: `${file.path}:${lineOf(c, i)}`, excerpt: lineText(c, lineOf(c, i))}],
      impact: "After the migration the instance hostname can change: links, callbacks and integrations point to the old host.",
      fix: 'Derive hosts and URLs at runtime (URLUtils, Site, System) or from a site preference.',
    });
  }
  return findings;
}
