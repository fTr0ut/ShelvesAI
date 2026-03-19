"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./reset-password.module.css";

type ValidationStatus = "idle" | "validating" | "valid" | "invalid" | "error";
type SubmissionStatus = "idle" | "submitting" | "success" | "error";

type ResetPasswordClientProps = {
  initialToken: string;
};

const MIN_PASSWORD_LENGTH = 8;

function normalizeApiBase(value: string | undefined): string {
  return (value || "").trim().replace(/\/+$/, "");
}

export default function ResetPasswordClient({ initialToken }: ResetPasswordClientProps) {
  const apiBase = normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE);
  const deepLinkBase =
    (process.env.NEXT_PUBLIC_RESET_DEEP_LINK_BASE || "shelvesai://reset-password")
      .trim()
      .replace(/\/+$/, "");

  const [showWebForm, setShowWebForm] = useState(false);
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>("idle");
  const [validationMessage, setValidationMessage] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus>("idle");
  const [submissionMessage, setSubmissionMessage] = useState("");

  const token = initialToken;
  const deepLink = useMemo(
    () => `${deepLinkBase}?token=${encodeURIComponent(token)}`,
    [deepLinkBase, token],
  );

  useEffect(() => {
    if (!token) {
      setValidationStatus("invalid");
      setValidationMessage("Invalid or missing reset token.");
      setShowWebForm(true);
      return;
    }

    if (!apiBase) {
      setValidationStatus("error");
      setValidationMessage("Website is missing API configuration.");
      setShowWebForm(true);
      return;
    }

    let isMounted = true;
    let appOpened = false;
    const visibilityHandler = () => {
      if (document.hidden) {
        appOpened = true;
      }
    };

    document.addEventListener("visibilitychange", visibilityHandler);

    const launchTimer = window.setTimeout(() => {
      window.location.assign(deepLink);
    }, 250);

    const fallbackTimer = window.setTimeout(() => {
      if (!appOpened && isMounted) {
        setShowWebForm(true);
      }
      document.removeEventListener("visibilitychange", visibilityHandler);
    }, 1600);

    const scrubTimer = window.setTimeout(() => {
      if (window.location.search.includes("token=")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    }, 600);

    const validateToken = async () => {
      setValidationStatus("validating");
      setValidationMessage("Validating reset token...");

      try {
        const response = await fetch(
          `${apiBase}/api/auth/validate-reset-token?token=${encodeURIComponent(token)}`,
          { method: "GET", cache: "no-store" },
        );

        const payload = (await response.json()) as { valid?: boolean; error?: string };

        if (!response.ok || !payload.valid) {
          if (!isMounted) return;
          setValidationStatus("invalid");
          setValidationMessage(payload.error || "Invalid or expired reset token.");
          setShowWebForm(true);
          return;
        }

        if (!isMounted) return;
        setValidationStatus("valid");
        setValidationMessage("Token is valid. You can reset your password on this page.");
      } catch {
        if (!isMounted) return;
        setValidationStatus("error");
        setValidationMessage("Unable to validate reset token. Please try again.");
        setShowWebForm(true);
      }
    };

    void validateToken();

    return () => {
      isMounted = false;
      window.clearTimeout(launchTimer);
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(scrubTimer);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, [apiBase, deepLink, token]);

  const canSubmit = validationStatus === "valid" && submissionStatus !== "submitting";

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token) {
      setSubmissionStatus("error");
      setSubmissionMessage("Invalid or missing reset token.");
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setSubmissionStatus("error");
      setSubmissionMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    if (password !== confirmPassword) {
      setSubmissionStatus("error");
      setSubmissionMessage("Passwords do not match.");
      return;
    }

    if (!apiBase) {
      setSubmissionStatus("error");
      setSubmissionMessage("Website is missing API configuration.");
      return;
    }

    setSubmissionStatus("submitting");
    setSubmissionMessage("Resetting password...");

    try {
      const response = await fetch(`${apiBase}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
        cache: "no-store",
      });

      const payload = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to reset password.");
      }

      setSubmissionStatus("success");
      setSubmissionMessage(payload.message || "Password reset successful.");
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reset password.";
      setSubmissionStatus("error");
      setSubmissionMessage(message);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>ShelvesAI Account</p>
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.description}>
          We&apos;ll try to open the app first. If it doesn&apos;t launch, finish the reset here.
        </p>

        <div className={styles.actions}>
          <a className={styles.primaryButton} href={deepLink}>
            Open in app
          </a>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => setShowWebForm(true)}
          >
            Use web form
          </button>
        </div>

        <p
          className={`${styles.statusLine} ${
            validationStatus === "invalid" || validationStatus === "error" ? styles.error : styles.muted
          }`}
        >
          {validationMessage}
        </p>

        {showWebForm ? (
          <form className={styles.form} onSubmit={onSubmit}>
            <label className={styles.label} htmlFor="password">
              New password
            </label>
            <input
              id="password"
              className={styles.input}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              required
            />

            <label className={styles.label} htmlFor="confirmPassword">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              className={styles.input}
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              required
            />

            <button className={styles.primaryButton} type="submit" disabled={!canSubmit}>
              {submissionStatus === "submitting" ? "Resetting..." : "Reset password"}
            </button>

            {submissionMessage ? (
              <p
                className={`${styles.statusLine} ${
                  submissionStatus === "success"
                    ? styles.success
                    : submissionStatus === "error"
                      ? styles.error
                      : styles.muted
                }`}
              >
                {submissionMessage}
              </p>
            ) : null}
          </form>
        ) : (
          <p className={`${styles.statusLine} ${styles.muted}`}>
            Waiting for app launch. If nothing happens, choose &quot;Use web form&quot;.
          </p>
        )}

        <p className={styles.footerNote}>
          Need to sign in after resetting? <Link href="/">Return to ShelvesAI</Link>
        </p>
      </div>
    </main>
  );
}
