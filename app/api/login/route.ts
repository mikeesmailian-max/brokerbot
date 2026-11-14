import { createHash } from "crypto";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const real = process.env.DASHBOARD_PASSWORD || "";
  if (!real || password !== real) return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  const token = createHash("sha256").update(real + "|freight-command").digest("hex");
  const res = NextResponse.json({ ok: true });
  res.cookies.set("fc_session", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
