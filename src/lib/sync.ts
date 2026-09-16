import { listArchivedPacks, listCatalogues } from "./advanced";
import { listCardTypes, listCollections, listPacks, listTags, listAllCards } from "./heuresis";
import { getLearningCounts } from "./learning";
import { flushOfflineRequests, markOfflineSyncComplete, refreshOfflinePendingCount, setOfflineSyncError, setOfflineSyncing } from "./offlineFetch";
import { listRelatedCatalogue, listRelatedCards, listRelatedCounts } from "./related";
import { listStructureTemplates } from "./settingsData";
import { flushStudyEvents, loadStudySetup, retryParkedStudyEvents } from "./study";
import { supabase } from "./supabase";

export type SynchroniseResult = {
  packs: number;
  cards: number;
  pending: number;
};

export async function synchroniseHeuresis(): Promise<SynchroniseResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await refreshOfflinePendingCount();
    throw new Error("No internet connection. Heuresis is using the copy stored on this device.");
  }
  if (!supabase) throw new Error("Supabase is not configured.");

  setOfflineSyncing(true);
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? null;

    // Replay ordinary offline writes first. Sessions are deliberately queued here
    // before review events, so their foreign keys exist before event replay.
    await flushOfflineRequests(accessToken);
    await retryParkedStudyEvents().catch(() => undefined);
    await flushStudyEvents().catch(() => undefined);

    const [collections, packs, archived, cardTypes] = await Promise.all([
      listCollections(),
      listPacks(),
      listArchivedPacks(),
      listCardTypes(),
      listTags(),
      listCatalogues(),
      listRelatedCatalogue(null, null),
      listRelatedCounts(),
    ]).then((values) => [values[0], values[1], values[2], values[3]] as const);

    // Keep settings/study-direction queries available offline as well.
    await Promise.all(cardTypes.map((type) => listStructureTemplates(type.id).catch(() => [])));

    let cardCount = 0;
    for (const pack of [...packs, ...archived]) {
      const cards = await listAllCards(pack.id);
      cardCount += cards.length;
      await loadStudySetup(pack.id, pack.card_type_id).catch(() => undefined);
      await listRelatedCards(pack.id).catch(() => []);
      if (cards.length) await getLearningCounts(cards.map((card) => card.id)).catch(() => ({}));
    }

    // Keep the collections read warm even when the user synchronises from a
    // secondary screen and never visits Library during this session.
    void collections;
    markOfflineSyncComplete();
    return { packs: packs.length + archived.length, cards: cardCount, pending: await refreshOfflinePendingCount() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not synchronise Heuresis.";
    setOfflineSyncError(message);
    throw error;
  }
}
