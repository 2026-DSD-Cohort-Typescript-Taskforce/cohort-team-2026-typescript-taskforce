import { backend } from "@/lib/backend";

export async function GET() {
  try {
    const res = await backend("/api/health");
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json(
      { status: "error", message: "Backend is unreachable" },
      { status: 502 }
    );
  }
}
