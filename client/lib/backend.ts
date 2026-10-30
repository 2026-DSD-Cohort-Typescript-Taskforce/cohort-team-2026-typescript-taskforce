import "server-only";

const API_URL = process.env.API_URL ?? "http://localhost:5000";

export function backend(path: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}