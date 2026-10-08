import {type Finding, type Severity} from './finding.js';

/** Subset of the OCAPI job_execution document used by the analysis. */
export interface JobExecution {
  id?: string;
  job_id?: string;
  execution_status?: string;
  exit_status?: {code?: string; message?: string; status?: string};
  start_time?: string;
  end_time?: string;
  duration?: number;
  log_file_path?: string;
  step_executions?: Array<{step_id?: string; exit_status?: {code?: string; status?: string; message?: string}}>;
}

export interface JobSummary {
  jobId: string;
  runs: number;
  failed: number;
  running: number;
  lastStatus: string;
  lastStart?: string;
  lastDurationMs?: number;
  medianDurationMs?: number;
  maxDurationMs?: number;
  lastFailedStep?: string;
  lastLogFile?: string;
}

const CRITICAL_NAME = /order|payment|inventory|price|stock|export|import/i;
const RUNNING = new Set(['pending', 'running', 'resuming', 'resumed', 'restarting', 'retrying']);

export function isFailed(e: JobExecution): boolean {
  return e.exit_status?.status === 'error' || e.exit_status?.status === 'ERROR' || e.exit_status?.code === 'ERROR' || e.execution_status === 'aborted';
}

function durationMs(e: JobExecution, now: number): number | undefined {
  if (typeof e.duration === 'number') return e.duration;
  if (!e.start_time) return undefined;
  const end = e.end_time ? Date.parse(e.end_time) : now;
  return end - Date.parse(e.start_time);
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function summarizeJobs(executions: JobExecution[], nowIso?: string): JobSummary[] {
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const byJob = new Map<string, JobExecution[]>();
  for (const e of executions) {
    const id = e.job_id ?? '?';
    byJob.set(id, [...(byJob.get(id) ?? []), e]);
  }
  return [...byJob.entries()]
    .map(([jobId, list]) => {
      const sorted = [...list].sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''));
      const last = sorted[0];
      const finished = sorted.filter((e) => !RUNNING.has(e.execution_status ?? ''));
      const durations = finished.map((e) => durationMs(e, now)).filter((d): d is number => d !== undefined);
      const lastFailed = sorted.find(isFailed);
      return {
        jobId,
        runs: list.length,
        failed: list.filter(isFailed).length,
        running: list.filter((e) => RUNNING.has(e.execution_status ?? '')).length,
        lastStatus: isFailed(last) ? 'ERROR' : RUNNING.has(last.execution_status ?? '') ? 'RUNNING' : 'OK',
        lastStart: last.start_time,
        lastDurationMs: durationMs(last, now),
        medianDurationMs: median(durations),
        maxDurationMs: durations.length ? Math.max(...durations) : undefined,
        lastFailedStep: lastFailed?.step_executions?.find((s) => s.exit_status?.status === 'error' || s.exit_status?.code === 'ERROR')?.step_id,
        lastLogFile: (lastFailed ?? last).log_file_path,
      };
    })
    .sort((a, b) => b.failed - a.failed || a.jobId.localeCompare(b.jobId));
}

export function jobFindings(summaries: JobSummary[]): Finding[] {
  const out: Finding[] = [];
  for (const s of summaries) {
    const ref = `job:${s.jobId}`;
    const data = {...s};
    if (s.lastStatus === 'ERROR' || s.failed >= 2) {
      const sev: Severity = CRITICAL_NAME.test(s.jobId) ? 'critical' : 'high';
      out.push({
        rule: 'JOB-001',
        category: 'jobs',
        severity: sev,
        title: `Job failing: ${s.jobId} (${s.failed} of ${s.runs} runs failed${s.lastFailedStep ? `, step ${s.lastFailedStep}` : ''})`,
        evidence: [{ref, location: s.lastLogFile, data}],
        impact: sev === 'critical' ? 'The job name points to orders, payments, inventory, prices or data exchange: business data may be stale or missing.' : 'The job does not complete its work.',
        fix: 'Read the job log at the given path, fix the failing step, then re-run the job.',
      });
    }
    if (s.lastStatus === 'RUNNING' && s.medianDurationMs && s.lastDurationMs && s.lastDurationMs > 2 * s.medianDurationMs) {
      out.push({
        rule: 'JOB-003',
        category: 'jobs',
        severity: 'medium',
        title: `Job running much longer than usual: ${s.jobId}`,
        evidence: [{ref, data}],
        impact: 'A stuck job can block the next scheduled runs and hold locks.',
        fix: 'Check the job log; if it is stuck, stop it from Business Manager and investigate.',
      });
    } else if (
      s.lastStatus !== 'ERROR' &&
      s.medianDurationMs &&
      s.lastDurationMs &&
      s.lastDurationMs > 1.5 * s.medianDurationMs &&
      s.lastDurationMs > 5 * 60_000
    ) {
      out.push({
        rule: 'JOB-002',
        category: 'jobs',
        severity: 'medium',
        title: `Job slower than usual: ${s.jobId} (${Math.round(s.lastDurationMs / 60_000)} min vs median ${Math.round(s.medianDurationMs / 60_000)} min)`,
        evidence: [{ref, data}],
        impact: 'Growing durations often precede timeouts or overlapping runs.',
        fix: 'Compare the job log with a normal run: data volume, slow services, missing paging.',
      });
    }
    if (s.running > 1) {
      out.push({
        rule: 'JOB-004',
        category: 'jobs',
        severity: 'medium',
        title: `Overlapping executions of the same job: ${s.jobId} (${s.running} running)`,
        evidence: [{ref, data}],
        impact: 'Parallel runs of the same job can process the same data twice or deadlock.',
        fix: 'Check the job schedule and its "allow concurrent runs" setting.',
      });
    }
  }
  return out;
}
