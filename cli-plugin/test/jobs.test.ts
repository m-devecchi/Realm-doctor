import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {jobFindings, summarizeJobs, type JobExecution} from '../src/lib/jobs.js';
import {FIXTURES} from './helpers.js';

const executions = JSON.parse(readFileSync(join(FIXTURES, 'jobs', 'executions.json'), 'utf8')) as JobExecution[];

describe('job analysis', () => {
  it('summarizes runs, failures and durations per job', () => {
    const s = summarizeJobs(executions);
    const exp = s.find((j) => j.jobId === 'ExportOrders')!;
    expect(exp).toMatchObject({runs: 3, failed: 2, lastStatus: 'ERROR', lastFailedStep: 'ExportOrdersToERP'});
    expect(s.find((j) => j.jobId === 'ReindexSearch')).toMatchObject({lastDurationMs: 2_400_000, medianDurationMs: 960_000});
  });

  it('failing order export is critical, slow reindex is medium, healthy job has no finding', () => {
    const f = jobFindings(summarizeJobs(executions));
    expect(f.map((x) => `${x.rule}:${x.severity}:${x.evidence[0].ref}`)).toEqual(['JOB-001:critical:job:ExportOrders', 'JOB-002:medium:job:ReindexSearch']);
  });

  it('stuck and overlapping runs', () => {
    const now = '2026-10-08T12:00:00.000Z';
    const runs: JobExecution[] = [
      {job_id: 'Sync', execution_status: 'running', start_time: '2026-10-08T09:00:00.000Z'},
      {job_id: 'Sync', execution_status: 'running', start_time: '2026-10-08T10:00:00.000Z'},
      {job_id: 'Sync', execution_status: 'finished', exit_status: {status: 'ok'}, start_time: '2026-10-07T09:00:00.000Z', duration: 600_000},
    ];
    expect(jobFindings(summarizeJobs(runs, now)).map((x) => x.rule)).toEqual(['JOB-003', 'JOB-004']);
  });

  it('a generic failing job is high', () => {
    const f = jobFindings(summarizeJobs([{job_id: 'RebuildSitemap', exit_status: {status: 'error'}, start_time: '2026-10-08T00:00:00Z', duration: 1000}]));
    expect(f[0]).toMatchObject({rule: 'JOB-001', severity: 'high'});
  });
});
