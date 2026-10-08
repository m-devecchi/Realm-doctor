import {Flags, ux} from '@oclif/core';
import {InstanceCommand} from '@salesforce/b2c-tooling-sdk/cli';
import {loadCode} from '../../lib/code-source.js';
import {buildReport, formatReport} from '../../lib/report.js';
import {analyzeHyperforceReadiness} from '../../rules/index.js';

export default class AuditHyperforce extends InstanceCommand<typeof AuditHyperforce> {
  static description =
    'Hyperforce readiness checks on cartridge code and configuration files: hardcoded IP addresses and instance hostnames. Reads the code version via WebDAV (read-only) or a local folder.';
  static enableJsonFlag = true;
  static examples = ['<%= config.bin %> <%= command.id %> --json', '<%= config.bin %> <%= command.id %> --dir ./cartridges --json'];
  static flags = {
    ...InstanceCommand.baseFlags,
    dir: Flags.string({description: 'Analyze a local folder instead of the instance'}),
    cartridge: Flags.string({description: 'Only these cartridges', multiple: true}),
  };

  async run() {
    const code = await loadCode(
      {dir: this.flags.dir, codeVersion: this.flags['code-version'], cartridges: this.flags.cartridge},
      () => {
        this.requireServer();
        this.requireWebDavCredentials();
        return {instance: this.instance, hostname: this.resolvedConfig.values.hostname!};
      },
    );
    const findings = analyzeHyperforceReadiness(code.files);
    const checklist = [
      {item: 'IP hardcoded nel codice', status: findings.some((f) => f.rule === 'HF-001') ? 'KO' : 'OK'},
      {item: 'Hostname di istanza hardcoded', status: findings.some((f) => f.rule === 'HF-002') ? 'KO' : 'OK'},
      {item: 'Allowlist IP sui sistemi esterni (ERP, PSP, OMS, WAF)', status: 'DA VERIFICARE', note: 'Non verificabile dal codice: chiedere ai fornitori.'},
      {item: 'Integrazioni che chiamano SFCC con IP o host fissi', status: 'DA VERIFICARE', note: 'Censire i sistemi in ingresso.'},
      {item: 'Certificati mTLS e servizi in Business Manager', status: 'DA VERIFICARE', note: 'Controllare gli endpoint dei servizi configurati.'},
    ];
    const report = buildReport('audit hyperforce', {origin: code.origin, codeVersion: code.codeVersion, dir: code.root}, findings, {files: code.files.length, checklist}, code.notes);
    if (!this.jsonEnabled()) ux.stdout(formatReport(report));
    return report;
  }
}
