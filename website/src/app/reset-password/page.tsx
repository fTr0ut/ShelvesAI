import type { Metadata } from "next";
import ResetPasswordClient from "./reset-password-client";

export const metadata: Metadata = {
  title: "Reset Password | ShelvesAI",
  description: "Reset your ShelvesAI account password.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const resolvedSearchParams = await searchParams;
  const tokenValue = resolvedSearchParams?.token;
  const initialToken = Array.isArray(tokenValue) ? tokenValue[0] ?? "" : tokenValue ?? "";

  return <ResetPasswordClient initialToken={initialToken.trim()} />;
}
