/* LearnButton — turns a finding into a durable `learning` memory (no LLM call).
   "Learned" is session-scoped: the memory id lives in the query cache under
   ["finding-learned", id] (see useLearnFinding). Failures surface through the
   app-wide MutationCache toast (lib/providers.tsx), which shows the server message. */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useFindingLearned, useLearnFinding } from "@/lib/hooks/reviews";

export function LearnButton({ findingId }: { findingId: string }) {
  const t = useTranslations("prReview");
  const learn = useLearnFinding();
  const { data: memoryId } = useFindingLearned(findingId);
  const learned = !!memoryId;
  const label = learned ? t("finding.learned") : learn.isPending ? t("finding.learning") : t("finding.learn");

  return (
    <Button
      kind="ghost"
      size="sm"
      icon={learned ? "Check" : "Brain"}
      disabled={learned || learn.isPending}
      onClick={() => learn.mutate({ findingId })}
    >
      {label}
    </Button>
  );
}
