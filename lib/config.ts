export const COVERED_LINE = "Looks like we found capacity, no longer needed, and thank you.";

export function cfg() {
  const e = process.env;
  return {
    appUrl: (e.APP_URL || "http://localhost:3000").replace(/\/$/, ""),
    brokerName: e.BROKER_NAME || "your broker",
    companyName: e.COMPANY_NAME || "our brokerage",
    callbackPhone: e.CALLBACK_PHONE || "",
    toolSecret: e.TOOL_SECRET || "",
    eleven: {
      key: e.ELEVENLABS_API_KEY || "",
      voiceId: e.ELEVENLABS_VOICE_ID || "",
      carrierAgent: e.ELEVENLABS_CARRIER_AGENT_ID || "",
      customerAgent: e.ELEVENLABS_CUSTOMER_AGENT_ID || "",
      phoneNumberId: e.ELEVENLABS_PHONE_NUMBER_ID || "",
      webhookSecret: e.ELEVENLABS_WEBHOOK_SECRET || "",
    },
    twilio: { sid: e.TWILIO_ACCOUNT_SID || "", token: e.TWILIO_AUTH_TOKEN || "" },
    resend: { key: e.RESEND_API_KEY || "", from: e.EMAIL_FROM || "" },
  };
}

/** Real phone calls only happen once ElevenLabs is fully configured. Otherwise calls are simulated. */
export function callsAreReal(type: "capacity" | "customer" = "capacity") {
  const c = cfg().eleven;
  return Boolean(c.key && c.phoneNumberId && (type === "capacity" ? c.carrierAgent : c.customerAgent));
}
export const emailIsReal = () => Boolean(cfg().resend.key && cfg().resend.from);
export const twilioReady = () => Boolean(cfg().twilio.sid && cfg().twilio.token);
