"use client";

import { useTranslations } from "next-intl";
import { Button, FormField, Textarea } from "@devdigest/ui";
import type { ExpectationCheck } from "../../helpers";
import * as s from "../../styles";

export function ExpectationEditor({
  value,
  check,
  onChange,
  onInsertSkeleton,
}: {
  value: string;
  check: ExpectationCheck;
  onChange: (v: string) => void;
  onInsertSkeleton: () => void;
}) {
  const t = useTranslations("eval.modal");
  return (
    <FormField
      label={t("expectedOutput")}
      right={
        <Button kind="ghost" size="sm" type="button" onClick={onInsertSkeleton}>
          {t("skeletonButton")}
        </Button>
      }
    >
      <Textarea mono rows={10} value={value} onChange={onChange} />
      {check.ok ? (
        <div style={s.validText} role="status">{t("expectedValid")}</div>
      ) : (
        <div style={s.invalidText} role="alert">{t("expectedInvalid", { field: check.field })}</div>
      )}
    </FormField>
  );
}
