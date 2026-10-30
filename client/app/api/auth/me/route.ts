import { forward } from "@/lib/forward";

export function GET(request: Request) {
  return forward(request, "/api/auth/me");
}
