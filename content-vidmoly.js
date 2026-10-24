// content-vidmoly.js
(function () {
  console.log("[AS SKIPPER] content-vidmoly.js loaded");

  const BUTTON_ID = "ast-next-ep-btn";
  const STYLE_ID = "ast-vidmoly-styles";
  const SKIP_OPENING_KEY = "ast_skip_opening";
  const AUTO_ADVANCE_MS = 5000;

  let requestInFlight = false;
  let skipOpeningEnabled = true;
  let skipTimes = { openingStartTime: null, openingEndTime: null, endingStartTime: null };
  let autoAdvanceRaf = null;
  let autoAdvanceMouseHandler = null;
  let tickInFlight = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
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
  }

  function showButton() {
    if (document.getElementById(BUTTON_ID)) return;
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
    startAutoAdvance(btn);
  }

  function removeButton() {
    stopAutoAdvance();
    const btn = document.getElementById(BUTTON_ID);
    if (btn) btn.remove();
  }

  function setLoading(isLoading) {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    btn.dataset.loading = isLoading ? "true" : "false";
    const label = btn.querySelector(".ast-label");
    if (label) label.textContent = isLoading ? "Chargement..." : "Épisode suivant";
  }

  function handleClick(userTriggered) {
    if (requestInFlight) return;
    requestInFlight = true;
    stopAutoAdvance();
    setLoading(true);
    console.log("[AS SKIPPER] requesting next episode", { userTriggered });

    chrome.runtime.sendMessage({ type: "REQUEST_NEXT_EP" }, (response) => {
      if (!response || !response.ok) {
        console.log("[AS SKIPPER] next episode request failed", response);
        requestInFlight = false;
        setLoading(false);
      }
    });
  }

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

  function getEffectiveTimes(duration) {
    return {
      openingStartTime: skipTimes.openingStartTime !== null ? skipTimes.openingStartTime : 0,
      openingEndTime: skipTimes.openingEndTime !== null ? skipTimes.openingEndTime : 90,
      endingStartTime:
        skipTimes.endingStartTime !== null ? skipTimes.endingStartTime : Math.max(0, duration - 90),
    };
  }

  function tick() {
    if (tickInFlight) return;
    tickInFlight = true;
    chrome.runtime.sendMessage({ type: "GET_VIDMOLY_STATE" }, (response) => {
      tickInFlight = false;
      if (!response || !response.ok) {
        if (response?.error !== "player-state-unavailable") {
          console.log("[AS SKIPPER] failed to read Vidmoly player state", response || chrome.runtime.lastError);
        }
        return;
      }

      const { duration, position } = response;
      const { openingStartTime, openingEndTime, endingStartTime } = getEffectiveTimes(duration);

      if (skipOpeningEnabled && position >= openingStartTime && position < openingEndTime) {
        chrome.runtime.sendMessage(
          { type: "SEEK_VIDMOLY", position: openingEndTime },
          (seekResponse) => {
            if (!seekResponse || !seekResponse.ok) {
              console.log("[AS SKIPPER] failed to seek Vidmoly player", seekResponse || chrome.runtime.lastError);
            }
          }
        );
      }

      if (position >= endingStartTime) {
        showButton();
      } else {
        removeButton();
      }
    });
  }

  setInterval(tick, 1000);

  async function waitForElement(selector, timeoutMs = 10000) {
    const existing = document.querySelector(selector);
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
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
      await waitForElement("video");
      const video = document.querySelector("video");
      if (video) {
        await video.play();
        console.log("[AS SKIPPER] Vidmoly video play() succeeded");
      }
    } catch (err) {
      console.log("[AS SKIPPER] Vidmoly video play() failed", err);
    }
  }

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
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SKIP_OPENING_KEY]) {
      skipOpeningEnabled = !!changes[SKIP_OPENING_KEY].newValue;
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
  playVideoWhenReady();
})();
