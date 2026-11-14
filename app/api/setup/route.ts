import { json } from "@/lib/http";
import { cfg } from "@/lib/config";

export const dynamic = "force-dynamic";

const has = (k: string) => Boolean(process.env[k]?.trim());

/** Which keys are in place. Only ever reports yes/no — never a value. */
export async function GET() {
  const group = (id: string, title: string, unlocks: string, where: string, keys: [string, string][]) => ({
    id, title, unlocks, where,
    keys: keys.map(([name, help]) => ({ name, help, set: has(name) })),
  });
  return json({
    appUrl: cfg().appUrl,
    groups: [
      group("lock", "1 · Lock the door", "A password on this dashboard. Do this first — the app can place phone calls.", "You make this up.", [
        ["DASHBOARD_PASSWORD", "Any strong password"],
      ]),
      group("you", "2 · Who's calling", "How the bot introduces itself, and where links point.", "Your details.", [
        ["BROKER_NAME", "Your first name, as said on calls"],
        ["COMPANY_NAME", "Your brokerage name"],
        ["CALLBACK_PHONE", "Number carriers can call back"],
        ["APP_URL", "The web address of this app once deployed, e.g. https://command.yourcompany.com"],
      ]),
      group("db", "3 · History database", "Everything is saved for good: loads, calls, transcripts, every price offered.", "supabase.com → your project → Project Settings → API. Then run supabase/migrations/001_init.sql in the SQL Editor.", [
        ["SUPABASE_URL", "Project URL"],
        ["SUPABASE_SERVICE_ROLE_KEY", "service_role key (keep secret)"],
      ]),
      group("claude", "4 · Document reading + assistant", "Reads rate confirmations and powers the chat assistant.", "console.anthropic.com → API Keys.", [
        ["ANTHROPIC_API_KEY", "Claude API key"],
      ]),
      group("voice", "5 · Voice calls", "Real phone calls in your voice.", "elevenlabs.io → API Keys, Voices, Agents → Phone Numbers. Then run: npm run setup:elevenlabs (it creates both agents and prints the two agent IDs).", [
        ["ELEVENLABS_API_KEY", "ElevenLabs API key"],
        ["ELEVENLABS_VOICE_ID", "Your cloned voice ID"],
        ["ELEVENLABS_PHONE_NUMBER_ID", "ID of the Twilio number imported into ElevenLabs"],
        ["TOOL_SECRET", "Any long random string — the agents use it to talk to this app"],
        ["ELEVENLABS_CARRIER_AGENT_ID", "Printed by the setup script"],
        ["ELEVENLABS_CUSTOMER_AGENT_ID", "Printed by the setup script"],
        ["ELEVENLABS_WEBHOOK_SECRET", "From ElevenLabs → Agents → Settings → Post-call webhook"],
      ]),
      group("twilio", "6 · Instant cut-in", "The moment a truck is booked, every other live call hears “Looks like we found capacity…” in your voice.", "twilio.com/console — same account as the number you imported into ElevenLabs.", [
        ["TWILIO_ACCOUNT_SID", "Account SID"],
        ["TWILIO_AUTH_TOKEN", "Auth Token"],
      ]),
      group("email", "7 · Email", "Emails carriers the load with a private bid link, and emails customers a check-in with one-tap answers. Email goes first; phone is the follow-up.", "resend.com → API Keys, and verify your sending domain.", [
        ["RESEND_API_KEY", "Resend API key"],
        ["EMAIL_FROM", "e.g. Dispatch <dispatch@yourcompany.com>"],
      ]),
    ],
  });
}
