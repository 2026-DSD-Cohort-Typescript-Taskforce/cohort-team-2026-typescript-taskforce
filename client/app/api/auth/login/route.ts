import { forward } from "@/lib/forward";

export function POST(request: Request) {
  return forward(request, "/api/auth/login");
}
