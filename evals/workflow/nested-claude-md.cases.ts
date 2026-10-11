import type { WorkflowCase } from "../src/index.js";

/**
 * Nested CLAUDE.md files (server/, client/, e2e/) — do their package-only facts reach the answer?
 *
 * Claude Code injects a nested CLAUDE.md as memory when the session touches files in that folder;
 * it is NOT a Read tool call, so it never appears in `filesRead`. These cases therefore assert on
 * the ANSWER (`expectText`): each substring is a fact stated in the nested CLAUDE.md (or a root
 * Do-not-touch rule) that the model wouldn't volunteer otherwise. Each prompt names a concrete file
 * inside the folder so the session actually enters it and triggers the nested load.
 *
 * Budget: 3 Claude sessions — one per folder (server, client, e2e); expectText disables early stop.
 */
export const cases: WorkflowCase[] = [
  // --- S2 (1 session): server/CLAUDE.md + root "modules registered statically" ------------------
  {
    kind: "trace",
    name: "server/CLAUDE.md facts: secrets location, embeddings default, static module registry",
    prompt:
      "Подивись `server/src/platform/container.ts`, а потім коротко відповідай на кожен пункт окремо, " +
      "спираючись на настанови цього репо:\n" +
      "1. Я додаю ключ для нового LLM-провайдера в `server/`. Де мають зберігатися секрети (конкретний файл)?\n" +
      "2. Чи увімкнені ембединги в `server` за замовчуванням? Яка змінна оточення це контролює?\n" +
      "3. Я створив папку `server/src/modules/foo/` з Fastify-плагіном. Чи підхопиться вона автоматично? Що ще треба зробити?",
    expectText: ["secrets.json", "EMBEDDINGS_ENABLED", "modules/index.ts"],
    maxTurns: 8,
  },

  // --- S3a (1 session): client/CLAUDE.md --------------------------------------------------------
  // Was merged with the e2e questions, but a client + e2e session wandered into server routes and
  // hit maxTurns before answering. One folder per session keeps it short (like S2: 2 turns).
  {
    kind: "trace",
    name: "client/CLAUDE.md facts: hooks-only fetch, colocated _components",
    prompt:
      "Подивись `client/src/lib/hooks/agents.ts`, а потім коротко відповідай, спираючись на настанови " +
      "цього репо, без додаткового дослідження коду: на сторінці в `client/src/app/repos/[repoId]` треба " +
      "показати список агентів з API. Де і як робити запит і куди покласти новий компонент?",
    expectText: ["lib/hooks", "_components"],
    maxTurns: 6,
  },

  // --- S3b (1 session): e2e/CLAUDE.md + root Do-not-touch -----------------------------------------
  {
    kind: "trace",
    name: "e2e/CLAUDE.md + root Do-not-touch: hermetic e2e, seeded demo repo, keep pgdata",
    prompt:
      "Подивись `e2e/specs/02-repo-pulls-detail.flow.json`, а потім коротко відповідай на кожен пункт " +
      "окремо, спираючись на настанови цього репо, без додаткового дослідження коду:\n" +
      "1. Хочу прогнати цей e2e-флоу на своїй звичайній dev-базі. Це ок? Якщо ні — як правильно і що флоу очікує в базі?\n" +
      "2. База поводиться дивно — думаю зробити `docker compose down -v` і почати з нуля. Нормально?",
    expectText: ["e2e.sh", "payments-api", "devdigest_pgdata"],
    maxTurns: 6,
  },
];
