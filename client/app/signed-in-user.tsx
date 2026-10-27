"use client";

import { useEffect, useState } from "react";

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
      <p role="alert" className="text-red-700">
        {error}
      </p>
    ) : (
      <p role="status" className="text-zinc-600">
        Loading your account…
      </p>
    );
  }

  return (
    <>
      <p className="text-lg">
        Signed in as <strong className="font-semibold">{user.user_name || user.user_email}</strong>
      </p>
      <button
        type="button"
        onClick={logOut}
        disabled={loggingOut}
        className="rounded-xl bg-zinc-500 px-6 py-3 text-white hover:bg-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-wait disabled:opacity-70"
      >
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
      <p role="alert" className="min-h-5 text-sm text-red-700">
        {error}
      </p>
    </>
  );
}
