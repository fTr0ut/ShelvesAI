import type { Metadata } from "next";
import ShareLanding from "@/components/ShareLanding";
import { buildShareMetadata, fetchSharePayload } from "@/lib/shareMetadata";

type ShelfSharePageProps = {
  params: Promise<{ shelfId: string; slug: string }>;
};

async function loadPayload(paramsPromise: ShelfSharePageProps["params"]) {
  const params = await paramsPromise;
  return fetchSharePayload({
    kind: "shelves",
    id: params.shelfId,
    slug: params.slug,
  });
}

export async function generateMetadata({ params }: ShelfSharePageProps): Promise<Metadata> {
  const payload = await loadPayload(params);
  return buildShareMetadata(payload);
}

export default async function ShelfSharePage({ params }: ShelfSharePageProps) {
  const payload = await loadPayload(params);
  return <ShareLanding payload={payload} />;
}
