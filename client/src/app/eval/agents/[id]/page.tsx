import { EvalAgentDetailView } from "./_components/EvalAgentDetailView";

/* Route: /eval/agents/:id (Eval agent detail + Compare). Thin Server Component; Next 15 params is a Promise. */
export default async function EvalAgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EvalAgentDetailView agentId={id} />;
}
