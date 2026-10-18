/**
 * Credential-shaped value scrub (C9). LOCAL COPY of the server's
 * `CREDENTIAL_PATTERNS` (server/src/modules/ci/verify-artifact.ts): that file
 * imports fflate at runtime, which must not enter this bundle. Keep the two
 * lists identical — `src/parity.test.ts` asserts it.
 */
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

export function findCredential(text: string): string | null {
  for (const p of CREDENTIAL_PATTERNS) if (p.re.test(text)) return p.name;
  return null;
}

/** Replace every credential-shaped substring (and any literal secret) with a marker. */
export function redact(text: string, literals: readonly string[] = []): string {
  let out = text;
  for (const lit of literals) if (lit.length >= 8) out = out.split(lit).join('[redacted]');
  for (const p of CREDENTIAL_PATTERNS) {
    out = out.replace(new RegExp(p.re.source, 'g'), '[redacted]');
  }
  return out;
}
