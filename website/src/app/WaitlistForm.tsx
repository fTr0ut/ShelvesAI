"use client";

import { FormEvent, useState } from "react";
import styles from "./waitlist-form.module.css";

type SubmissionStatus = "idle" | "submitting" | "success" | "error";

type WaitlistFormProps = {
  ctaLabel: string;
};

function normalizeApiBase(value: string | undefined): string {
  return (value || "").trim().replace(/\/+$/, "");
}

export default function WaitlistForm({ ctaLabel }: WaitlistFormProps) {
  const apiBase = normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [message, setMessage] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!apiBase) {
      setStatus("error");
      setMessage("Website is missing API configuration.");
      return;
    }

    setStatus("submitting");
    setMessage("Joining waitlist...");

    try {
      const response = await fetch(`${apiBase}/api/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        cache: "no-store",
      });

      const payload = (await response.json()) as {
        success?: boolean;
        alreadySubscribed?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to join waitlist.");
      }

      setStatus("success");
      setMessage(
        payload.alreadySubscribed
          ? "You are already on the waitlist. We will notify you when ShelvesAI launches."
          : "Thanks! You are on the waitlist. We will notify you when ShelvesAI launches.",
      );
      setEmail("");
    } catch (error) {
      const nextMessage =
        error instanceof Error ? error.message : "Failed to join waitlist. Please try again.";
      setStatus("error");
      setMessage(nextMessage);
    }
  };

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label className={styles.label} htmlFor="waitlist-email">
        Email address
      </label>
      <div className={styles.controls}>
        <input
          id="waitlist-email"
          className={styles.input}
          type="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          disabled={status === "submitting"}
        />
        <button className={`btn-primary ${styles.button}`} type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Joining..." : ctaLabel}
        </button>
      </div>
      {message ? (
        <p
          className={`${styles.statusLine} ${
            status === "success" ? styles.success : status === "error" ? styles.error : styles.muted
          }`}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
