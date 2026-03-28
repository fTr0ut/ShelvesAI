import { NextResponse } from "next/server";

function splitCsv(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function GET() {
  const packageName = (process.env.ANDROID_APP_PACKAGE || "com.shelvesai.app").trim();
  const fingerprints = splitCsv(process.env.ANDROID_SHA256_CERT_FINGERPRINTS);

  const payload = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return NextResponse.json(payload, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
