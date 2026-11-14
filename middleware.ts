import { NextResponse, type NextRequest } from "next/server";

// Reachable without logging in: voice-agent tools and webhooks (they carry their own secrets),
// carrier bid links, and the audio clip Twilio plays.
const PUBLIC = [/^\/api\/tools\//, /^\/api\/webhooks\//, /^\/api\/bid\//, /^\/bid\//, /^\/api\/reply\//, /^\/reply\//, /^\/api\/audio\//, /^\/login$/, /^\/api\/login$/];

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next(); // demo / local
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((p) => p.test(path))) return NextResponse.next();
  const want = await sha256(password + "|freight-command");
  if (req.cookies.get("fc_session")?.value === want) {
    // Signed-in responses are for this person only: no proxy or CDN may keep a copy.
    const res = NextResponse.next();
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
