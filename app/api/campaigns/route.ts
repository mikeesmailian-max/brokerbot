import { fail, json } from "@/lib/http";
import { asMode, startCapacityCampaign, startCustomerCampaign } from "@/lib/dispatcher";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const b = await req.json();
    // Email first is the default; phone is the follow-up.
    const mode = asMode(b.mode, b.alsoEmail === true ? "both" : b.alsoEmail === false ? "call_only" : "email_first");
    const campaign =
      b.type === "customer"
        ? await startCustomerCampaign({ customerIds: b.customerIds ?? [], concurrency: b.concurrency ?? 3, mode, waitMinutes: b.waitMinutes })
        : await startCapacityCampaign({ loadId: b.loadId, carrierIds: b.carrierIds ?? [], concurrency: b.concurrency ?? 5, mode, waitMinutes: b.waitMinutes });
    return json({ campaign });
  } catch (e) {
    return fail(e);
  }
}
