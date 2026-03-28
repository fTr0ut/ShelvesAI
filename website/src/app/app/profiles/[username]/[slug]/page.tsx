import type { Metadata } from "next";
import ShareLanding from "@/components/ShareLanding";
import { buildShareMetadata, fetchSharePayload } from "@/lib/shareMetadata";

type ProfileSharePageProps = {
  params: Promise<{ username: string; slug: string }>;
};

async function loadPayload(paramsPromise: ProfileSharePageProps["params"]) {
  const params = await paramsPromise;
  return fetchSharePayload({
    kind: "profiles",
    id: params.username,
    slug: params.slug,
  });
}

export async function generateMetadata({ params }: ProfileSharePageProps): Promise<Metadata> {
  const payload = await loadPayload(params);
  return buildShareMetadata(payload);
}

export default async function ProfileSharePage({ params }: ProfileSharePageProps) {
  const payload = await loadPayload(params);
  return <ShareLanding payload={payload} />;
}

