import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";

// Optimistic check only: is there a session cookie at all? Whether it is a
// valid, unexpired session is decided by getCurrentUser() on the server.
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/tasks/:path*", "/import/:path*"],
};
