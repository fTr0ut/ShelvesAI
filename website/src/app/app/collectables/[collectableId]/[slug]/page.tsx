import type { Metadata } from "next";
import ShareLanding from "@/components/ShareLanding";
import { buildShareMetadata, fetchSharePayload } from "@/lib/shareMetadata";

type CollectableSharePageProps = {
  params: Promise<{ collectableId: string; slug: string }>;
};

async function loadPayload(paramsPromise: CollectableSharePageProps["params"]) {
  const params = await paramsPromise;
  return fetchSharePayload({
    kind: "collectables",
    id: params.collectableId,
    slug: params.slug,
  });
}

export async function generateMetadata({ params }: CollectableSharePageProps): Promise<Metadata> {
  const payload = await loadPayload(params);
  return buildShareMetadata(payload);
}

export default async function CollectableSharePage({ params }: CollectableSharePageProps) {
  const payload = await loadPayload(params);
  return <ShareLanding payload={payload} />;
}
