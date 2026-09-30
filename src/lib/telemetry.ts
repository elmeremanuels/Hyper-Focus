// Harvested from Publicato-personal server/utils/telemetry.ts (job telemetry only).
// Added: an optional event sink so job outcomes can be written to the `events` table (step 0.4).

export type JobStatus = 'success' | 'error';

export interface JobRunRecord {
  name: string;
  status: JobStatus;
  startedAt: string;
  durationMs: number;
  errorMessage?: string;
  details?: string;
}

export interface JobMetricsSnapshot {
  recentRuns: JobRunRecord[];
}

export interface TelemetryEvent {
  name: string;
  userId?: number;
  props: Record<string, unknown>;
}

export type EventSink = (event: TelemetryEvent) => Promise<void> | void;

class JobTelemetry {
  private readonly runs: JobRunRecord[] = [];
  private readonly historyLimit = 50;

  recordRun(run: JobRunRecord): void {
    this.runs.push(run);
    if (this.runs.length > this.historyLimit) {
      this.runs.shift();
    }
  }

  recordOutcome(options: {
    name: string;
    status: JobStatus;
    startedAt: number;
    durationMs: number;
    errorMessage?: string | undefined;
    details?: string | undefined;
  }): void {
    const { name, status, startedAt, durationMs, errorMessage, details } = options;
    this.recordRun({
      name,
      status,
      startedAt: new Date(startedAt).toISOString(),
      durationMs,
      ...(errorMessage !== undefined && { errorMessage }),
      ...(details !== undefined && { details }),
    });
  }

  getSnapshot(): JobMetricsSnapshot {
    return { recentRuns: [...this.runs].reverse() };
  }
}

class EventTelemetry {
  private sink: EventSink | undefined;

  setSink(sink: EventSink | undefined): void {
    this.sink = sink;
  }

  async record(event: TelemetryEvent): Promise<void> {
    if (!this.sink) {
      return;
    }
    try {
      await this.sink(event);
    } catch (error) {
      // Telemetry must never break the caller.
      console.error('Failed to record event', event.name, error);
    }
  }
}

export const telemetry = {
  jobs: new JobTelemetry(),
  events: new EventTelemetry(),
};
