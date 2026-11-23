// Authenticated server-side Azure Speech proxy. Never expose Azure keys in the app.
import { createSupabaseContext } from "npm:@supabase/server@1.9.2";

const VOICES = new Set(["ru-RU-SvetlanaNeural", "ru-RU-DariyaNeural", "ru-RU-DmitryNeural"]);
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers });
const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // The Supabase gateway verifies the JWT too (verify_jwt=true), and this
  // check independently confirms the caller is a current authenticated user.
  const { error } = await createSupabaseContext(request, { auth: "user" });
  if (error) return json({ error: "Unauthorised" }, 401);
  const key = Deno.env.get("AZURE_SPEECH_KEY")?.trim();
  const region = Deno.env.get("AZURE_SPEECH_REGION")?.trim();
  const available = Boolean(key && region && /^[a-z0-9-]+$/.test(region));
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return json({ error: "Invalid request" }, 400); }
  if (!payload || typeof payload !== "object") return json({ error: "Invalid request" }, 400);
  const data = payload as Record<string, unknown>;
  if (data.action === "status") return json({ available });
  if (data.action !== "speak") return json({ error: "Unsupported action" }, 400);
  if (!available) return json({ error: "Azure Speech is not configured" }, 503);
  if (typeof data.voice !== "string" || !VOICES.has(data.voice)) return json({ error: "Unknown voice" }, 400);
  if (typeof data.text !== "string" || !data.text.trim() || data.text.length > 400)
    return json({ error: "Text must be 1–400 characters" }, 400);

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ru-RU"><voice name="${data.voice}"><prosody rate="-8%">${escapeXml(data.text.trim())}</prosody></voice></speak>`;
  try {
    const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key!,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "Heuresis",
      },
      body: ssml,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return json({ error: "Azure Speech request failed" }, 502);
    const audio = await response.arrayBuffer();
    if (!audio.byteLength || audio.byteLength > 2_000_000) return json({ error: "Invalid audio" }, 502);
    // Supabase Functions client recognises octet-stream as a Blob.
    return new Response(audio, { status: 200, headers: { ...headers, "Content-Type": "application/octet-stream" } });
  } catch {
    return json({ error: "Neural speech is temporarily unavailable" }, 502);
  }
});
