/**
 * Keep tests hermetic: blank the LLM provider keys BEFORE `dotenv/config` runs
 * (it never overrides a var that already exists). Otherwise a key in
 * `server/.env` makes un-mocked providers real — e.g. review intent defaults to
 * openrouter, so every review test made a live, paid network call whose latency
 * intermittently blew past `waitForPrRuns`' 10s timeout.
 */
for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']) {
  process.env[key] = '';
}
