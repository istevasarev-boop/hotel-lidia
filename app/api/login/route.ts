import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "hotel_lidia_session";

export async function POST(request: NextRequest) {
  const redirectUrl = new URL("/", request.url);
  redirectUrl.searchParams.set("loginError", "1");

  const response = NextResponse.redirect(redirectUrl, 303);
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/"
  });
  return response;
}
