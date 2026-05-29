import Database from "better-sqlite3";

export interface QueueJob {
  owner: string;
  repo: string;
  pr: number;
  headSha: string;
  baseSha: string;
  installationId: number;
}

export type LogFn = (event: Record<string, unknown>) => void;

export class Queue {
  private db: Database.Database;
  private log: LogFn;

  constructor(dbPath: string, private debounceMs: number, log: LogFn = () => {}) {
    this.log = log;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        pr INTEGER NOT NULL,
        head_sha TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        installation_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        run_after INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_processed_sha TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner, repo, pr)
      );
    `);
    // Reclaim jobs that were mid-run when the process died: on startup, any
    // 'running' row is stale and must become claimable again.
    this.db.exec(`UPDATE jobs SET status='pending' WHERE status='running';`);
  }

  enqueue(job: QueueJob, now: number = Date.now()): boolean {
    const repo = `${job.owner}/${job.repo}`;
    const existing = this.db
      .prepare(`SELECT last_processed_sha AS lps, head_sha AS prevHead, status FROM jobs WHERE owner=? AND repo=? AND pr=?`)
      .get(job.owner, job.repo, job.pr) as { lps: string | null; prevHead: string; status: string } | undefined;
    if (existing && existing.lps === job.headSha) {
      this.log({ event: "enqueue_skipped", reason: "already_processed", repo, pr: job.pr, headSha: job.headSha });
      return false;
    }

    const runAfter = now + this.debounceMs;
    this.db
      .prepare(`
        INSERT INTO jobs (owner, repo, pr, head_sha, base_sha, installation_id, status, run_after, attempts, updated_at)
        VALUES (@owner, @repo, @pr, @headSha, @baseSha, @installationId, 'pending', @runAfter, 0, @now)
        ON CONFLICT(owner, repo, pr) DO UPDATE SET
          head_sha=@headSha, base_sha=@baseSha, installation_id=@installationId,
          status='pending', run_after=@runAfter, attempts=0, updated_at=@now
      `)
      .run({ ...job, runAfter, now });
    if (existing && existing.prevHead !== job.headSha && existing.status === "pending") {
      this.log({ event: "debounce_replace", repo, pr: job.pr, oldHeadSha: existing.prevHead, newHeadSha: job.headSha, runAfter });
    } else {
      this.log({ event: "enqueue", repo, pr: job.pr, headSha: job.headSha, runAfter });
    }
    return true;
  }

  claimNext(now: number = Date.now()): QueueJob | null {
    const row = this.db
      .prepare(`
        SELECT owner, repo, pr,
               head_sha AS headSha, base_sha AS baseSha, installation_id AS installationId
        FROM jobs
        WHERE status='pending' AND run_after<=?
        ORDER BY run_after ASC LIMIT 1
      `)
      .get(now) as QueueJob | undefined;
    if (!row) return null;
    this.db
      .prepare(`UPDATE jobs SET status='running', updated_at=? WHERE owner=? AND repo=? AND pr=?`)
      .run(now, row.owner, row.repo, row.pr);
    this.log({ event: "claim", repo: `${row.owner}/${row.repo}`, pr: row.pr, headSha: row.headSha });
    return row;
  }

  complete(job: QueueJob, now: number = Date.now()): void {
    this.db
      .prepare(`
        UPDATE jobs SET status='idle', last_processed_sha=?, updated_at=?
        WHERE owner=? AND repo=? AND pr=?
      `)
      .run(job.headSha, now, job.owner, job.repo, job.pr);
    this.log({ event: "complete", repo: `${job.owner}/${job.repo}`, pr: job.pr, headSha: job.headSha });
  }

  fail(job: QueueJob, maxRetries: number, now: number = Date.now()): void {
    const row = this.db
      .prepare(`SELECT attempts FROM jobs WHERE owner=? AND repo=? AND pr=?`)
      .get(job.owner, job.repo, job.pr) as { attempts: number } | undefined;
    const attempts = (row?.attempts ?? 0) + 1;
    const status = attempts >= maxRetries ? "failed" : "pending";
    this.db
      .prepare(`
        UPDATE jobs SET status=?, attempts=?, run_after=?, updated_at=?
        WHERE owner=? AND repo=? AND pr=?
      `)
      .run(status, attempts, now, now, job.owner, job.repo, job.pr);
    this.log({ event: status === "failed" ? "job_dead" : "retry", repo: `${job.owner}/${job.repo}`, pr: job.pr, attempts, maxRetries });
  }

  close(): void {
    this.db.close();
  }
}
