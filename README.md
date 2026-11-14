# Freight Command

Your freight-broker command center: drop a rate confirmation, set a low and a high number,
and the bot calls (and emails) carriers at the same time in your voice. **First carrier to say
yes gets the load** — everyone else still on the line hears *"Looks like we found capacity,
no longer needed, and thank you."*

It also calls your customers for repeat work, using what it learned from their past loads.

## Try it right now (practice mode — no keys, no real calls)

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. Pick a load → **Find a truck** → watch the map.
Practice mode uses sample data and simulated calls, so nothing leaves your computer.

## What's on each screen

| Screen | What you do there |
|---|---|
| **Command Center** | Drop a rate con / load sheet (PDF, photo, screenshot). Check what was read, set *start offer* (low), *most you'll pay* (high) and how hard to negotiate. Press **Find a truck**, pick carriers and how many calls at once. Watch the live map. |
| **Customers** | Drop customer rate confirmations — it saves the contact's name, email, phone, what the job was and what it paid, then ranks who is due to ship again. Tick customers → **Call for loads**. Loads they give you land on the Command Center as drafts. |
| **Carriers** | Drop your Excel/CSV carrier list (any column names). Mark anyone "Do not call". |
| **History** | Every call and email: result, each price offered in the negotiation, transcript and summary. |
| **Go Live** | Checklist of which keys are set and what each one switches on. |
| **AI orb (bottom right)** | Type or talk: "what needs a truck?", "who should I call today?", "find a truck for the Dallas load". Anything that dials waits for your **Confirm** click. |

## Going live — where the keys go

Keys never go in the dashboard or in a chat. They go in **environment variables**:

- **On your computer:** copy `.env.example` to `.env.local`, paste each key after its name, restart.
- **Deployed (e.g. Vercel):** Project → Settings → Environment Variables, then redeploy.

Do it in this order (the **Go Live** screen tracks your progress):

1. `DASHBOARD_PASSWORD` — do this before the app is reachable from the internet.
2. `BROKER_NAME`, `COMPANY_NAME`, `CALLBACK_PHONE`, `APP_URL` (your public https address).
3. **Supabase** — create a project, run `supabase/migrations/001_init.sql` in the SQL Editor,
   set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
4. **Claude** — `ANTHROPIC_API_KEY` (reads documents, powers the assistant).
5. **ElevenLabs** — `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (your cloned voice), `TOOL_SECRET`
   (any long random string), then run:
   ```bash
   npm run setup:elevenlabs
   ```
   It creates the carrier agent and the customer agent and prints their IDs for
   `ELEVENLABS_CARRIER_AGENT_ID` / `ELEVENLABS_CUSTOMER_AGENT_ID`. Then set
   `ELEVENLABS_PHONE_NUMBER_ID` (your imported Twilio number) and, in ElevenLabs → Agents →
   Settings → Post-call webhook, point it at `APP_URL/api/webhooks/elevenlabs` and copy the
   signing secret into `ELEVENLABS_WEBHOOK_SECRET`.
6. **Twilio** — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (same account as that number). This is
   what lets the app cut in on the other live calls the instant a truck is booked.
7. **Resend** — `RESEND_API_KEY`, `EMAIL_FROM` for carrier emails with private bid links.

Each group switches on independently. Anything not configured keeps running in practice mode.

## How "first come, first served" works

- Every carrier price goes through one function (`submitOffer` in `lib/dispatcher.ts`), whether it
  came from a phone call or an email bid link.
- Booking is a single atomic database update (`book_load` in the SQL file). Two carriers saying
  yes in the same millisecond: one gets the load, the other gets "covered".
- The moment a load is booked, every other live call for it is taken over through Twilio and
  plays the line in your voice, calls still ringing are cancelled, carriers not yet dialed are
  skipped, and emailed carriers get a short "covered, thank you" note.

## How negotiation works

You set a **start offer** and a **ceiling**. The bot opens at the start offer and climbs a ladder
toward the ceiling only when pushed. The ceiling is never spoken unless the bot is standing on
it. The voice agent never invents a number — it asks the server what to say each round.
Styles: *Cover it fast* · *Balanced* · *Hold the line*.

## Before you call real people

- The agents introduce themselves as "**your name**'s AI assistant". That is on purpose: in the
  US, AI-voice calls are treated as artificial-voice calls under the TCPA (FCC, Feb 2024), and
  some states require telling people they are talking to a bot. You can edit the wording in
  `scripts/setup-elevenlabs.mjs`, but talk to a telecom/TCPA attorney before removing it or
  before dialing cell phones you have no relationship with.
- "Do not call" on a carrier or customer is always respected, and the agents set it themselves
  when someone asks.
- Place a test call to your own phone first.

## What has and hasn't been tested

Tested in practice mode: document → draft → rates → simultaneous calls → booking → release;
email bid links; the simultaneous-yes race; customer calls and load capture; Excel import;
the post-call webhook handler; the production build.

Not yet run against live accounts (needs your keys): real ElevenLabs calls, the agent-setup
script, the Twilio cut-in, Resend delivery, and Supabase (the SQL has not been run on a real
project yet). Expect small adjustments on first live run.

Scheduling note: the dialer advances when a call ends or a webhook arrives. Practice-mode
simulation uses in-process timers, so run practice mode locally rather than on serverless hosting.
