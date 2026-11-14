#!/usr/bin/env node
/**
 * One-time setup: creates the two voice agents (carrier calls + customer calls)
 * in your ElevenLabs account, wired to this app.
 *
 *   1. Deploy the app so it has a public https address, and set APP_URL to it.
 *   2. Fill in ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID and TOOL_SECRET in .env.local
 *   3. npm run setup:elevenlabs
 *   4. Copy the two agent IDs it prints into your environment variables.
 */
import fs from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID;
const SECRET = process.env.TOOL_SECRET;
const APP = (process.env.APP_URL || "").replace(/\/$/, "");
const missing = Object.entries({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: VOICE, TOOL_SECRET: SECRET, APP_URL: APP }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error("Missing in .env.local: " + missing.join(", ")); process.exit(1); }
if (!APP.startsWith("https://")) { console.error(`APP_URL must be your public https address (got "${APP}"). ElevenLabs can't reach localhost.`); process.exit(1); }

async function el(path, body) {
  const res = await fetch("https://api.elevenlabs.io/v1" + path, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`\nElevenLabs said no to ${path} (${res.status}):\n${text}\n`); process.exit(1); }
  return JSON.parse(text);
}

const fromCall = { type: "string", dynamic_variable: "call_id" }; // filled in by the app, not the AI
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

async function tool(name, description, path, properties, required = []) {
  const r = await el("/convai/tools", {
    tool_config: {
      type: "webhook",
      name,
      description,
      response_timeout_secs: 20,
      api_schema: {
        url: `${APP}/api/tools/${path}`,
        method: "POST",
        request_headers: { "x-tool-secret": SECRET },
        request_body_schema: { type: "object", properties: { call_id: fromCall, ...properties }, required: ["call_id", ...required] },
      },
    },
  });
  console.log(`  tool ${name} → ${r.id}`);
  return r.id;
}

const COVERED = "Looks like we found capacity, no longer needed, and thank you.";

const CARRIER_PROMPT = `# Who you are
You are the AI assistant for {{broker_name}} at {{company_name}}, a freight brokerage. You are on a phone call with {{carrier_name}}, a trucking company, to see if they can haul a load. If anyone asks, say plainly that you are {{broker_name}}'s AI assistant. Never claim to be a person.

# The load
- Load number: {{load_ref}}
- Pickup: {{origin}} — {{pickup}}
- Delivery: {{destination}} — {{delivery}}
- Equipment: {{equipment}}
- Freight: {{commodity}}, {{weight}}
- Miles: {{miles}}
- Notes: {{special_instructions}}
- Opening rate: {{opening_rate}} dollars, all-in

# How the call goes
1. Ask if they have a truck open near the pickup on the pickup date. If they are busy, offer to call back and log it.
2. If they might, give the lane, dates, equipment and weight, then offer the opening rate.
3. Price. Every time they name a price, or say yes to a price, call submit_offer with that number. The tool decides, and its "say" field tells you what to do next. Follow it. Only offer numbers the tool gives you. You do not know the budget, so never hint that more money is available.
4. If the tool says booked: confirm it is theirs at that rate, confirm their MC number, get the driver's name and cell, tell them the rate confirmation is coming by email, thank them, and end the call.
5. If any tool says the load is covered: say exactly "${COVERED}" and end the call. This load is offered to several carriers at once and the first to confirm gets it, so move quickly and never promise it before the tool says booked.
6. If they pass or you cannot agree: thank them, call log_call_outcome with "declined", and end the call.
7. If they ask not to be called again: apologise, call log_call_outcome with "do_not_call", and end the call.
8. If the conversation has gone on a while before price comes up, call check_load_status first so you do not pitch a load that is gone.

# How you talk
Friendly, plain broker-to-dispatcher talk. Short sentences, one question at a time. Say rates the way people do ("eighteen fifty"). Keep the call under four minutes. If they ask something you do not know (lumpers, detention, exact appointment), say {{broker_name}} will confirm it on the rate confirmation, and that they can reach {{broker_name}} at {{callback_phone}}.`;

const CUSTOMER_PROMPT = `# Who you are
You are the AI assistant for {{broker_name}} at {{company_name}}, a freight brokerage. You are calling {{customer_name}}, a customer, to ask whether they have any freight to move. If anyone asks, say plainly that you are {{broker_name}}'s AI assistant. Never claim to be a person.

# What we know about them
{{history_summary}}

# How the call goes
1. Greet them warmly and ask if they have anything shipping this week or next. Use what we know: mention their usual lane naturally ("anything going to Atlanta this week?"). Do not recite their history back to them.
2. If they have a load, collect: pickup city and state, delivery city and state, pickup date, equipment, what the freight is, weight, and the rate they have in mind if they offer one. Then call log_customer_load. Ask if there is anything else moving, and log each load separately.
3. Do not quote a price yourself. Say {{broker_name}} will send a rate and confirmation by email shortly.
4. If nothing right now: ask when to check back, thank them, and call log_call_outcome with "no_loads" or "callback" and the timing in notes.
5. If they ask not to be called: apologise, call log_call_outcome with "do_not_call", and end the call.
6. After the last load is logged, call log_call_outcome with "load_found" and end the call.

# How you talk
Warm, brief and respectful of their time — this is a relationship call, not a sales pitch. Short sentences, one question at a time. Keep it under three minutes. They can reach {{broker_name}} at {{callback_phone}}.`;

