// content-sibnet.js
(function () {
  console.log("[AS SKIPPER] content-sibnet.js loaded");

  const VIDEO_ID = "video_html5_wrapper_html5_api";
  const BUTTON_ID = "ast-next-ep-btn";
  const STYLE_ID = "ast-sibnet-styles";
  const SKIP_OPENING_KEY = "ast_skip_opening";
  const AUTO_ADVANCE_MS = 5000;

  let requestInFlight = false;
  let skipOpeningEnabled = true;

  // skip times (nullable). Filled with AniList/AniSkip, else fallback
  // applied when calculation (cf. getEffectiveTimes).
  let skipTimes = { openingStartTime: null, openingEndTime: null, endingStartTime: null };

  let autoAdvanceRaf = null;
  let autoAdvanceMouseHandler = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      console.log("[AS SKIPPER] Sibnet styles already injected");
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        top: 10%;
        right: 3%;
        z-index: 2147483647;
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
        font-family: sans-serif;
        overflow: hidden;
      }
      #${BUTTON_ID}:hover {
        background: #0090dd;
        transform: translateY(-1px);
      }
      #${BUTTON_ID}[data-loading="true"] {
        opacity: 0.7;
        cursor: wait;
      }
      #${BUTTON_ID} .ast-progress-bar {
        position: absolute;
        left: 0;
        bottom: 0;
        height: 3px;
        width: 100%;
        background: #0090dd;
        transform-origin: left;
        border-radius: 0 0 10px 10px;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
    console.log("[AS SKIPPER] injected Sibnet styles");
  }

  function showButton() {
    if (document.getElementById(BUTTON_ID)) {
      console.log("[AS SKIPPER] next episode button already visible");
      return;
    }
    injectStyles();
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    const label = document.createElement("span");
    label.className = "ast-label";
    label.textContent = "Next episode";
    btn.appendChild(label);
    btn.addEventListener("click", () => handleClick(true));
    document.body.appendChild(btn);
    console.log("[AS SKIPPER] displayed next episode button");
    startAutoAdvance(btn);
  }

  function removeButton() {
    stopAutoAdvance();
    const btn = document.getElementById(BUTTON_ID);
    if (btn) {
      console.log("[AS SKIPPER] removed next episode button");
      btn.remove();
    }
  }

  function setLoading(isLoading) {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    btn.dataset.loading = isLoading ? "true" : "false";
    const label = btn.querySelector(".ast-label");
    if (label) label.textContent = isLoading ? "Chargement..." : "Épisode suivant";
    console.log("[AS SKIPPER] button loading state", isLoading);
  }

  // userTriggered: true if manual click, false if automatically ignited
  function handleClick(userTriggered) {
    if (requestInFlight) {
      console.log("[AS SKIPPER] next episode request already in flight");
      return;
    }
    requestInFlight = true;
    stopAutoAdvance();
    setLoading(true);
    console.log("[AS SKIPPER] requesting next episode", { userTriggered });

    chrome.runtime.sendMessage({ type: "REQUEST_NEXT_EP" }, (response) => {
      if (!response || !response.ok) {
        // Échec (pas d'onglet Anime-Sama lié, etc.) : on redonne la main à l'utilisateur.
        console.log("[AS SKIPPER] next episode request failed", response);
        requestInFlight = false;
        setLoading(false);
      }
    });
  }

  // Button aniation 
  function startAutoAdvance(btn) {
    const bar = document.createElement("div");
    bar.className = "ast-progress-bar";
    btn.appendChild(bar);

    const start = performance.now();

    function frame(now) {
      const elapsed = now - start;
      const remaining = Math.max(0, 1 - elapsed / AUTO_ADVANCE_MS);
      bar.style.transform = `scaleX(${remaining})`;

      if (elapsed >= AUTO_ADVANCE_MS) {
        autoAdvanceRaf = null;
        console.log("[AS SKIPPER] auto-advancing to next episode");
        handleClick(false);
        return;
      }
      autoAdvanceRaf = requestAnimationFrame(frame);
    }
    autoAdvanceRaf = requestAnimationFrame(frame);

    autoAdvanceMouseHandler = () => stopAutoAdvance();
    document.addEventListener("mousemove", autoAdvanceMouseHandler, { once: true });
  }

  function stopAutoAdvance() {
    if (autoAdvanceRaf) {
      cancelAnimationFrame(autoAdvanceRaf);
      autoAdvanceRaf = null;
    }
    if (autoAdvanceMouseHandler) {
      document.removeEventListener("mousemove", autoAdvanceMouseHandler);
      autoAdvanceMouseHandler = null;
    }
    const bar = document.querySelector(`#${BUTTON_ID} .ast-progress-bar`);
    if (bar) bar.remove();
  }

  function getVideo() {
    return document.getElementById(VIDEO_ID);
  }

  function getEffectiveTimes(duration) {
    return {
      openingStartTime: skipTimes.openingStartTime !== null ? skipTimes.openingStartTime : 0,
      openingEndTime: skipTimes.openingEndTime !== null ? skipTimes.openingEndTime : 90,
      endingStartTime:
        skipTimes.endingStartTime !== null ? skipTimes.endingStartTime : Math.max(0, duration - 90),
    };
  }

  function tick() {
    const video = getVideo();
    if (!video || !video.duration || isNaN(video.duration)) return;

    const { openingStartTime, openingEndTime, endingStartTime } = getEffectiveTimes(video.duration);
    const currentTime = video.currentTime;
    console.log("[AS SKIPPER] video tick", { currentTime, duration: video.duration, openingStartTime, openingEndTime, endingStartTime });

    // Delete any SIBNET 
    const ad = document.getElementById("vjs-overlayclip-container-box");
    if (ad) {
      console.log("[AS SKIPPER] SIBNET ad detected. Attempt to remove it.");
      ad.remove();
    }

    // opening auto-skip 
    if (
      skipOpeningEnabled &&
      currentTime >= openingStartTime &&
      currentTime < openingEndTime
    ) {
      console.log("[AS SKIPPER] skipping opening");
      video.currentTime = openingEndTime;
    }

    // "Next episode" button on ending start
    if (currentTime >= endingStartTime) {
      showButton();
    } else {
      removeButton();
    }
  }

  setInterval(tick, 1000);
  console.log("[AS SKIPPER] tick interval started");

  async function waitForElement(selector, timeoutMs = 10000) {
    const existing = document.querySelector(selector);
    if (existing) {
      return existing;
    }

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      if (timeoutMs > 0) {
        setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Timed out waiting for selector: ${selector}`));
        }, timeoutMs);
      }
    });
  }

  async function playVideoWhenReady() {
    try {
      await waitForElement(".vjs-big-play-button");
      const video = getVideo();
      if (video) {
        await video.play();
        console.log("[AS SKIPPER] video play() succeeded");
      }
    } catch (err) {
      console.log("[AS SKIPPER] video play() failed", err);
    }
  }

  playVideoWhenReady();

  function requestSkipTimes() {
    chrome.runtime.sendMessage({ type: "GET_SKIP_TIMES" }, (response) => {
      if (response && response.ok) {
        skipTimes = {
          openingStartTime: response.openingStartTime ?? null,
          openingEndTime: response.openingEndTime ?? null,
          endingStartTime: response.endingStartTime ?? null,
        };
        console.log("[AS SKIPPER] received skip times", skipTimes);
      }
    });
  }

  function loadSkipOpeningPreference() {
    chrome.storage.local.get({ [SKIP_OPENING_KEY]: true }, (data) => {
      skipOpeningEnabled = !!data[SKIP_OPENING_KEY];
      console.log("[AS SKIPPER] skip opening preference loaded", skipOpeningEnabled);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SKIP_OPENING_KEY]) {
      skipOpeningEnabled = !!changes[SKIP_OPENING_KEY].newValue;
      console.log("[AS SKIPPER] skip opening preference changed", skipOpeningEnabled);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "NAVIGATE" && message.url) {
      console.log("[AS SKIPPER] navigating to", message.url);
      document.location.replace(message.url);
    }
  });

  loadSkipOpeningPreference();
  requestSkipTimes();
})();
