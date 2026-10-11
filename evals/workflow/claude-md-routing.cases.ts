import type { WorkflowCase } from "../src/index.js";

/**
 * Root CLAUDE.md routing — "Before answering: search <package>/docs, INSIGHTS.md and specs/ FIRST",
 * the Map's docs/agent-prompts ↔ seed-prompts.ts mirror, subagent dispatch, and the
 * engineering-insights activation pair.
 *
 * Budget: 4 Claude sessions.
 *   - 1 × merged trace (3 numbered questions, Read-only asserts → early stop) = 1
 *   - 1 × dispatch trace (kept alone: early stop must fire on the spawn)      = 1
 *   - 1 × activation pair (positive + near-miss negative)                     = 2
 *
 * The activation pair can't be merged: a session that already recorded a "discovery" would make
 * the negative's explanation activate the skill too — the negative needs a clean session.
 */
export const cases: WorkflowCase[] = [
  // --- S1 (1 session): three "Before answering" routes at once ---------------------------------
  {
    kind: "trace",
    name: "Before-answering routing: server INSIGHTS + cross-module spec + agent-prompts mirror",
    prompt:
      "Перш ніж відповідати, звірся з настановами цього репо (CLAUDE.md) щодо того, де шукати відповідь, " +
      "і прочитай відповідні файли. Відповідай на кожен пункт окремо:\n" +
      "1. Чи синхронізується скопійований `client/src/vendor/shared` із серверною версією? Чи вже були з цим проблеми?\n" +
      "2. Що вже вирішено щодо фічі PR why / risk brief — де її специфікація і що там сказано?\n" +
      "3. Я хочу змінити системний промпт вбудованого агента general-reviewer. У яких місцях він живе — " +
      "покажи обидва (документацію і те, що реально сідиться в БД).",
    expectFilesRead: [
      "server/INSIGHTS.md",
      "specs/cross-module/SPEC-02",
      "docs/agent-prompts/general-reviewer.md",
      "server/src/db/seed-prompts.ts",
    ],
    maxTurns: 12,
  },

  // --- S4 (1 session): subagent dispatch -------------------------------------------------------
  {
    kind: "trace",
    // The module must NOT exist yet, or the model reviews existing code inline instead of dispatching.
    name: "dispatches architecture-reviewer to audit a planned server module",
    prompt:
      "Я планую новий серверний модуль `server/src/modules/exports/`: роут GET /reviews/:id/export сам " +
      "робить select з Drizzle і форматує markdown. ОБОВʼЯЗКОВО запусти сабагента architecture-reviewer, " +
      "щоб він оцінив цей план на відповідність onion-шарам — не рецензуй сам.",
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 6,
  },

  // --- S5 + S6 (2 sessions): activation pair -----------------------------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
