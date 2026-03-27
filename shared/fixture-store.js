const EVENT_JOURNAL_KEY = "tracking-fixture-events";
const STATE_KEY = "tracking-fixture-state";
const DEFAULT_MODE = "rehydrate";

function parseStoredJson(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

function loadEventJournal() {
  return parseStoredJson(EVENT_JOURNAL_KEY, []);
}

function saveEventJournal(events) {
  saveJson(EVENT_JOURNAL_KEY, events);
}

function loadState() {
  return parseStoredJson(STATE_KEY, {});
}

function saveState(nextState) {
  const state = { ...loadState(), ...nextState };
  saveJson(STATE_KEY, state);
  return state;
}

function readDataLayerMode(explicitMode) {
  if (explicitMode) return explicitMode;
  const bodyMode = document.body?.dataset?.dataLayerMode;
  return bodyMode || DEFAULT_MODE;
}

function resetFlow() {
  sessionStorage.removeItem(EVENT_JOURNAL_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

function createPageDataLayer(mode) {
  if (mode === "ephemeral") {
    window.dataLayer = [];
    return window.dataLayer;
  }

  const events = loadEventJournal();
  window.dataLayer = Array.isArray(events) ? [...events] : [];
  return window.dataLayer;
}

function syncDataLayer(mode) {
  return createPageDataLayer(readDataLayerMode(mode));
}

function render(selector) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.textContent = JSON.stringify(window.dataLayer ?? [], null, 2);
}

function setStatus(selector, text, tone) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.textContent = text;
  element.setAttribute("data-tone", tone || "info");
}

function pushEvent(event, renderSelector) {
  const liveEvents = Array.isArray(window.dataLayer) ? window.dataLayer : [];
  liveEvents.push(event);
  window.dataLayer = liveEvents;

  const journal = loadEventJournal();
  journal.push(event);
  saveEventJournal(journal);

  render(renderSelector);
}

function mountAfterDelay(selector, markup, delayMs) {
  const element = document.querySelector(selector);
  if (!element) return;
  setTimeout(() => {
    element.innerHTML = markup;
  }, delayMs);
}

function bootPage(options = {}) {
  const {
    viewSelector,
    reset = false,
    mode,
  } = options;

  if (reset) {
    resetFlow();
  }

  syncDataLayer(mode);

  if (viewSelector) {
    render(viewSelector);
  }
}

window.fixtureStore = {
  loadEventJournal,
  saveEventJournal,
  loadState,
  saveState,
  resetFlow,
  syncDataLayer,
  render,
  setStatus,
  pushEvent,
  mountAfterDelay,
  bootPage,
  readDataLayerMode,
};
