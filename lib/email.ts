import { cfg, emailIsReal } from "./config";
import { laneOf, money } from "./format";
import type { Load } from "./types";

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!emailIsReal()) return false; // demo: nothing leaves the building
  const c = cfg();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${c.resend.key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: c.resend.from, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Email to ${to} failed (${res.status}): ${await res.text()}`);
  return true;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export function loadOfferEmail(load: Load, contact: string | null, bidUrl: string) {
  const c = cfg();
  const row = (k: string, v: unknown) => (v ? `<tr><td style="padding:4px 16px 4px 0;color:#667">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>` : "");
  return {
    subject: `Load available: ${laneOf(load)}${load.pickup_date ? " — picks " + load.pickup_date : ""}`,
    html: `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#1c2333;max-width:560px">
<p>Hi ${esc((contact || "there").split(" ")[0])},</p>
<p>${esc(c.brokerName)} with ${esc(c.companyName)} here. I have a load that may fit your truck:</p>
<table style="border-collapse:collapse">
${row("Lane", laneOf(load))}${row("Pickup", [load.pickup_date, load.pickup_time].filter(Boolean).join(" "))}${row("Delivery", [load.delivery_date, load.delivery_time].filter(Boolean).join(" "))}
${row("Equipment", load.equipment)}${row("Commodity", load.commodity)}${row("Weight", load.weight_lbs ? load.weight_lbs.toLocaleString() + " lbs" : "")}${row("Miles", load.miles)}
${row("Offering", money(load.target_rate))}${row("Notes", load.special_instructions)}
</table>
<p style="margin:22px 0"><a href="${esc(bidUrl)}" style="background:#2f6df6;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">I have a truck — send my rate</a></p>
<p style="color:#667">First carrier to confirm gets it.${c.callbackPhone ? " Or call " + esc(c.callbackPhone) + "." : ""}</p>
</div>`,
  };
}

export function coveredEmail(load: Load, contact: string | null) {
  const c = cfg();
  return {
    subject: `Covered: ${laneOf(load)}`,
    html: `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#1c2333"><p>Hi ${esc((contact || "there").split(" ")[0])},</p><p>Looks like we found capacity on ${esc(laneOf(load))}, so it's no longer needed. Thank you — more loads coming your way soon.</p><p>${esc(c.brokerName)}, ${esc(c.companyName)}</p></div>`,
  };
}
