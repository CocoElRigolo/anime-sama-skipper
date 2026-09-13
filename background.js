// background.js
// Rôle : garder en mémoire quel onglet Anime-Sama est lié à quel onglet Sibnet,
// relayer les actions (ouverture, passage épisode suivant, navigation) entre eux,
// et calculer les temps de skip opening/ending via AniList + AniSkip.

console.log("[AS SKIPPER] background.js loaded");

const PAIRS_KEY = "ast_pairs";
const CONTEXT_KEY = "ast_context"; // { [tabId]: { title, episode } }

// Cache mémoire (non persisté) pour éviter de refaire les mêmes appels AniList/AniSkip.
const skipTimesCache = new Map();

async function getPairs() {
  console.log("[AS SKIPPER] reading pairs from storage");
  const data = await chrome.storage.session.get(PAIRS_KEY);
  return data[PAIRS_KEY] || {};
}
async function setPairs(pairs) {
  console.log("[AS SKIPPER] saving pairs", pairs);
  await chrome.storage.session.set({ [PAIRS_KEY]: pairs });
}

async function getContexts() {
  console.log("[AS SKIPPER] reading contexts from storage");
  const data = await chrome.storage.session.get(CONTEXT_KEY);
  return data[CONTEXT_KEY] || {};
}
async function setContexts(contexts) {
  console.log("[AS SKIPPER] saving contexts", contexts);
  await chrome.storage.session.set({ [CONTEXT_KEY]: contexts });
}

async function pairTabs(tabIdA, tabIdB) {
  console.log("[AS SKIPPER] pairing tabs", tabIdA, tabIdB);
  const pairs = await getPairs();
  pairs[tabIdA] = tabIdB;
  pairs[tabIdB] = tabIdA;
  await setPairs(pairs);
}

async function unpairTab(tabId) {
  console.log("[AS SKIPPER] unpairing tab", tabId);
  const pairs = await getPairs();
  const partner = pairs[tabId];
  if (partner !== undefined) delete pairs[partner];
  delete pairs[tabId];
  await setPairs(pairs);

  const contexts = await getContexts();
  delete contexts[tabId];
  await setContexts(contexts);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log("[AS SKIPPER] tab removed", tabId);
  unpairTab(tabId);
});

async function getSkipTimes(title, episode) {
  const key = `${title}::${episode}`;
  if (skipTimesCache.has(key)) {
    console.log("[AS SKIPPER] using cached skip times", key);
    return skipTimesCache.get(key);
  }

  console.log("[AS SKIPPER] fetching skip times", { title, episode });
  const result = await fetchSkipTimes(title, episode);
  skipTimesCache.set(key, result);
  return result;
}

async function fetchSkipTimes(title, episode) {
  try {
    console.log("[AS SKIPPER] requesting AniList metadata", title);
    const anilistRes = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query ($search: String) {
            Media(search: $search, type: ANIME) {
              idMal
            }
          }
        `,
        variables: { search: title },
      }),
    });
    const anilistData = await anilistRes.json();
    const malId = anilistData.data?.Media?.idMal;
    if (!malId) {
      console.log("[AS SKIPPER] no AniList MAL id found for", title);
      return { endingStartTime: null, openingStartTime: null, openingEndTime: null };
    }

    console.log("[AS SKIPPER] requesting AniSkip times", { malId, episode });
    const skipRes = await fetch(
      `https://api.aniskip.com/v1/skip-times/${malId}/${episode}?types=op&types=ed`
    );
    const skipData = await skipRes.json();

    let endingStartTime = null;
    let openingStartTime = null;
    let openingEndTime = null;

    for (const result of skipData.results || []) {
      if (result.skip_type === "ed") {
        endingStartTime = result.interval.start_time;
      }
      if (result.skip_type === "op") {
        openingStartTime = result.interval.start_time;
        openingEndTime = result.interval.end_time;
      }
    }

    console.log("[AS SKIPPER] got skip times", { endingStartTime, openingStartTime, openingEndTime });
    return { endingStartTime, openingStartTime, openingEndTime };
  } catch (e) {
    console.log("[AS SKIPPER] AniList/AniSkip error", e);
    return { endingStartTime: null, openingStartTime: null, openingEndTime: null };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[AS SKIPPER] received message", message, sender.tab && sender.tab.id);
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // réponse asynchrone
});

