"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, Textarea, Tabs } from "@devdigest/ui";
import { INPUT_TABS, type InputTabKey } from "../../constants";

export interface InputTabsValue {
  diff: string;
  filesText: string;
  prTitle: string;
  prBody: string;
}

export function InputTabs({
  value,
  onChange,
}: {
  value: InputTabsValue;
  onChange: (patch: Partial<InputTabsValue>) => void;
}) {
  const t = useTranslations("eval.modal");
  const tc = useTranslations("eval.caseEditor");
  const [tab, setTab] = useState<InputTabKey>("diff");
  const tabs = INPUT_TABS.map((k) => ({ key: k, label: t(`tabs.${k}`) }));

  return (
    <div style={{ marginBottom: 20 }}>
      <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as InputTabKey)} pad="0" />
      <div style={{ paddingTop: 12 }}>
        {tab === "diff" && (
          <Textarea
            mono
            rows={12}
            value={value.diff}
            placeholder={tc("diffPlaceholder")}
            onChange={(v) => onChange({ diff: v })}
          />
        )}
        {tab === "files" && (
          <Textarea mono rows={6} value={value.filesText} onChange={(v) => onChange({ filesText: v })} />
        )}
        {tab === "prMeta" && (
          <>
            <FormField label={tc("titleLabel")}>
              <TextInput
                value={value.prTitle}
                placeholder={tc("titlePlaceholder")}
                onChange={(v) => onChange({ prTitle: v })}
                aria-label={tc("titleLabel")}
              />
            </FormField>
            <FormField label={tc("bodyLabel")}>
              <Textarea
                rows={5}
                value={value.prBody}
                placeholder={tc("bodyPlaceholder")}
                onChange={(v) => onChange({ prBody: v })}
              />
            </FormField>
          </>
        )}
      </div>
    </div>
  );
}
