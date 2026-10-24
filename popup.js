// popup.js
const SKIP_OPENING_KEY = "ast_skip_opening";
const PLAYER_KEY = "ast_player";

const btn = document.getElementById("ast-toggle-skip");
const stateEl = document.getElementById("ast-toggle-state");
const playerSelect = document.getElementById("ast-player-select");

function render(enabled) {
  stateEl.textContent = enabled ? "Activé" : "Désactivé";
  btn.classList.toggle("ast-toggle-off", !enabled);
}

chrome.storage.local.get({ [SKIP_OPENING_KEY]: true }, (data) => {
  render(!!data[SKIP_OPENING_KEY]);
});

chrome.storage.local.get({ [PLAYER_KEY]: "sibnet" }, (data) => {
  playerSelect.value = data[PLAYER_KEY] === "vidmoly" ? "vidmoly" : "sibnet";
});

playerSelect.addEventListener("change", () => {
  chrome.storage.local.set({ [PLAYER_KEY]: playerSelect.value });
});

btn.addEventListener("click", () => {
  chrome.storage.local.get({ [SKIP_OPENING_KEY]: true }, (data) => {
    const newValue = !data[SKIP_OPENING_KEY];
    chrome.storage.local.set({ [SKIP_OPENING_KEY]: newValue }, () => render(newValue));
  });
});
