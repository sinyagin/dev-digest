/**
 * Structured-output failure with diagnostics. `reviewer-core` is a pure
 * engine with no dependency on `server`'s `AppError` taxonomy, so this is a
 * plain, dependency-free carrier — consumers (e.g. `server`) translate it
 * into their own typed error at the boundary.
 */
export class StructuredOutputError extends Error {
  constructor(
    message: string,
    public readonly schemaName: string,
    public readonly model: string,
    public readonly attempts: number,
    public readonly raw: string,
    public readonly finishReason?: string | null,
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}
