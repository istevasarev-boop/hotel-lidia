import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const redirectUrl = new URL("/", request.url);

  if (!email || !password) {
    redirectUrl.searchParams.set("loginError", "1");
    return NextResponse.redirect(redirectUrl, 303);
  }

  try {
    const token = await signInWithFirebase(email, password);
    const response = NextResponse.redirect(redirectUrl, 303);
    response.cookies.set("hotel_lidia_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      path: "/"
    });
    return response;
  } catch {
    redirectUrl.searchParams.set("loginError", "1");
    return NextResponse.redirect(redirectUrl, 303);
  }
}

async function signInWithFirebase(email: string, password: string): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("Missing Firebase API key.");

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Login failed: ${response.status}`);
  const data = await response.json() as { idToken?: string };
  if (!data.idToken) throw new Error("Missing Firebase id token.");
  return data.idToken;
}
