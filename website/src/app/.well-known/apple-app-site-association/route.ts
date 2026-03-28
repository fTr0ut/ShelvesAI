import { NextResponse } from "next/server";

function splitCsv(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function GET() {
  const bundleId = (process.env.IOS_BUNDLE_ID || "com.shelvesai.app").trim();
  const teamIds = splitCsv(process.env.APPLE_TEAM_IDS || process.env.APPLE_TEAM_ID);
  const appIds = teamIds.length
    ? teamIds.map((teamId) => `${teamId}.${bundleId}`)
    : [bundleId];

  const payload = {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: appIds,
          components: [
            { "/": "/app/*" },
            { "/": "/reset-password*" },
          ],
        },
      ],
    },
  };

  return NextResponse.json(payload, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
