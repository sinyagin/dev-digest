/* context-attachments — the shared attach/detach/reorder picker consumed by
   both the Agent and Skill editors' Context tabs.
   Public surface: the component + its props type, plus the pure helpers a
   wrapping tab may reuse for its own footer/pill copy (e.g. the attached
   token sum) rather than recomputing them. */
export { ContextAttachmentPicker } from "./ContextAttachmentPicker";
export type { ContextAttachmentPickerProps } from "./ContextAttachmentPicker";
export { attachedTokenSum, formatTokenEstimate } from "./helpers";
export type { AttachmentRow } from "./helpers";
