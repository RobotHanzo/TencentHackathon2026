import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppState } from '../shared/types.ts';
import { seedWorkspace } from './seed.ts';

export type Workspace = Omit<AppState, 'user' | 'aiMode'> & {
  // Legacy messages without attribution remain in manager exports, not personal transcripts.
  chatOwners?: Record<string, string>;
};

/** A transaction commits each workflow transition and its knowledge/audit records together. */
export class Store {
  private db: DatabaseSync;
  private closed = false;
  constructor(path: string, now: Date) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)',
    );
    if (!this.db.prepare('SELECT id FROM workspace WHERE id = 1').get()) {
      this.db
        .prepare('INSERT INTO workspace (id, payload) VALUES (1, ?)')
        .run(JSON.stringify(seedWorkspace(now)));
    }
  }
  read(): Workspace {
    const row = this.db.prepare('SELECT payload FROM workspace WHERE id = 1').get() as {
      payload: string;
    };
    return JSON.parse(row.payload) as Workspace;
  }
  mutate<T>(change: (workspace: Workspace) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const workspace = this.read();
      const result = change(workspace);
      this.db
        .prepare('UPDATE workspace SET payload = ? WHERE id = 1')
        .run(JSON.stringify(workspace));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}
