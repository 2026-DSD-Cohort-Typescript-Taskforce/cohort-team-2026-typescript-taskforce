import { forward } from "@/lib/forward";

export function PATCH(request: Request) {
  return forward(request, "/api/auth/email");
}
