# Russian neural voices in Heuresis

Heuresis offers **Svetlana**, **Dariya** and **Dmitry** as Azure Speech neural voices for Russian Learning and Review. It keeps the device's Russian voices as offline fallback.

## Required one-time setup

1. Create an **Azure AI Speech** resource in Microsoft Azure (the free tier may be available, subject to Azure's limits and terms).
2. In the Supabase project used by Heuresis, open **Edge Functions → Secrets** and set:
   - `AZURE_SPEECH_KEY`: the Speech resource key (never store this in GitHub or client code).
   - `AZURE_SPEECH_REGION`: the resource's Azure region, e.g. `westeurope`.
3. Deploy the authenticated `heuresis-neural-speech` function from `supabase/functions/heuresis-neural-speech/index.ts` with JWT verification **enabled**.
4. Open **Heuresis → Settings → Study → Russian**, press **Refresh available voices**, and test the voices before choosing one.

The voices are shown but disabled while the secure service is unconfigured. Cloud speech needs a connection. Offline/device voices require no Azure account. Cloud failure in Learning/Review automatically falls back to the device voice; a failed sample instead reports that neural playback is unavailable, so samples cannot be confused with fallback.

Azure processes the text spoken by the chosen neural voice. Requests are authenticated, capped at 400 characters, restricted to the three Russian voice IDs, and do not cache the text or audio in the proxy. Usage beyond Azure's free allowance may incur charges; configure spending alerts or limits in Azure.
