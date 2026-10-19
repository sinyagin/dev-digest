import { unzipSync, type UnzipFileInfo } from 'fflate';
import { CiResultArtifact } from '@devdigest/shared';
import { ARTIFACT_FILE, MAX_ENTRY_BYTES, MAX_ZIP_BYTES, MAX_ZIP_ENTRIES } from './constants.js';

/**
 * D6 — the ONE pure check every CI result artifact must pass before any field of
 * it is stored. The artifact is untrusted third-party JSON in a zip:
 *   size limits -> safe archive entries -> no credential-shaped value (raw text,
 *   BEFORE JSON.parse, and again on the parsed values) -> schema-valid ->
 *   commit SHA equals the workflow run's head SHA -> repository equals the
 *   installation's repository.
 * No I/O, no logging. A rejection carries only the check NAME — never any
 * artifact content (AC-36).
 */

/** Credential-shaped values. Shared with the runner, which scrubs its own artifact. */
export const CREDENTIAL_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'github_pat', re: /\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  { name: 'openrouter_key', re: /\bsk-or-[A-Za-z0-9_-]{16,}/ },
  { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'openai_key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'slack_token', re: /\bxox[bpsar]-[0-9A-Za-z-]{10,}/ },
  { name: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** Name of the first credential pattern found in `text`, else null. Never returns the value. */
export function findCredential(text: string): string | null {
  for (const p of CREDENTIAL_PATTERNS) if (p.re.test(text)) return p.name;
  return null;
}

export type ArtifactCheck =
  | 'oversize'
  | 'unsafe_entry'
  | 'malformed'
  | 'credential'
  | 'schema'
  | 'commit_sha'
  | 'repository';

export type VerifyResult =
  | { ok: true; artifact: CiResultArtifact }
  | { ok: false; check: ArtifactCheck };

export interface ArtifactExpectation {
  /** The installation's `owner/name`. */
  repository: string;
  /** The workflow run's head SHA, as reported by GitHub. */
  headSha: string;
}

/** Absolute, drive-letter, backslash, NUL or `..` entries are never acceptable. */
function isUnsafeEntryName(name: string): boolean {
  if (name.startsWith('/') || name.includes('\\') || name.includes('\0')) return true;
  if (/^[A-Za-z]:/.test(name)) return true;
  return name.split('/').some((seg) => seg === '..');
}

function hasCredentialDeep(value: unknown): boolean {
  if (typeof value === 'string') return findCredential(value) !== null;
  if (Array.isArray(value)) return value.some(hasCredentialDeep);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => findCredential(k) !== null || hasCredentialDeep(v));
  }
  return false;
}

export function verifyArtifact(zip: Uint8Array, expected: ArtifactExpectation): VerifyResult {
  if (zip.byteLength > MAX_ZIP_BYTES) return { ok: false, check: 'oversize' };

  let entries = 0;
  let tooMany = false;
  let unsafe = false;
  let resultTooBig = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      // Runs for every central-directory entry BEFORE anything is inflated, so only
      // the result file is ever decompressed (and only if its declared size fits).
      filter: (file: UnzipFileInfo) => {
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES) {
          tooMany = true;
          return false;
        }
        if (isUnsafeEntryName(file.name)) {
          unsafe = true;
          return false;
        }
        if (file.name !== ARTIFACT_FILE) return false;
        if (file.originalSize > MAX_ENTRY_BYTES) {
          resultTooBig = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    return { ok: false, check: 'malformed' };
  }
  if (tooMany || resultTooBig) return { ok: false, check: 'oversize' };
  if (unsafe) return { ok: false, check: 'unsafe_entry' };

  const bytes = files[ARTIFACT_FILE];
  if (!bytes) return { ok: false, check: 'malformed' };
  if (bytes.byteLength > MAX_ENTRY_BYTES) return { ok: false, check: 'oversize' };

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, check: 'malformed' };
  }

  // Raw text first: catches a token however the JSON is shaped or escaped-around.
  if (findCredential(text) !== null) return { ok: false, check: 'credential' };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, check: 'malformed' };
  }
  // Parsed values second: catches tokens hidden by JSON string escapes (_ ...).
  if (hasCredentialDeep(json)) return { ok: false, check: 'credential' };

  const parsed = CiResultArtifact.safeParse(json);
  if (!parsed.success) return { ok: false, check: 'schema' };
  const artifact = parsed.data;

  if (artifact.commit_sha.toLowerCase() !== expected.headSha.toLowerCase()) {
    return { ok: false, check: 'commit_sha' };
  }
  if (artifact.repository.toLowerCase() !== expected.repository.toLowerCase()) {
    return { ok: false, check: 'repository' };
  }
  return { ok: true, artifact };
}