async function handleMessage(message, sender) {
  const senderTabId = sender.tab && sender.tab.id;
  console.log("[AS SKIPPER] handling message", message.type, "from tab", senderTabId);

  switch (message.type) {
    // Envoyé par content-anime-sama.js quand on clique sur "Regarder sur Sibnet"
    case "OPEN_SIBNET": {
      console.log("[AS SKIPPER] OPEN_SIBNET request", message.url, "for tab", senderTabId);
      if (senderTabId === undefined) return { ok: false, error: "no-sender-tab" };
      const newTab = await chrome.tabs.create({ url: message.url });

      await pairTabs(senderTabId, newTab.id);

      const contexts = await getContexts();
      contexts[newTab.id] = { title: message.title || null, episode: message.episode || null };
      await setContexts(contexts);

      console.log("[AS SKIPPER] opened Sibnet tab", newTab.id);
      return { ok: true, tabId: newTab.id };
    }

    // Envoyé par content-sibnet.js quand on clique sur "Épisode suivant"
    case "REQUEST_NEXT_EP": {
      console.log("[AS SKIPPER] REQUEST_NEXT_EP from tab", senderTabId);
      const pairs = await getPairs();
      const animeSamaTabId = pairs[senderTabId];
      if (animeSamaTabId === undefined) {
        console.log("[AS SKIPPER] no paired Anime-Sama tab for Sibnet tab", senderTabId);
        return { ok: false, error: "no-pair" };
      }
      try {
        // Exécute nextEp() directement dans le contexte de la page Anime-Sama.
        // world: "MAIN" permet d'appeler une fonction définie par le site
        // (nextEp n'existe pas dans le monde isolé du content script).
        await chrome.scripting.executeScript({
          target: { tabId: animeSamaTabId },
          world: "MAIN",
          func: () => {
            if (typeof nextEp === "function") {
              console.log("[AS SKIPPER] triggering nextEp() in Anime-Sama page");
              nextEp();
            } else {
              console.log("[AS SKIPPER] nextEp() not available on Anime-Sama page");
            }
          },
        });
        console.log("[AS SKIPPER] nextEp() executed");
        return { ok: true };
      } catch (e) {
        console.log("[AS SKIPPER] failed to execute nextEp()", e);
        return { ok: false, error: String(e) };
      }
    }

    // Envoyé par content-anime-sama.js dès qu'il détecte un nouveau lien Sibnet
    // dans l'iframe #playerDF (que ce soit suite à nextEp() ou à une navigation manuelle)
    case "NEW_EP_URL": {
      console.log("[AS SKIPPER] NEW_EP_URL", message.url, "from tab", senderTabId);
      const pairs = await getPairs();
      const sibnetTabId = pairs[senderTabId];
      if (sibnetTabId === undefined) {
        // Pas d'onglet Sibnet ouvert/lié pour cet onglet Anime-Sama : rien à faire.
        console.log("[AS SKIPPER] no paired Sibnet tab for Anime-Sama tab", senderTabId);
        return { ok: true, forwarded: false };
      }

      const contexts = await getContexts();
      contexts[sibnetTabId] = { title: message.title || null, episode: message.episode || null };
      await setContexts(contexts);

      try {
        console.log("[AS SKIPPER] forwarding navigation to Sibnet tab", sibnetTabId);
        await chrome.tabs.sendMessage(sibnetTabId, { type: "NAVIGATE", url: message.url });
        return { ok: true, forwarded: true };
      } catch (e) {
        console.log("[AS SKIPPER] failed to forward navigation", e);
        return { ok: false, error: String(e) };
      }
    }

    // Envoyé par content-sibnet.js au chargement (et après chaque NAVIGATE) pour
    // récupérer les temps de skip opening/ending correspondant à l'épisode courant.
    case "GET_SKIP_TIMES": {
      console.log("[AS SKIPPER] GET_SKIP_TIMES for tab", senderTabId);
      if (senderTabId === undefined) {
        return { ok: true, openingStartTime: null, openingEndTime: null, endingStartTime: null };
      }
      const contexts = await getContexts();
      const ctx = contexts[senderTabId];
      if (!ctx || !ctx.title || !ctx.episode) {
        return { ok: true, openingStartTime: null, openingEndTime: null, endingStartTime: null };
      }
      const times = await getSkipTimes(ctx.title, ctx.episode);
      return { ok: true, ...times };
    }

    default:
      console.log("[AS SKIPPER] unknown message type", message.type);
      return { ok: false, error: "unknown-message-type" };
  }
}
