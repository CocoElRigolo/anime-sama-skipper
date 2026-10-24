// content-anime-sama.js
(function () {
  console.log("[AS SKIPPER] content-anime-sama.js loaded");

  const PLAYER_ID = "playerDF";
  const EPISODE_SELECT_ID = "selectEpisodes";
  const BUTTON_ID = "ast-open-player-btn";
  const STYLE_ID = "ast-anime-sama-styles";
  const PLAYER_KEY = "ast_player";

  let lastSentKey = null;
  let selectedPlayer = "sibnet";

  function isValidPage() {
    const path = location.pathname.replace(/\/+$/, "");
    const valid = /^\/catalogue\/[^/]+\/[^/]+\/[^/]+$/.test(path);
    console.log("[AS SKIPPER] checking Anime-Sama page", path, valid);
    return valid;
  }

  function isSelectedPlayerUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      const isSibnet = hostname === "video.sibnet.ru";
      const isVidmoly =
        hostname === "ansembed.net" ||
        hostname.endsWith(".ansembed.net") ||
        hostname === "vidmoly.me" ||
        hostname.endsWith(".vidmoly.me");
      const matches = selectedPlayer === "sibnet" ? isSibnet : isVidmoly;
      console.log("[AS SKIPPER] checking selected player URL", { url, selectedPlayer, matches });
      return matches;
    } catch (error) {
      console.log("[AS SKIPPER] invalid player URL", url, error);
      return false;
    }
  }

  // Ex: /catalogue/one-piece/saison1/vf -> "one piece"
  function getAnimeTitle() {
    const parts = location.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("catalogue");
    if (idx === -1 || !parts[idx + 1]) return null;
    const title = decodeURIComponent(parts[idx + 1]).replace(/-/g, " ");
    console.log("[AS SKIPPER] detected anime title", title);
    return title;
  }

  function getEpisodeNumber() {
    const select = document.getElementById(EPISODE_SELECT_ID);
    if (!select) return null;
    const selected = select.options[select.selectedIndex];
    if (!selected) return null;
    const match = selected.textContent.match(/\d+/);
    const episode = match ? parseInt(match[0], 10) : null;
    console.log("[AS SKIPPER] detected episode number", episode);
    return episode;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      console.log("[AS SKIPPER] Anime-Sama styles already injected");
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(13, 17, 28, 0.92);
        color: #f5f5f5;
        border: 1px solid #0369a1;
        border-radius: 10px;
        padding: 9px 14px 9px 16px;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
        transition: background 0.15s ease, transform 0.15s ease;
        font-family: inherit;
        margin: 10px 0;
      }
      #${BUTTON_ID}:hover {
        background: #0090dd;
        transform: translateY(-1px);
      }
    `;
    document.head.appendChild(style);
    console.log("[AS SKIPPER] injected Anime-Sama styles");
  }

  function createButton() {
    console.log("[AS SKIPPER] creating open-player button");
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.textContent = "Watch with Skipper";
    btn.addEventListener("click", () => {
      const url = btn.dataset.url;
      console.log("[AS SKIPPER] button clicked", url);
      if (!url) return;
      chrome.runtime.sendMessage({
        type: "OPEN_PLAYER",
        player: selectedPlayer,
        url,
        title: btn.dataset.title || null,
        episode: btn.dataset.episode ? parseInt(btn.dataset.episode, 10) : null,
      });
    });
    return btn;
  }

  function ensureButton(iframe, title, episode) {
    injectStyles();
    let btn = document.getElementById(BUTTON_ID);
    if (!btn) {
      console.log("[AS SKIPPER] button missing, creating it");
      btn = createButton();
      iframe.insertAdjacentElement("beforebegin", btn);
    }
    btn.dataset.url = iframe.src;
    btn.dataset.title = title || "";
    btn.dataset.episode = episode || "";
    console.log("[AS SKIPPER] synced button data", { url: iframe.src, title, episode });
  }

  function removeButton() {
    const btn = document.getElementById(BUTTON_ID);
    if (btn) {
      console.log("[AS SKIPPER] removing button");
      btn.remove();
    }
  }

  function syncIframe() {
    console.log("[AS SKIPPER] syncing iframe state");
    if (!isValidPage()) {
      console.log("[AS SKIPPER] invalid page, removing button");
      removeButton();
      lastSentKey = null;
      return;
    }

    const iframe = document.getElementById(PLAYER_ID);
    if (!iframe || !isSelectedPlayerUrl(iframe.src)) {
      console.log("[AS SKIPPER] no iframe found for selected player");
      removeButton();
      lastSentKey = null;
      return;
    }

    const title = getAnimeTitle();
    const episode = getEpisodeNumber();

    ensureButton(iframe, title, episode);

    // On ne prévient le background que si quelque chose a réellement changé,
    // pour éviter de spammer des messages à chaque mutation du DOM.
    const key = `${iframe.src}::${title}::${episode}`;
    if (key !== lastSentKey) {
      console.log("[AS SKIPPER] sending NEW_EP_URL", { url: iframe.src, title, episode });
      lastSentKey = key;
      chrome.runtime.sendMessage({
        type: "NEW_EP_URL",
        player: selectedPlayer,
        url: iframe.src,
        title,
        episode,
      });
    }
  }

  // Check DOM changes (changes on iframe or its src on nextEp() call) 
  const observer = new MutationObserver(syncIframe);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  console.log("[AS SKIPPER] mutation observer attached");

  document.addEventListener("change", (event) => {
    if (event.target && event.target.id === EPISODE_SELECT_ID) {
      console.log("[AS SKIPPER] episode selector changed");
      syncIframe();
    }
  });

  function patchHistoryForNavigation() {
    const fire = () => {
      console.log("[AS SKIPPER] location change detected");
      window.dispatchEvent(new Event("ast:locationchange"));
    };
    const _pushState = history.pushState;
    const _replaceState = history.replaceState;
    history.pushState = function (...args) {
      console.log("[AS SKIPPER] history.pushState intercepted");
      _pushState.apply(this, args);
      fire();
    };
    history.replaceState = function (...args) {
      console.log("[AS SKIPPER] history.replaceState intercepted");
      _replaceState.apply(this, args);
      fire();
    };
    window.addEventListener("popstate", fire);
    window.addEventListener("ast:locationchange", syncIframe);
    console.log("[AS SKIPPER] history navigation patch installed");
  }

  patchHistoryForNavigation();
  chrome.storage.local.get({ [PLAYER_KEY]: "sibnet" }, (data) => {
    selectedPlayer = data[PLAYER_KEY] === "vidmoly" ? "vidmoly" : "sibnet";
    syncIframe();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PLAYER_KEY]) {
      selectedPlayer = changes[PLAYER_KEY].newValue === "vidmoly" ? "vidmoly" : "sibnet";
      lastSentKey = null;
      syncIframe();
    }
  });
  syncIframe();
})();
