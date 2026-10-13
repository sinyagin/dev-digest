import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, '../src/db/migrations');
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[];
};
const sqlFor = (prefix: string) => {
  const file = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith('.sql'));
  if (!file) throw new Error(`migration ${prefix}* not found`);
  return { file, sql: readFileSync(join(dir, file), 'utf8') };
};

describe('eval reshape migrations (0016 add / 0017 drop)', () => {
  const m16 = sqlFor('0016_');
  const m17 = sqlFor('0017_');

  it('journal lists both new tags', () => {
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain(m16.file.replace('.sql', ''));
    expect(tags).toContain(m17.file.replace('.sql', ''));
  });

  it('0016 starts with the zero-row guard and creates the partial unique index', () => {
    expect(m16.sql.trimStart().startsWith('DO $$ BEGIN IF EXISTS (SELECT 1 FROM eval_cases)')).toBe(true);
    expect(m16.sql).toContain('eval tables not empty');
    expect(m16.sql).toMatch(
      /CREATE UNIQUE INDEX "eval_runs_one_running_per_agent"[^;]*WHERE status = 'running'/,
    );
  });

  it('0017 drops case_id, actual_output and pass', () => {
    for (const col of ['case_id', 'actual_output', 'pass']) {
      expect(m17.sql).toContain(`DROP COLUMN "${col}"`);
    }
  });
});
