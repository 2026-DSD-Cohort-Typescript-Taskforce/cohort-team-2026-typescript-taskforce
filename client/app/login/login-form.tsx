"use client";

import { useState, type FormEvent } from "react";
import { ErrorAlert, Spinner, colorTransition, focusRing, primaryButton } from "../ui";

const inputClass = `h-12 w-full rounded-input border border-strong bg-background px-4 text-body text-foreground placeholder:text-secondary focus-visible:border-primary aria-invalid:border-danger ${colorTransition} ${focusRing}`;

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    // Clear first so the same message is announced again on a repeat failure.
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // A full page load, so proxy.ts sees the new session cookies and no page state
        // from before sign-in survives.
        window.location.replace("/");
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong. Try again.");
    } catch {
      setError("Could not reach the server. Try again.");
    }
    setSubmitting(false);
  }

  const describedBy = error ? "login-error" : undefined;

  return (
    <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-body-sm font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="name@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-body-sm font-medium">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={`${inputClass} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label="Show password"
            aria-pressed={showPassword}
            className={`absolute top-1 right-1 grid size-10 place-items-center rounded-lg text-secondary hover:bg-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary ${colorTransition}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-5"
            >
              <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
              <circle cx="12" cy="12" r="3" />
              {showPassword && <path d="m4 4 16 16" />}
            </svg>
          </button>
        </div>
      </div>

      {/* The alert's box brings its own margin, so no gap is left when there is no error. */}
      <div className="flex flex-col">
        <ErrorAlert id="login-error" message={error} className="mb-6" />
        <button
          type="submit"
          disabled={submitting}
          data-pending={submitting || undefined}
          className={`w-full ${primaryButton}`}
        >
          {submitting && <Spinner />}
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
