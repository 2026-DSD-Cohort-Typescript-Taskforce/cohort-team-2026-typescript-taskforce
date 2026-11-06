"use client";

import { useEffect, useState } from "react";
import { ErrorAlert, Spinner, secondaryButton } from "./ui";

type Profile = {
  user_name: string | null;
  user_email: string | null;
};

export function SignedInUser() {
  const [user, setUser] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadUser() {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          // Clear any leftover cookies first, or proxy.ts would send /login straight back here.
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.replace("/login");
          return;
        }
        if (!res.ok) throw new Error(`GET /api/auth/me returned ${res.status}`);
        const body = await res.json();
        if (active) setUser(body.user);
      } catch {
        if (active) setError("Could not load your account. Refresh the page to try again.");
      }
    }
    loadUser();
    return () => {
      active = false;
    };
  }, []);

  async function logOut() {
    setError("");
    setLoggingOut(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.replace("/login");
        return;
      }
    } catch {}
    setError("Could not log out. Try again.");
    setLoggingOut(false);
  }

  if (!user) {
    return error ? (
      <ErrorAlert message={error} />
    ) : (
      <p role="status" className="text-body text-secondary">
        Loading your account…
      </p>
    );
  }

  return (
    <>
      <p className="text-body-lg text-secondary">
        Signed in as{" "}
        <strong className="font-semibold text-foreground">{user.user_name || user.user_email}</strong>
      </p>
      <div className="flex w-full flex-col items-center">
        <button
          type="button"
          onClick={logOut}
          disabled={loggingOut}
          data-pending={loggingOut || undefined}
          className={secondaryButton}
        >
          {loggingOut && <Spinner />}
          {loggingOut ? "Logging out…" : "Log out"}
        </button>
        <ErrorAlert message={error} className="mt-4 text-left" />
      </div>
    </>
  );
}
