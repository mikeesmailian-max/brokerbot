import { fail, json } from "@/lib/http";
import { startCapacityCampaign, startCustomerCampaign } from "@/lib/dispatcher";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const campaign =
      b.type === "customer"
        ? await startCustomerCampaign({ customerIds: b.customerIds ?? [], concurrency: b.concurrency ?? 3 })
        : await startCapacityCampaign({
            loadId: b.loadId,
            carrierIds: b.carrierIds ?? [],
            concurrency: b.concurrency ?? 5,
            alsoEmail: Boolean(b.alsoEmail),
          });
    return json({ campaign });
  } catch (e) {
    return fail(e);
  }
}
