import type { Metadata } from "next";
import ShareLanding from "@/components/ShareLanding";
import { buildShareMetadata, fetchSharePayload } from "@/lib/shareMetadata";

type ManualSharePageProps = {
  params: Promise<{ manualId: string; slug: string }>;
};

async function loadPayload(paramsPromise: ManualSharePageProps["params"]) {
  const params = await paramsPromise;
  return fetchSharePayload({
    kind: "manuals",
    id: params.manualId,
    slug: params.slug,
  });
}

export async function generateMetadata({ params }: ManualSharePageProps): Promise<Metadata> {
  const payload = await loadPayload(params);
  return buildShareMetadata(payload);
}

export default async function ManualSharePage({ params }: ManualSharePageProps) {
  const payload = await loadPayload(params);
  return <ShareLanding payload={payload} />;
}
