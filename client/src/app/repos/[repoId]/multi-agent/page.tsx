/* Legacy Configure run entry — /repos/:repoId/multi-agent. Configure run now
   lives at the global /multi-agent-review; this keeps old links working. */
import { redirect } from "next/navigation";

export default async function LegacyConfigureRunRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<{ pr?: string | string[] }>;
}) {
  const { repoId } = await params;
  const { pr } = await searchParams;
  const prNumber = Array.isArray(pr) ? pr[0] : pr;
  const qs = new URLSearchParams({ repo: repoId });
  if (prNumber) qs.set("pr", prNumber);
  redirect(`/multi-agent-review?${qs.toString()}`);
}
