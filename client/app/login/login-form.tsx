"use client";

import { useState, type FormEvent } from "react";

const inputClass =
  "w-full rounded-xl border-2 border-zinc-500 px-4 py-3 placeholder:italic placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="px-4 text-sm">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="Your email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="px-4 text-sm">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClass}
        />
      </div>

      {/* Always rendered, so screen readers announce the message when it appears. */}
      <p id="login-error" role="alert" className="min-h-5 px-4 text-sm text-red-700">
        {error}
      </p>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-zinc-500 px-4 py-3 text-white hover:bg-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-wait disabled:opacity-70"
      >
        {submitting ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}