const systemTool = (kind, extra = {}) => ({ type: "system", name: kind, description: "", params: { system_tool_type: kind, ...extra } });

async function agent(name, firstMessage, prompt, toolIds, placeholders, voicemail) {
  const r = await el("/convai/agents/create", {
    name,
    conversation_config: {
      agent: {
        first_message: firstMessage,
        language: "en",
        dynamic_variables: { dynamic_variable_placeholders: placeholders },
        prompt: {
          prompt,
          tool_ids: toolIds,
          built_in_tools: {
            end_call: systemTool("end_call"),
            voicemail_detection: systemTool("voicemail_detection", { voicemail_message: voicemail }),
          },
        },
      },
      tts: { voice_id: VOICE },
      conversation: { max_duration_seconds: 420 },
    },
  });
  console.log(`  agent "${name}" → ${r.agent_id}`);
  return r.agent_id;
}

console.log("Creating tools…");
const submitOffer = await tool(
  "submit_offer",
  "Call this every time the carrier names a price or agrees to a price. It decides whether to accept or counter, and books the load if it is a yes. Always follow the 'say' field in the answer.",
  "submit_offer",
  { carrier_ask: num("The all-in rate in dollars the carrier asked for or agreed to"), mc_number: str("The carrier's MC number, if they gave it"), notes: str("Driver name, cell, truck details or anything else worth saving") },
  ["carrier_ask"],
);
const loadStatus = await tool("check_load_status", "Check whether the load is still available. If it says covered, say the line it gives you and end the call.", "load_status", {});
const logOutcome = await tool(
  "log_call_outcome",
  "Record how the call ended, right before you end it.",
  "log_outcome",
  { outcome: { type: "string", description: "How the call ended", enum: ["declined", "no_loads", "callback", "voicemail", "do_not_call", "load_found"] }, notes: str("One short sentence: why, or when to call back") },
  ["outcome"],
);
const customerLoad = await tool(
  "log_customer_load",
  "Save a load the customer wants moved. Call once per load.",
  "customer_load",
  {
    origin: str("Pickup city and state, like 'Dallas, TX'"), destination: str("Delivery city and state, like 'Atlanta, GA'"),
    pickup_date: str("Pickup date as YYYY-MM-DD"), equipment: str("Dry Van, Reefer, Flatbed, etc."), commodity: str("What the freight is"),
    weight_lbs: num("Weight in pounds"), rate: num("Rate in dollars, only if the customer named one"), notes: str("Anything else they said about this load"),
  },
  ["origin", "destination"],
);

console.log("Creating agents…");
const carrierAgent = await agent(
  "Freight Command — Carrier calls",
  "Hi {{contact_first_name}}, this is {{broker_name}}'s AI assistant over at {{company_name}}. I've got a load picking up in {{origin}} and wanted to see if you have a truck. Got a quick minute?",
  CARRIER_PROMPT,
  [submitOffer, loadStatus, logOutcome],
  { call_id: "test", broker_name: "Alex", company_name: "Acme Logistics", callback_phone: "555-0100", carrier_name: "Test Trucking", contact_first_name: "there", load_ref: "L-00001", origin: "Dallas, TX", destination: "Atlanta, GA", pickup: "tomorrow at 8 AM", delivery: "Friday", equipment: "Dry Van", commodity: "boxes", weight: "38,000 pounds", miles: "781", opening_rate: 1800, special_instructions: "none" },
  "Hi, this is {{broker_name}}'s AI assistant at {{company_name}} with a load out of {{origin}} going to {{destination}}. If you have a truck, call {{broker_name}} back at {{callback_phone}}. Thanks.",
);
const customerAgent = await agent(
  "Freight Command — Customer calls",
  "Hi {{contact_first_name}}, this is {{broker_name}}'s AI assistant at {{company_name}}. I'm checking in to see if you have any freight we can help you move this week. Is now an okay time?",
  CUSTOMER_PROMPT,
  [customerLoad, logOutcome],
  { call_id: "test", broker_name: "Alex", company_name: "Acme Logistics", callback_phone: "555-0100", customer_name: "Test Customer", contact_first_name: "there", history_summary: "No past loads on file. This is an introduction call." },
  "Hi, this is {{broker_name}}'s AI assistant at {{company_name}}, checking in to see if you have any freight we can help with. You can reach {{broker_name}} at {{callback_phone}}. Thank you.",
);

console.log(`
Done. Add these to your environment variables:

ELEVENLABS_CARRIER_AGENT_ID=${carrierAgent}
ELEVENLABS_CUSTOMER_AGENT_ID=${customerAgent}

Two things left to do in the ElevenLabs website:
  1. Agents → Phone Numbers: import your Twilio number, then copy its ID into ELEVENLABS_PHONE_NUMBER_ID.
  2. Agents → Settings → Post-call webhook: set the URL to
       ${APP}/api/webhooks/elevenlabs
     and copy the signing secret into ELEVENLABS_WEBHOOK_SECRET.
Then place one test call to your own phone before calling anyone else.
`);
