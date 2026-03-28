import type { Metadata } from "next";
import ShareLanding from "@/components/ShareLanding";
import { buildShareMetadata, fetchSharePayload } from "@/lib/shareMetadata";

type EventSharePageProps = {
  params: Promise<{ eventId: string; slug: string }>;
};

async function loadPayload(paramsPromise: EventSharePageProps["params"]) {
  const params = await paramsPromise;
  return fetchSharePayload({
    kind: "events",
    id: params.eventId,
    slug: params.slug,
  });
}

export async function generateMetadata({ params }: EventSharePageProps): Promise<Metadata> {
  const payload = await loadPayload(params);
  return buildShareMetadata(payload);
}

export default async function EventSharePage({ params }: EventSharePageProps) {
  const payload = await loadPayload(params);
  return <ShareLanding payload={payload} />;
}
