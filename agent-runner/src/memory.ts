import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MemoryRecord } from '@devdigest/shared';

/**
 * Reads the exported `.devdigest/memory.jsonl` (repo-scoped, content-only —
 * D12). Best-effort by design (AC-31): a missing file is "no memory", and a
 * blank, non-JSON or schema-invalid line is skipped rather than failing the
 * run. The records are repo content, so `run.ts` hands them to reviewer-core
 * as `<untrusted source="memory">` blocks — never as instructions.
 */
export function loadMemory(
  devdigestDir: string,
  readFile: typeof readFileSync = readFileSync,
): MemoryRecord[] {
  let text: string;
  try {
    text = readFile(path.join(devdigestDir, 'memory.jsonl'), 'utf8') as unknown as string;
  } catch {
    return [];
  }
  const records: MemoryRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = MemoryRecord.safeParse(JSON.parse(line));
      if (parsed.success) records.push(parsed.data);
    } catch {
      // not JSON — skip the line
    }
  }
  return records;
}
