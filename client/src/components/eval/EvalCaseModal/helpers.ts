import { EvalCaseInput, EvalExpectation } from "@devdigest/shared";

export interface FormState {
  name: string;
  diff: string;
  filesText: string;
  prTitle: string;
  prBody: string;
  expectationText: string;
  notes: string;
}

export type ExpectationCheck =
  | { ok: true; value: EvalExpectation }
  | { ok: false; field: string };

export function filesToText(files: string[]): string {
  return files.join("\n");
}

export function textToFiles(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function toFormState(initial: EvalCaseInput): FormState {
  return {
    name: initial.name,
    diff: initial.input_diff,
    filesText: filesToText(initial.input_files),
    prTitle: initial.input_meta.title,
    prBody: initial.input_meta.body ?? "",
    expectationText: JSON.stringify(initial.expectation, null, 2),
    notes: initial.notes ?? "",
  };
}

/** Parse + validate the expectation JSON; on failure name the first failing field (AC-5). */
export function checkExpectation(text: string): ExpectationCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, field: "JSON" };
  }
  const parsed = EvalExpectation.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue && issue.path.length > 0 ? issue.path.join(".") : "expectation";
  return { ok: false, field };
}

/** Full payload from form state, or null while anything is invalid. */
export function buildInput(form: FormState, base: EvalCaseInput): EvalCaseInput | null {
  const exp = checkExpectation(form.expectationText);
  if (!exp.ok) return null;
  const candidate = {
    name: form.name.trim(),
    input_diff: form.diff,
    input_files: textToFiles(form.filesText),
    input_meta: {
      pr_number: base.input_meta.pr_number,
      title: form.prTitle,
      body: form.prBody.length > 0 ? form.prBody : null,
    },
    expectation: exp.value,
    notes: form.notes.trim().length > 0 ? form.notes : null,
    source_finding_id: base.source_finding_id ?? null,
  };
  const parsed = EvalCaseInput.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
