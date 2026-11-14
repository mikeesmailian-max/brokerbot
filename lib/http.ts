import { NextResponse } from "next/server";
import { cfg } from "./config";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export function fail(e: unknown, status = 400) {
  const message = e instanceof Error ? e.message : String(e);
  if (status >= 500) console.error(e);
  return NextResponse.json({ error: message }, { status });
}

/** Voice-agent tool calls must carry the shared secret. */
export function toolAuthorized(req: Request): boolean {
  const secret = cfg().toolSecret;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-tool-secret") === secret;
}

export async function readFile(req: Request, field = "file") {
  const form = await req.formData();
  const f = form.get(field);
  if (!(f instanceof File)) throw new Error("No file received.");
  if (f.size > 30 * 1024 * 1024) throw new Error("That file is over 30 MB.");
  return { form, file: { name: f.name, type: f.type, buf: Buffer.from(await f.arrayBuffer()) } };
}
