import { NextResponse, type NextRequest } from "next/server";

// Set by the Express server (server/src/config/cookies.ts). These checks are optimistic:
// they only look for the cookies. Express verifies the session on every /api call.
const SESSION_COOKIES = ["sb-access-token", "sb-refresh-token"];

export function proxy(request: NextRequest) {
  const signedIn = SESSION_COOKIES.some((name) => request.cookies.has(name));
  const { pathname } = request.nextUrl;

  if (pathname === "/" && !signedIn) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (pathname === "/login" && signedIn) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login"],
};
