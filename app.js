'use strict';

const API_BASE = 'https://api.aimlapi.com/v1';
const GENERATE_URL = `${API_BASE}/images/generations`;
// GPT takes reference images only here, as multipart form data
const EDIT_URL = `${API_BASE}/images/edits`;

// Long renders (4K, high quality) can take minutes. Past this the request is dropped.
const REQUEST_TIMEOUT_MS = 6 * 60 * 1000;
// When the model's provider fails (502/503), try again after these pauses before giving up.
// Other errors are never retried.
const RETRY_DELAYS_MS = [3000, 8000];
// How long a removed image can still be brought back
const UNDO_SECONDS = 8;
const MB = 1024 * 1024;

const STORAGE_PREFIX = 'image-studio';
const STORAGE_KEY = `${STORAGE_PREFIX}:key`;
const STORAGE_THEME = `${STORAGE_PREFIX}:theme`;
const STORAGE_PREFS = `${STORAGE_PREFIX}:prefs`;
const STORAGE_HISTORY = `${STORAGE_PREFIX}:history`;
// The bigjpg Worker's address and password, kept apart from the API key
const STORAGE_UPSCALER = `${STORAGE_PREFIX}:upscaler`;
const HISTORY_LIMIT = 20;

// Finished images are kept in IndexedDB so they survive a reload. Each record holds the
// PNG blob and the settings that made it, never the key and never reference images.
const DB_NAME = STORAGE_PREFIX;
const DB_STORE = 'results';

const BASIC_REF_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const MODELS = [
  {
    id: 'google/gemini-3.1-flash-image',
    name: 'Nano Banana 2',
    note: 'Google Gemini 3.1 Flash Image. Up to 14 reference images, resolution up to 4K.',
    family: 'gemini',
    aspectRatios: ['auto', '1:1', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9', '21:9'],
    // AI/ML API's schema lists only 1K, 2K and 4K. 512 is Google's own smallest size and is
    // offered in case AI/ML API passes it through; if not, the card shows their validation error.
    resolutions: ['512', '1K', '2K', '4K'],
    defaultResolution: '1K',
    // One of the two request shapes AI/ML API accepts caps references at 5, the other has no
    // cap, so this follows Google's own limit
    maxRefs: 14,
    maxRefMB: 7,
    refTypes: BASIC_REF_TYPES,
  },
  {
    id: 'openai/gpt-image-2.5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    note: 'OpenAI, tuned for precise edits.',
    family: 'gpt',
    maxRefs: 16,
    maxRefMB: 20,
    refTypes: BASIC_REF_TYPES,
  },
  {
    id: 'openai/gpt-image-2.5-flare',
    name: 'GPT Image 2.5 Flare',
    note: 'OpenAI, tuned for speed.',
    family: 'gpt',
    maxRefs: 16,
    maxRefMB: 20,
    refTypes: BASIC_REF_TYPES,
  },
];

// The only sizes AI/ML API takes for GPT Image 2.5
const GPT_SIZES = [
  ['auto', 'auto'],
  ['1024x1024', '1024 × 1024 square'],
  ['1536x1024', '1536 × 1024 landscape'],
  ['1024x1536', '1024 × 1536 portrait'],
];

const GPT_BACKGROUNDS = ['auto', 'opaque', 'transparent'];
const GPT_QUALITIES = [['low', 'low'], ['medium', 'medium'], ['high', 'high']];
// Only the no-reference endpoint has a moderation setting
const GPT_MODERATIONS = [['auto', 'auto'], ['low', 'low (less filtering)']];
// Where AI/ML API sends a Nano Banana 2 request; auto falls back from Google to fal.ai
const GEMINI_PROVIDERS = [['auto', 'auto (Google, then fal.ai)'], ['google', 'Google only'], ['fal', 'fal.ai only']];
const COUNTS = [1, 2, 3, 4];

// bigjpg's enlarge settings: the value is what its API takes, the text is what the page shows
const UPSCALE_STYLES = [['art', 'artwork'], ['photo', 'photo']];
const UPSCALE_SCALES = [['1', '2x'], ['2', '4x'], ['3', '8x'], ['4', '16x']];
const UPSCALE_NOISE = [['-1', 'no noise reduction'], ['0', 'low noise reduction'], ['1', 'medium noise reduction'], ['2', 'high noise reduction'], ['3', 'highest noise reduction']];
// bigjpg took about 80 seconds for a 2x enlarge; checking every 10 seconds costs no API calls
const UPSCALE_POLL_MS = 10 * 1000;
const UPSCALE_TIMEOUT_MS = 30 * 60 * 1000;
// bigjpg doesn't document a per-minute limit, so a batch runs a couple at a time and the rest wait
const UPSCALE_AT_ONCE = 2;
// A 4x or bigger enlarge means many progress checks, and on a phone one of them can drop.
// Only this many failed checks in a row (about a minute) count as the upscale failing.
const UPSCALE_POLL_MISSES = 6;
const UPSCALE_DOWNLOAD_TRIES = 3;

const $ = (selector) => document.querySelector(selector);

const els = {
  keyToggle: $('#key-toggle'),
  keyBadge: $('#key-badge'),
  keyPanel: $('#key-panel'),
  keyForm: $('#key-form'),
  keyInput: $('#key-input'),
  keyReveal: $('#key-reveal'),
  keyRemember: $('#key-remember'),
  keyStatus: $('#key-status'),
  keyForget: $('#key-forget'),
  upscalerForm: $('#upscaler-form'),
  upscalerUrl: $('#upscaler-url'),
  upscalerPassword: $('#upscaler-password'),
  upscalerRemember: $('#upscaler-remember'),
  upscalerStatus: $('#upscaler-status'),
  upscalerForget: $('#upscaler-forget'),
  themeToggle: $('#theme-toggle'),
  form: $('#gen-form'),
  modelList: $('#model-list'),
  prompt: $('#prompt'),
  historyToggle: $('#history-toggle'),
  historyPanel: $('#history-panel'),
  historyList: $('#history-list'),
  historyClear: $('#history-clear'),
  refsNote: $('#refs-note'),
  savedLine: $('#saved-line'),
  aspectGrid: $('#aspect-grid'),
  resGroup: $('#res-group'),
  size: $('#size'),
  background: $('#background'),
  quality: $('#quality'),
  moderation: $('#moderation'),
  moderationNote: $('#moderation-note'),
  provider: $('#provider'),
  webSearch: $('#web-search'),
  dropzone: $('#dropzone'),
  refInput: $('#ref-input'),
  refList: $('#ref-list'),
  refsCount: $('#refs-count'),
  refsHint: $('#refs-hint'),
  refsError: $('#refs-error'),
  countGroup: $('#count-group'),
  formError: $('#form-error'),
  generate: $('#generate'),
  gallery: $('#gallery'),
  empty: $('#empty'),
  clearGallery: $('#clear-gallery'),
  upscaleOwn: $('#upscale-own'),
  upscaleFile: $('#upscale-file'),
  upscaleSeveral: $('#upscale-several'),
  batchBar: $('#batch-bar'),
  batchCount: $('#batch-count'),
  batchStyle: $('#batch-style'),
  batchScale: $('#batch-scale'),
  batchNoise: $('#batch-noise'),
  batchAll: $('#batch-all'),
  batchDone: $('#batch-done'),
  batchStart: $('#batch-start'),
  viewer: $('#viewer'),
  viewerImg: $('#viewer-img'),
  viewerClose: $('#viewer-close'),
  cardTemplate: $('#card-template'),
};

const state = {
  apiKey: '',
  modelId: MODELS[0].id,
  aspect: '1:1',
  resolution: MODELS[0].defaultResolution,
  size: 'auto',
  background: 'auto',
  quality: 'medium',
  moderation: 'auto',
  provider: 'auto',
  webSearch: false,
  count: 1,
  // the last enlarge settings picked on a card; the defaults match bigjpg's own form
  upscale: { style: 'art', x2: '2', noise: '3' },
  upscaler: null,
  refs: [],
};

let nextId = 1;
const cards = new Map();
const upscaleQueue = { running: 0, waiting: [] };

// saved.available: null until IndexedDB has been tried, then true or false.
// saved.bytes maps each saved record id to its image size, for the "saved on this device" line.
const saved = { available: null, bytes: new Map(), full: false };

/* ---------- storage (any of these can throw in private mode or when blocked) ---------- */

function storageGet(area, key) {
  try {
    return window[area].getItem(key);
  } catch (_) {
    return null;
  }
}

function storageSet(area, key, value) {
  try {
    window[area].setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

function storageRemove(area, key) {
  try {
    window[area].removeItem(key);
  } catch (_) {
    /* nothing stored, nothing to remove */
  }
}

/* ---------- theme ---------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const next = theme === 'dark' ? 'light' : 'dark';
  els.themeToggle.setAttribute('aria-label', `Switch to ${next} mode`);
}

function initTheme() {
  const saved = storageGet('localStorage', STORAGE_THEME);
  applyTheme(saved === 'light' ? 'light' : 'dark');
  els.themeToggle.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    storageSet('localStorage', STORAGE_THEME, theme);
  });
}

/* ---------- api key ---------- */

function maskKey(key) {
  return key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '••••';
}

// Anything the API echoes back gets the key scrubbed before it reaches the page.
function redact(text) {
  if (!text || !state.apiKey) return text || '';
  return String(text).split(state.apiKey).join('[your key]');
}

function setKeyStatus(message, isError) {
  els.keyStatus.textContent = message;
  els.keyStatus.classList.toggle('is-error', Boolean(isError));
}

function renderKeyBadge() {
  const hasKey = Boolean(state.apiKey);
  if (hasKey && state.apiKey.length > 12) {
    // the prefix is its own element so narrow screens can drop it and keep the last 4
    const prefix = document.createElement('span');
    prefix.className = 'key-prefix';
    prefix.textContent = state.apiKey.slice(0, 7);
    els.keyBadge.replaceChildren(prefix, `…${state.apiKey.slice(-4)}`);
  } else {
    els.keyBadge.textContent = hasKey ? maskKey(state.apiKey) : 'no key';
  }
  els.keyBadge.classList.toggle('is-missing', !hasKey);
  els.keyToggle.setAttribute('aria-label', hasKey ? 'API key settings' : 'Add your API key');
}

function setKeyPanelOpen(open) {
  els.keyPanel.hidden = !open;
  els.keyToggle.setAttribute('aria-expanded', String(open));
  if (open) els.keyInput.focus();
}

function initKey() {
  const remembered = storageGet('localStorage', STORAGE_KEY);
  state.apiKey = storageGet('sessionStorage', STORAGE_KEY) || remembered || '';
  els.keyRemember.checked = Boolean(remembered);
  renderKeyBadge();
  if (state.apiKey) {
    setKeyStatus(`Using ${maskKey(state.apiKey)}.`);
  } else {
    setKeyPanelOpen(true);
  }

  els.keyToggle.addEventListener('click', () => setKeyPanelOpen(els.keyPanel.hidden));

  els.keyReveal.addEventListener('click', () => {
    const show = els.keyInput.type === 'password';
    els.keyInput.type = show ? 'text' : 'password';
    els.keyReveal.textContent = show ? 'hide' : 'show';
    els.keyReveal.setAttribute('aria-pressed', String(show));
  });

  els.keyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = els.keyInput.value.trim();
    if (!key) {
      setKeyStatus('Paste your key first.', true);
      return;
    }
    if (/\s/.test(key)) {
      setKeyStatus('That key has spaces in it. Copy it again from the Keys page of your AI/ML API dashboard.', true);
      return;
    }
    storageRemove('localStorage', STORAGE_KEY);
    storageRemove('sessionStorage', STORAGE_KEY);
    const remember = els.keyRemember.checked;
    const stored = storageSet(remember ? 'localStorage' : 'sessionStorage', STORAGE_KEY, key);
    state.apiKey = key;
    els.keyInput.value = '';
    els.keyInput.type = 'password';
    els.keyReveal.textContent = 'show';
    els.keyReveal.setAttribute('aria-pressed', 'false');
    renderKeyBadge();

    let message = remember ? 'Saved on this device.' : 'Saved for this tab only.';
    if (!stored) message = 'This browser blocked storage, so the key only lasts until you reload.';
    setKeyStatus(message, false);
    clearFormError();
  });

  els.keyForget.addEventListener('click', () => {
    if (!window.confirm("Forget your API key on this browser? You'll need to paste it again to generate.")) return;
    storageRemove('localStorage', STORAGE_KEY);
    storageRemove('sessionStorage', STORAGE_KEY);
    state.apiKey = '';
    els.keyInput.value = '';
    els.keyRemember.checked = false;
    renderKeyBadge();
    setKeyStatus('Key removed from this browser.');
  });
}

/* ---------- bigjpg upscaler settings ---------- */

function setUpscalerStatus(message, isError) {
  els.upscalerStatus.textContent = message;
  els.upscalerStatus.classList.toggle('is-error', Boolean(isError));
}

function renderUpscaler() {
  document.body.classList.toggle('has-upscaler', Boolean(state.upscaler));
}

function readUpscaler() {
  const remembered = storageGet('localStorage', STORAGE_UPSCALER);
  const raw = storageGet('sessionStorage', STORAGE_UPSCALER) || remembered;
  let saved;
  try {
    saved = JSON.parse(raw || 'null');
  } catch (_) {
    return { upscaler: null, remembered: false };
  }
  const valid = saved && typeof saved.url === 'string' && /^https:\/\//.test(saved.url) && typeof saved.password === 'string' && saved.password;
  return { upscaler: valid ? { url: saved.url, password: saved.password } : null, remembered: Boolean(remembered) };
}

// A result query for a made-up task: the Worker checks the password and bigjpg answers {},
// so this proves the setup works without using any of bigjpg's API calls.
async function checkUpscaler(upscaler) {
  let response;
  try {
    response = await fetch(`${upscaler.url}/task/check`, {
      headers: { 'X-Proxy-Password': upscaler.password },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch (_) {
    return "Couldn't reach the Worker. Check the address, and that the Worker allows this page's address.";
  }
  if (response.status === 401) return 'The Worker says that password is wrong.';
  if (!response.ok) {
    const data = safeJson(await response.text());
    return `The Worker answered ${response.status}${data && data.error ? `: ${data.error}` : ''}.`;
  }
  return '';
}

function initUpscaler() {
  const { upscaler, remembered } = readUpscaler();
  state.upscaler = upscaler;
  els.upscalerRemember.checked = remembered;
  if (upscaler) {
    els.upscalerUrl.value = upscaler.url;
    setUpscalerStatus('Upscaler is set up.');
  }
  renderUpscaler();

  els.upscalerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = els.upscalerUrl.value.trim().replace(/\/+$/, '');
    const password = els.upscalerPassword.value;
    if (!/^https:\/\/[^\s/]+$/.test(url)) {
      setUpscalerStatus('Paste the Worker address, starting with https:// and with nothing after the domain.', true);
      return;
    }
    if (!password) {
      setUpscalerStatus('Type the Worker password.', true);
      return;
    }
    setUpscalerStatus('Checking with the Worker...');
    const problem = await checkUpscaler({ url, password });
    if (problem) {
      setUpscalerStatus(problem, true);
      return;
    }
    storageRemove('localStorage', STORAGE_UPSCALER);
    storageRemove('sessionStorage', STORAGE_UPSCALER);
    const remember = els.upscalerRemember.checked;
    const stored = storageSet(remember ? 'localStorage' : 'sessionStorage', STORAGE_UPSCALER, JSON.stringify({ url, password }));
    state.upscaler = { url, password };
    els.upscalerUrl.value = url;
    els.upscalerPassword.value = '';
    renderUpscaler();
    let message = remember ? 'Connected and saved on this device.' : 'Connected and saved for this tab only.';
    if (!stored) message = 'Connected, but this browser blocked storage, so it only lasts until you reload.';
    setUpscalerStatus(message);
  });

  els.upscalerForget.addEventListener('click', () => {
    if (!window.confirm('Forget the upscaler address and password on this browser?')) return;
    storageRemove('localStorage', STORAGE_UPSCALER);
    storageRemove('sessionStorage', STORAGE_UPSCALER);
    state.upscaler = null;
    els.upscalerUrl.value = '';
    els.upscalerPassword.value = '';
    els.upscalerRemember.checked = false;
    renderUpscaler();
    setSelecting(false);
    setUpscalerStatus('Upscaler removed from this browser.');
  });
}

/* ---------- preferences (non-sensitive, per device) ---------- */

function savePrefs() {
  const { modelId, aspect, resolution, size, background, quality, moderation, provider, webSearch, count, upscale } = state;
  storageSet('localStorage', STORAGE_PREFS, JSON.stringify({ modelId, aspect, resolution, size, background, quality, moderation, provider, webSearch, count, upscale }));
}

function loadPrefs() {
  let prefs;
  try {
    prefs = JSON.parse(storageGet('localStorage', STORAGE_PREFS) || '{}');
  } catch (_) {
    return;
  }
  if (!prefs || typeof prefs !== 'object') return;
  if (MODELS.some((m) => m.id === prefs.modelId)) state.modelId = prefs.modelId;
  if (typeof prefs.aspect === 'string') state.aspect = prefs.aspect;
  if (typeof prefs.resolution === 'string') state.resolution = prefs.resolution;
  if (GPT_SIZES.some(([value]) => value === prefs.size)) state.size = prefs.size;
  if (GPT_BACKGROUNDS.includes(prefs.background)) state.background = prefs.background;
  const known = (list, value) => list.some(([v]) => v === value);
  if (known(GPT_QUALITIES, prefs.quality)) state.quality = prefs.quality;
  if (known(GPT_MODERATIONS, prefs.moderation)) state.moderation = prefs.moderation;
  if (known(GEMINI_PROVIDERS, prefs.provider)) state.provider = prefs.provider;
  if (typeof prefs.webSearch === 'boolean') state.webSearch = prefs.webSearch;
  if (COUNTS.includes(prefs.count)) state.count = prefs.count;
  const up = prefs.upscale;
  if (up && known(UPSCALE_STYLES, up.style) && known(UPSCALE_SCALES, up.x2) && known(UPSCALE_NOISE, up.noise)) {
    state.upscale = { style: up.style, x2: up.x2, noise: up.noise };
  }
}

/* ---------- form controls ---------- */

function currentModel() {
  return MODELS.find((m) => m.id === state.modelId) || MODELS[0];
}

function makeRadio(name, value, checked, onChange) {
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.addEventListener('change', () => {
    if (input.checked) onChange(value);
  });
  return input;
}

function renderModels() {
  els.modelList.replaceChildren(
    ...MODELS.map((model) => {
      const label = document.createElement('label');
      label.className = 'model-option';
      const name = document.createElement('span');
      name.className = 'model-name';
      name.textContent = model.name;
      const head = document.createElement('span');
      head.className = 'model-head';
      head.append(name);
      const id = document.createElement('span');
      id.className = 'model-id';
      id.textContent = model.id;
      const note = document.createElement('span');
      note.className = 'model-note';
      note.textContent = model.note;
      label.append(
        makeRadio('model', model.id, model.id === state.modelId, (value) => {
          state.modelId = value;
          renderControls();
          savePrefs();
        }),
        head,
        id,
        note,
      );
      return label;
    }),
  );
}

function ratioParts(ratio) {
  const [w, h] = ratio.split(':').map(Number);
  return { w, h };
}

function setShape(shape, w, h) {
  const box = 26;
  const r = w / h;
  shape.style.setProperty('--w', `${r >= 1 ? box : Math.max(4, box * r)}px`);
  shape.style.setProperty('--h', `${r >= 1 ? Math.max(4, box / r) : box}px`);
}

function aspectOption(value, text, w, h, onPick) {
  const label = document.createElement('label');
  label.className = 'aspect-option';
  const shapeWrap = document.createElement('span');
  shapeWrap.className = 'aspect-shape';
  const shape = document.createElement('span');
  setShape(shape, w, h);
  shapeWrap.append(shape);
  const caption = document.createElement('span');
  caption.textContent = text;
  label.append(makeRadio('aspect', value, value === state.aspect, onPick), shapeWrap, caption);
  return label;
}

function renderAspects(model) {
  if (!model.aspectRatios.includes(state.aspect)) state.aspect = '1:1';
  const pick = (value) => {
    state.aspect = value;
    savePrefs();
  };
  els.aspectGrid.replaceChildren(
    ...model.aspectRatios.map((ratio) => {
      if (ratio !== 'auto') {
        const { w, h } = ratioParts(ratio);
        return aspectOption(ratio, ratio, w, h, pick);
      }
      // the model picks the shape, or takes it from the first reference
      const option = aspectOption(ratio, ratio, 1, 1, pick);
      option.classList.add('is-auto');
      return option;
    }),
  );
}

function renderSegmented(container, name, values, current, onChange, format = String) {
  container.replaceChildren(
    ...values.map((value) => {
      const label = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = format(value);
      label.append(makeRadio(name, String(value), value === current, () => onChange(value)), text);
      return label;
    }),
  );
}

function fillSelect(select, options, current) {
  select.replaceChildren(
    ...options.map(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = value === current;
      return option;
    }),
  );
}

function showControl(name, visible) {
  const field = els.form.querySelector(`[data-control="${name}"]`);
  field.hidden = !visible;
}

function renderControls() {
  const model = currentModel();
  const isGpt = model.family === 'gpt';

  showControl('aspect', Boolean(model.aspectRatios));
  showControl('resolution', Boolean(model.resolutions));
  showControl('size', isGpt);
  showControl('background', isGpt);
  showControl('quality', isGpt);
  showControl('moderation', isGpt);
  showControl('provider', model.family === 'gemini');
  showControl('web-search', model.family === 'gemini');

  if (model.aspectRatios) renderAspects(model);
  if (model.resolutions) {
    if (!model.resolutions.includes(state.resolution)) state.resolution = model.defaultResolution;
    renderSegmented(els.resGroup, 'resolution', model.resolutions, state.resolution, (value) => {
      state.resolution = value;
      savePrefs();
    });
  }

  const heic = model.refTypes.includes('image/heic');
  els.refInput.accept = heic ? `${model.refTypes.join(',')},.heic,.heif` : model.refTypes.join(',');
  els.refsHint.textContent = `PNG, JPEG, WebP${heic ? ', HEIC' : ''}. Up to ${model.maxRefs}, ${model.maxRefMB} MB each.`;
  renderRefs();
}

function initControls() {
  renderModels();
  fillSelect(els.size, GPT_SIZES, state.size);
  fillSelect(els.background, GPT_BACKGROUNDS.map((b) => [b, b]), state.background);
  fillSelect(els.quality, GPT_QUALITIES, state.quality);
  fillSelect(els.moderation, GPT_MODERATIONS, state.moderation);
  fillSelect(els.provider, GEMINI_PROVIDERS, state.provider);
  els.webSearch.checked = state.webSearch;
  renderSegmented(els.countGroup, 'count', COUNTS, state.count, (value) => {
    state.count = value;
    savePrefs();
  });

  els.size.addEventListener('change', () => {
    state.size = els.size.value;
    savePrefs();
  });
  els.background.addEventListener('change', () => {
    state.background = els.background.value;
    savePrefs();
  });
  els.quality.addEventListener('change', () => {
    state.quality = els.quality.value;
    savePrefs();
  });
  els.moderation.addEventListener('change', () => {
    state.moderation = els.moderation.value;
    savePrefs();
  });
  els.provider.addEventListener('change', () => {
    state.provider = els.provider.value;
    savePrefs();
  });
  els.webSearch.addEventListener('change', () => {
    state.webSearch = els.webSearch.checked;
    savePrefs();
  });

  renderControls();
}

/* ---------- reference images ---------- */

function fileType(file) {
  if (file.type) return file.type.toLowerCase();
  // Some browsers report an empty type for HEIC files.
  const match = /\.(heic|heif)$/i.exec(file.name || '');
  return match ? `image/${match[1].toLowerCase()}` : '';
}

function readAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

function setRefsError(messages) {
  els.refsError.textContent = messages.join(' ');
}

function setRefsNote(text) {
  els.refsNote.textContent = text;
}

function refProblems(model = currentModel()) {
  const problems = [];
  if (state.refs.length > model.maxRefs) {
    problems.push(`${model.name} takes up to ${model.maxRefs} reference images. Remove ${state.refs.length - model.maxRefs}.`);
  }
  const unsupported = state.refs.filter((ref) => !model.refTypes.includes(ref.type));
  if (unsupported.length) {
    problems.push(`${model.name} can't use HEIC references. Remove ${unsupported.map((r) => r.name).join(', ')}.`);
  }
  const tooBig = state.refs.filter((ref) => ref.bytes > model.maxRefMB * MB);
  if (tooBig.length) {
    problems.push(`${model.name} takes images up to ${model.maxRefMB} MB. Remove ${tooBig.map((r) => r.name).join(', ')}.`);
  }
  return problems;
}

async function addRefBlob(blob, name) {
  const model = currentModel();
  const type = fileType(blob);
  if (state.refs.length >= model.maxRefs) {
    return `${model.name} takes up to ${model.maxRefs} reference images.`;
  }
  if (!model.refTypes.includes(type)) {
    return `${name}: ${type || 'this file type'} isn't supported. Use PNG, JPEG or WebP.`;
  }
  if (blob.size > model.maxRefMB * MB) {
    return `${name} is over ${model.maxRefMB} MB.`;
  }
  let base64;
  try {
    base64 = await readAsBase64(blob);
  } catch (_) {
    return `${name} couldn't be read.`;
  }
  state.refs.push({ id: nextId++, name, type, bytes: blob.size, base64, previewUrl: URL.createObjectURL(blob) });
  return null;
}

async function addRefFiles(fileList) {
  setRefsNote('');
  const errors = [];
  for (const file of Array.from(fileList)) {
    const error = await addRefBlob(file, file.name);
    if (error) {
      errors.push(error);
      if (state.refs.length >= currentModel().maxRefs) break;
    }
  }
  renderRefs();
  setRefsError(errors);
}

function removeRef(id) {
  const ref = state.refs.find((r) => r.id === id);
  if (!ref) return;
  URL.revokeObjectURL(ref.previewUrl);
  state.refs = state.refs.filter((r) => r.id !== id);
  setRefsNote('');
  renderRefs();
  setRefsError(refProblems());
}

function renderRefs() {
  const model = currentModel();
  clearFormError();
  els.refsCount.textContent = `${state.refs.length} / ${model.maxRefs}`;
  els.dropzone.classList.toggle('is-full', state.refs.length >= model.maxRefs);
  els.refList.replaceChildren(
    ...state.refs.map((ref, index) => {
      const item = document.createElement('li');
      item.className = 'ref-item';
      const img = document.createElement('img');
      img.alt = ref.name;
      img.src = ref.previewUrl;
      // HEIC previews don't decode outside Safari; show the file name instead.
      img.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'ref-name';
        fallback.textContent = ref.name;
        img.replaceWith(fallback);
      });
      const badge = document.createElement('span');
      badge.className = 'ref-index';
      badge.textContent = String(index + 1);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ref-remove';
      remove.setAttribute('aria-label', `Remove ${ref.name}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
      remove.addEventListener('click', () => {
        if (window.confirm('Remove this reference image?')) removeRef(ref.id);
      });
      item.append(img, badge, remove);
      return item;
    }),
  );
  setRefsError(refProblems(model));
  els.moderationNote.textContent = state.refs.length ? 'Not sent with reference images; that endpoint has no moderation setting.' : '';
}

function initRefs() {
  els.refInput.addEventListener('change', async () => {
    const files = els.refInput.files;
    if (files && files.length) await addRefFiles(files);
    els.refInput.value = '';
  });

  // An image pasted anywhere on the page (Ctrl+V, or the keyboard's paste on a phone)
  // becomes a reference. Text pastes are left alone.
  document.addEventListener('paste', async (event) => {
    if (event.target === els.keyInput) return;
    const files = Array.from((event.clipboardData && event.clipboardData.files) || []).filter((file) => fileType(file).startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    const before = state.refs.length;
    await addRefFiles(files);
    const added = state.refs.length - before;
    if (added) setRefsNote(added === 1 ? 'Pasted image added as a reference.' : `${added} pasted images added as references.`);
  });

  els.dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.dropzone.classList.add('is-over');
  });
  els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('is-over'));
  els.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.dropzone.classList.remove('is-over');
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) addRefFiles(files);
  });
}

/* ---------- request ---------- */

class ApiError extends Error {
  constructor(status, kind, message, requestId) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind || '';
    this.serverMessage = message || '';
    this.requestId = requestId || '';
  }
}

class StudioError extends Error {
  constructor(kind, details = {}) {
    super(kind);
    this.name = 'StudioError';
    this.kind = kind;
    Object.assign(this, details);
  }
}

function snapshotJob() {
  const model = currentModel();
  const params = {};
  if (model.aspectRatios) params.aspect = state.aspect;
  if (model.resolutions) params.resolution = state.resolution;
  if (model.family === 'gpt') {
    params.size = state.size;
    params.background = state.background;
    params.quality = state.quality;
    params.moderation = state.moderation;
  }
  if (model.family === 'gemini') {
    params.provider = state.provider;
    params.webSearch = state.webSearch;
  }
  return {
    modelId: model.id,
    modelName: model.name,
    family: model.family,
    prompt: els.prompt.value.trim(),
    params,
    refs: state.refs.map(({ base64, type }) => ({ base64, type })),
  };
}

// GPT takes references only on the edit endpoint, which wants them as files in a form.
function usesEditEndpoint(job) {
  return job.family === 'gpt' && job.refs.length > 0;
}

// Nano Banana 2 takes everything as JSON, references as data URIs in image_urls.
function buildRequest(job) {
  const p = job.params;
  const { prompt } = job;

  if (job.family === 'gpt') {
    // base64 comes back in the response itself, so the image can be re-encoded to PNG
    // here without depending on the file host allowing cross-origin reads.
    // size is always sent because AI/ML API's default is 1024x1024, not auto.
    const fields = { model: job.modelId, prompt, size: p.size || 'auto', quality: p.quality || 'medium', output_format: 'png', response_format: 'b64_json' };
    if (p.background && p.background !== 'auto') fields.background = p.background;
    if (!usesEditEndpoint(job)) {
      if (p.moderation === 'low') fields.moderation = 'low';
      return { url: GENERATE_URL, body: JSON.stringify(fields), json: true };
    }
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    job.refs.forEach((ref, i) => {
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[ref.type] || 'png';
      // "image[]" is how the OpenAI SDKs that AI/ML API documents send several files
      form.append('image[]', new Blob([base64ToBytes(ref.base64)], { type: ref.type }), `reference-${i + 1}.${ext}`);
    });
    return { url: EDIT_URL, body: form, json: false };
  }

  const body = { model: job.modelId, prompt };
  if (p.aspect) body.aspect_ratio = p.aspect;
  if (p.resolution) body.resolution = p.resolution;
  if (p.provider && p.provider !== 'auto') body.provider = p.provider;
  if (p.webSearch) body.enable_web_search = true;
  if (job.refs.length) body.image_urls = job.refs.map((ref) => `data:${ref.type};base64,${ref.base64}`);
  return { url: GENERATE_URL, body: JSON.stringify(body), json: true };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

// A validation error can carry its details as a list of strings rather than one string.
function messageText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join('; ');
  return '';
}

// Errors look like { status, message, requestId, error: { name, message, data: { kind } } },
// e.g. a 403 with kind "err_insufficent_credits" when the balance is used up.
function errorFromPayload(httpStatus, payload, headerRequestId) {
  const err = payload && typeof payload.error === 'object' ? payload.error : null;
  const message = messageText(payload && payload.message) || messageText(err && err.message) || messageText(payload && payload.error);
  const kind = (err && err.data && err.data.kind) || (err && (err.type || err.name)) || '';
  const status = httpStatus >= 400 ? httpStatus : Number(payload && payload.status) || 0;
  return new ApiError(status, kind, message, (payload && payload.requestId) || headerRequestId);
}

async function requestImage(job, signal) {
  const request = buildRequest(job);
  const headers = { Authorization: `Bearer ${state.apiKey}` };
  if (request.json) headers['Content-Type'] = 'application/json';
  const response = await fetch(request.url, {
    method: 'POST',
    headers,
    body: request.body,
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  });
  const payload = safeJson(await response.text());
  if (!response.ok || (payload && payload.error)) {
    // Support asks for the request ID; it's in the error body, the header is a fallback
    throw errorFromPayload(response.status, payload, response.headers.get('x-request-id'));
  }

  const item = payload && Array.isArray(payload.data) ? payload.data[0] : null;
  if (item && typeof item.b64_json === 'string' && item.b64_json) return { base64: item.b64_json };
  if (item && typeof item.url === 'string' && item.url) return { url: item.url };
  throw new StudioError('empty');
}

/* ---------- PNG conversion ---------- */

function base64ToBytes(base64) {
  let binary;
  try {
    binary = atob(base64.replace(/^data:[^,]*,/, '').replace(/\s/g, ''));
  } catch (_) {
    throw new StudioError('decode');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sniffFormat(bytes) {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'heic/avif';
  return 'unknown';
}

const MIME_FOR = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new StudioError('decode'));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new StudioError('encode'))), 'image/png');
  });
}

// Whatever format the provider returned, the result handed to the person is a PNG.
// PNG input is kept byte for byte; anything else is decoded and re-encoded.
async function toPng(bytes) {
  const format = sniffFormat(bytes);
  const source = new Blob([bytes], { type: MIME_FOR[format] || 'application/octet-stream' });
  const img = await loadImage(source);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) throw new StudioError('decode');
  if (format === 'png') return { blob: new Blob([bytes], { type: 'image/png' }), width, height, format };

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new StudioError('encode');
  ctx.drawImage(img, 0, 0);
  const blob = await canvasToPng(canvas);
  return { blob, width, height, format };
}

async function fetchImageBytes(url, signal) {
  let response;
  try {
    response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new StudioError('link-only', { url });
  }
  if (!response.ok) throw new StudioError('link-only', { url });
  return new Uint8Array(await response.arrayBuffer());
}

/* ---------- error messages ---------- */

// API messages sometimes use a long dash as punctuation; show a comma instead.
// An unspaced en dash is a range like 5\u201310, so it becomes a hyphen.
function plainDashes(text) {
  return text
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\s+\u2013\s+/g, ', ')
    .replace(/\u2013/g, '-')
    .replace(/^,\s*/, '');
}

function cleanServerMessage(message) {
  if (!message) return '';
  const text = plainDashes(redact(String(message)).trim());
  if (text.startsWith('<')) return '';
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function describeError(err, job, timedOut) {
  if (timedOut) {
    return {
      title: 'Timed out',
      body: `No answer after ${timeoutFor(job) / 60000} minutes. The model may be overloaded. Try again or pick another model.`,
    };
  }
  if (err && err.name === 'AbortError') return { title: 'Cancelled', body: 'You stopped this one.' };

  if (err instanceof StudioError) {
    switch (err.kind) {
      case 'no-key':
        return { title: 'No API key', body: 'Add your AI/ML API key with the key button at the top.' };
      case 'empty':
        return { title: 'No image came back', body: 'The API answered without an image. This can happen when a prompt gets filtered. Try rewording it.' };
      case 'decode':
        return { title: "Couldn't read the image", body: "The API sent image data this browser can't decode." };
      case 'encode':
        return { title: "Couldn't make a PNG", body: 'The image is too large for this browser to convert. Try a lower resolution.' };
      case 'upscale':
        return { title: 'Upscale failed', body: err.detail, openKey: err.openKey, url: err.url };
      case 'link-only':
        return {
          title: "Couldn't convert to PNG",
          body: "The image came back as a link this page isn't allowed to read, so it can't be turned into a PNG here. You can still open it directly.",
          url: err.url,
        };
      default:
        break;
    }
  }

  // Wording follows https://docs.aimlapi.com/errors-and-messages/errors-with-status-code-4xx
  // and the 5xx page next to it
  if (err instanceof ApiError) {
    const detail = cleanServerMessage(err.serverMessage);
    const withDetail = (text) => (detail ? `${text} API said: ${detail}` : text);
    const s = err.status;
    const model = job.modelId;
    if (s === 401) {
      return { title: 'Key rejected', body: "AI/ML API didn't accept your key. Check it matches one on the Keys page of your dashboard, that it's enabled there, and enter it again.", openKey: true };
    }
    if (s === 403 && (err.kind === 'err_insufficent_credits' || /credits|funds|balance/i.test(err.serverMessage))) {
      return { title: 'Out of credits', body: 'Your AI/ML API balance is used up. Top it up on the Billing page of your dashboard.' };
    }
    if (s === 403) return { title: 'No access', body: withDetail(`Your account or this key isn't allowed to use ${model}.`) };
    if (s === 404) {
      return { title: 'Model not found', body: withDetail(`AI/ML API didn't recognise ${model}. It may have been renamed or retired; check the Models page on aimlapi.com.`) };
    }
    if (s === 413) return { title: 'Request too large', body: 'Shorten the prompt, or use fewer or smaller reference images.' };
    if (s === 429) return { title: 'Rate limited', body: withDetail('Too many requests in a short time. Wait a bit and try again.') };
    if (s === 502 || s === 503) {
      return { title: 'Model unavailable', body: withDetail(`The provider behind ${model} failed or is down for now. Try again in a few minutes, or switch models.`) };
    }
    if (s === 504) return { title: 'Generation timed out', body: withDetail(`${model} didn't finish in AI/ML API's time limit. Try again, or try a lower resolution.`) };
    if (s >= 500) {
      return { title: 'Server error', body: withDetail('Something broke on AI/ML API\'s side. Try again, and if it keeps happening, send support the details below.') };
    }
    if (s >= 400) return { title: 'Request rejected', body: detail || "The API didn't accept these settings. Try a different size, aspect ratio, or fewer references." };
    return { title: 'Something went wrong', body: detail || `The API returned status ${s || 'unknown'}.` };
  }

  if (err instanceof TypeError) {
    return {
      title: "Couldn't reach AI/ML API",
      body: 'Check your connection. If it keeps happening, an extension may be blocking the request, or the API is refusing calls from browsers (CORS).',
    };
  }

  return { title: 'Something went wrong', body: cleanServerMessage(err && err.message) || 'An unexpected error happened. Try again.' };
}

/* ---------- result cards ---------- */

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function guessRatio(job) {
  const p = job.params;
  if (p.ratio) return p.ratio;
  if (p.size && p.size !== 'auto') {
    const [w, h] = p.size.split('x').map(Number);
    return w / h;
  }
  if (p.aspect && p.aspect !== 'auto') {
    const { w, h } = ratioParts(p.aspect);
    return w / h;
  }
  return 1;
}

function optionText(options, value) {
  const match = options.find(([v]) => v === value);
  return match ? match[1] : value;
}

function describeParams(job) {
  const p = job.params;
  if (job.family === 'import') return ['your image', p.name].filter(Boolean).join(' · ');
  if (job.family === 'upscale') {
    return ['bigjpg', optionText(UPSCALE_SCALES, p.x2), optionText(UPSCALE_STYLES, p.style), optionText(UPSCALE_NOISE, p.noise)].join(' · ');
  }
  const parts = [job.modelId];
  if (p.aspect) parts.push(p.aspect);
  if (p.resolution) parts.push(p.resolution);
  if (p.size && p.size !== 'auto') parts.push(p.size);
  if (p.background && p.background !== 'auto') parts.push(`${p.background} bg`);
  if (p.quality) parts.push(`${p.quality} quality`);
  if (p.moderation === 'low' && !usesEditEndpoint(job)) parts.push('low moderation');
  if (p.provider && p.provider !== 'auto') parts.push(`via ${p.provider}`);
  if (p.webSearch) parts.push('web search');
  const refCount = job.refs.length || job.refCount || 0;
  if (refCount) parts.push(`${refCount} ref${refCount > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

function updateGalleryChrome() {
  const hasCards = cards.size > 0;
  els.empty.hidden = hasCards;
  els.clearGallery.hidden = !hasCards;
  renderBatch();
}

function createCard(job) {
  const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
  const card = {
    id: nextId++,
    node,
    job,
    controller: null,
    timer: null,
    timeout: null,
    result: null,
    objectUrl: null,
    q: (selector) => node.querySelector(selector),
  };

  card.q('.card-prompt').textContent = job.prompt || '(no prompt)';
  card.q('.card-info').textContent = describeParams(job);
  node.classList.toggle('is-upscale', job.family === 'upscale');
  node.classList.toggle('is-import', job.family === 'import');

  card.q('.card-cancel').addEventListener('click', () => {
    const queued = upscaleQueue.waiting.includes(card);
    if (!card.controller && !queued) return;
    if (!window.confirm(queued ? 'Take this image out of the upscale line?' : 'Stop generating this image?')) return;
    if (dequeueUpscale(card)) showFailure(card, { title: 'Cancelled', body: 'You took this one out of the line.' }, '');
    else if (card.controller) card.controller.abort();
  });
  card.q('.card-retry').addEventListener('click', () => (card.job.family === 'upscale' ? queueUpscale(card) : runCard(card)));
  card.q('.card-pick-box').addEventListener('change', renderBatch);
  card.q('.card-dismiss').addEventListener('click', () => {
    if (confirmCardRemoval(card)) removeCard(card);
  });
  card.q('.card-remove').addEventListener('click', () => {
    if (confirmCardRemoval(card)) removeWithUndo(card);
  });
  card.q('.card-undo-btn').addEventListener('click', () => undoRemove(card));
  card.q('.card-open').addEventListener('click', () => openViewer(card));
  card.q('.card-copy').addEventListener('click', () => copyPrompt(card));
  card.q('.card-report-copy').addEventListener('click', () => copyReport(card));
  card.q('.card-ref').addEventListener('click', () => useAsReference(card));
  for (const button of node.querySelectorAll('.card-reuse')) button.addEventListener('click', () => reuseSettings(card, button));

  const upscaleSelects = [
    [card.q('.up-style'), UPSCALE_STYLES, 'style'],
    [card.q('.up-scale'), UPSCALE_SCALES, 'x2'],
    [card.q('.up-noise'), UPSCALE_NOISE, 'noise'],
  ];
  for (const [select, options, name] of upscaleSelects) {
    fillSelect(select, options, state.upscale[name]);
    select.addEventListener('change', () => {
      state.upscale = { ...state.upscale, [name]: select.value };
      savePrefs();
      renderUpscaleNote(card);
    });
  }
  card.q('.up-start').addEventListener('click', () => startUpscale(card));

  cards.set(card.id, card);
  els.gallery.prepend(node);
  updateGalleryChrome();
  return card;
}

function setCardState(card, status) {
  card.node.classList.toggle('is-pending', status === 'pending');
  card.node.classList.toggle('is-failed', status === 'failed');
  card.node.classList.toggle('is-done', status === 'done');
}

function stopCardTimers(card) {
  clearInterval(card.timer);
  clearTimeout(card.timeout);
  card.timer = null;
  card.timeout = null;
}

function isProviderFailure(err) {
  return err instanceof ApiError && (err.status === 502 || err.status === 503);
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, ms);
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
}

async function requestWithRetries(card, signal) {
  const note = card.q('.pending-note');
  const attempts = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestImage(card.job, signal);
    } catch (err) {
      if (attempt >= attempts || !isProviderFailure(err)) {
        if (err instanceof ApiError) err.attempts = attempt;
        throw err;
      }
      note.textContent = `The provider failed. Trying again (${attempt + 1} of ${attempts})...`;
      await pause(RETRY_DELAYS_MS[attempt - 1], signal);
    }
  }
}

async function runCard(card) {
  const { job } = card;
  stopCardTimers(card);
  setCardState(card, 'pending');
  card.node.style.setProperty('--ar', String(guessRatio(job)));

  const started = Date.now();
  const elapsed = card.q('.elapsed');
  elapsed.textContent = '0s';
  card.q('.pending-note').textContent = '';
  card.timer = setInterval(() => {
    elapsed.textContent = formatElapsed(Date.now() - started);
  }, 1000);

  const controller = new AbortController();
  card.controller = controller;
  let timedOut = false;
  card.timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutFor(job));

  const upscale = job.family === 'upscale';
  try {
    if (upscale && !state.upscaler) throw new StudioError('upscale', { detail: 'Set up the bigjpg upscaler in the key panel first.', openKey: true });
    if (!upscale && !state.apiKey) throw new StudioError('no-key');
    const answer = upscale ? await requestUpscale(card, controller.signal) : await requestWithRetries(card, controller.signal);
    const bytes = answer.bytes || (answer.base64 ? base64ToBytes(answer.base64) : await fetchImageBytes(answer.url, controller.signal));
    const png = upscale ? await toPngOrKeep(bytes, job) : await toPng(bytes);
    if (!cards.has(card.id)) return;
    showResult(card, png, Date.now() - started);
  } catch (err) {
    if (!cards.has(card.id)) return;
    const info = describeError(err, job, timedOut);
    if (err instanceof ApiError && err.attempts > 1) info.body += ` Tried ${err.attempts} times.`;
    const reportable = !upscale && !timedOut && (err instanceof ApiError || err instanceof TypeError);
    showFailure(card, info, reportable ? errorReport(err, job, new Date()) : '');
  } finally {
    stopCardTimers(card);
    card.controller = null;
  }
}

function showResult(card, png, tookMs, restored = false) {
  if (card.objectUrl) URL.revokeObjectURL(card.objectUrl);
  card.result = png;
  card.tookMs = tookMs;
  if (!card.createdAt) card.createdAt = Date.now();
  card.objectUrl = URL.createObjectURL(png.blob);

  const img = card.q('.card-open img');
  img.src = card.objectUrl;
  img.alt = card.job.prompt;
  card.node.style.setProperty('--ar', String(png.width / png.height));

  const stamp = new Date(card.createdAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Results are PNG unless an upscale was too large for this browser to convert
  const isPng = png.blob.type === 'image/png';
  const ext = isPng ? 'png' : { webp: 'webp', gif: 'gif' }[png.format] || 'jpg';
  const download = card.q('.card-download');
  download.href = card.objectUrl;
  download.download = `${card.job.modelId}-${stamp}.${ext}`;
  download.textContent = `download ${ext}`;

  const converted = isPng && png.format !== 'png' ? ` · converted from ${png.format}` : '';
  const imported = card.job.family === 'import';
  const kept = isPng || imported ? '' : ' · kept as sent, couldn\'t convert here';
  const took = imported ? '' : ` · ${formatElapsed(tookMs)}`;
  card.q('.card-info').textContent = `${describeParams(card.job)} · ${png.width}×${png.height} ${ext}${converted}${kept}${took}`;
  renderUpscaleNote(card);
  setCardState(card, 'done');
  if (!restored) saveResult(card);
}

// What AI/ML API support needs to find a request. It never includes the key or the prompt.
function errorReport(err, job, when) {
  const lines = [
    `time: ${when.toISOString().slice(0, 19)}Z`,
    `endpoint: POST /v1/images/${usesEditEndpoint(job) ? 'edits' : 'generations'}`,
    `model: ${job.modelId}`,
    `settings: ${describeParams(job).split(' · ').slice(1).join(' · ') || 'defaults'}`,
  ];
  if (err instanceof ApiError) {
    lines.push(`status: ${err.status || 'unknown'}`);
    if (err.kind) lines.push(`kind: ${err.kind}`);
    const message = cleanServerMessage(err.serverMessage);
    if (message) lines.push(`message: ${message}`);
    if (err.attempts > 1) lines.push(`attempts: ${err.attempts}`);
    if (err.requestId) lines.push(`request id: ${err.requestId}`);
  } else {
    lines.push(`error: ${err && err.name ? err.name : 'unknown'}${err && err.message ? `: ${redact(err.message)}` : ''}`);
  }
  return lines.join('\n');
}

function showFailure(card, info, report) {
  card.q('.card-error-title').textContent = info.title;
  card.q('.card-error-body').textContent = info.body;
  const reportBox = card.q('.card-report');
  reportBox.hidden = !report;
  reportBox.open = false;
  card.q('.card-report pre').textContent = report || '';
  const link = card.q('.card-link');
  if (info.url && /^https:\/\//i.test(info.url)) {
    link.href = info.url;
    link.hidden = false;
  } else {
    link.hidden = true;
    link.removeAttribute('href');
  }
  setCardState(card, 'failed');
  if (info.openKey) setKeyPanelOpen(true);
}

function confirmCardRemoval(card) {
  if (card.result) return window.confirm('Remove this image? It gets deleted from this device too.');
  return window.confirm('Remove this card? The error details go with it.');
}

// A finished image isn't deleted straight away: the card collapses to an undo bar first,
// so a stray tap doesn't lose it. Failed cards have no image and go immediately.
function removeWithUndo(card) {
  if (!card.result) {
    removeCard(card);
    return;
  }
  let left = UNDO_SECONDS;
  const button = card.q('.card-undo-btn');
  const tick = () => {
    button.textContent = `undo (${left}s)`;
  };
  tick();
  card.node.classList.add('is-removed');
  renderBatch();
  card.undoTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) removeCard(card);
    else tick();
  }, 1000);
  button.focus();
}

function undoRemove(card) {
  clearInterval(card.undoTimer);
  card.undoTimer = null;
  card.node.classList.remove('is-removed');
  renderBatch();
  card.q('.card-remove').focus();
}

function removeCard(card) {
  if (card.controller) card.controller.abort();
  clearInterval(card.undoTimer);
  stopCardTimers(card);
  if (card.objectUrl) URL.revokeObjectURL(card.objectUrl);
  card.node.remove();
  cards.delete(card.id);
  if (card.savedId) forgetSaved(card.savedId);
  updateGalleryChrome();
}

function flashButton(button, text) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = text;
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

async function copyPrompt(card) {
  const button = card.q('.card-copy');
  try {
    await navigator.clipboard.writeText(card.job.prompt);
    flashButton(button, 'copied');
  } catch (_) {
    flashButton(button, "couldn't copy");
  }
}

async function copyReport(card) {
  const button = card.q('.card-report-copy');
  try {
    await navigator.clipboard.writeText(card.q('.card-report pre').textContent);
    flashButton(button, 'copied');
  } catch (_) {
    flashButton(button, 'select the text above');
  }
}

async function useAsReference(card) {
  if (!card.result) return;
  const button = card.q('.card-ref');
  const error = await addRefBlob(card.result.blob, `result-${card.id}.png`);
  renderRefs();
  if (error) {
    setRefsError([error]);
    flashButton(button, 'no room');
  } else {
    flashButton(button, 'added');
  }
}

/* ---------- bigjpg upscaling ---------- */

// An image from the device becomes a card of its own, kept exactly as it was, so it can be
// upscaled like a generated one.
async function importForUpscale(files) {
  for (const file of files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      window.alert(`${file.name} isn't a PNG, JPEG or WebP image, so it can't be upscaled.`);
      continue;
    }
    let img;
    try {
      img = await loadImage(file);
    } catch (_) {
      window.alert(`${file.name} couldn't be opened as an image.`);
      continue;
    }
    const format = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[file.type];
    const card = createCard({ modelId: 'your-image', modelName: 'your image', family: 'import', prompt: '', params: { name: file.name }, refs: [] });
    showResult(card, { blob: file, width: img.naturalWidth, height: img.naturalHeight, format }, 0);
  }
}

function initUpscaleOwn() {
  els.upscaleOwn.addEventListener('click', () => els.upscaleFile.click());
  els.upscaleFile.addEventListener('change', async () => {
    const files = Array.from(els.upscaleFile.files || []);
    els.upscaleFile.value = '';
    await importForUpscale(files);
  });
}

function timeoutFor(job) {
  return job.family === 'upscale' ? UPSCALE_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

function renderUpscaleNote(card) {
  const note = card.q('.up-note');
  if (!card.result) {
    note.textContent = '';
    return;
  }
  const factor = 2 ** Number(card.q('.up-scale').value);
  note.textContent = `Makes ${card.result.width * factor}×${card.result.height * factor}. Uses one bigjpg API call.`;
}

function startUpscale(card, options = state.upscale) {
  if (!card.result) return;
  const { style, x2, noise } = options;
  const factor = 2 ** Number(x2);
  const { width, height, blob } = card.result;
  queueUpscale(createCard({
    modelId: 'bigjpg',
    modelName: 'bigjpg',
    family: 'upscale',
    prompt: card.job.prompt,
    params: { style, x2, noise, ratio: width / height, width: width * factor, height: height * factor },
    refs: [],
    // the image to enlarge; kept in memory for "try again" and left out of what gets saved
    source: blob,
  }));
}

function queueUpscale(card) {
  setCardState(card, 'pending');
  card.q('.elapsed').textContent = '';
  card.q('.pending-note').textContent = 'Waiting for other upscales to finish...';
  upscaleQueue.waiting.push(card);
  pumpUpscales();
}

function pumpUpscales() {
  while (upscaleQueue.running < UPSCALE_AT_ONCE && upscaleQueue.waiting.length) {
    const card = upscaleQueue.waiting.shift();
    if (!cards.has(card.id)) continue;
    upscaleQueue.running += 1;
    runCard(card).finally(() => {
      upscaleQueue.running -= 1;
      pumpUpscales();
    });
  }
}

function dequeueUpscale(card) {
  const index = upscaleQueue.waiting.indexOf(card);
  if (index === -1) return false;
  upscaleQueue.waiting.splice(index, 1);
  return true;
}

/* ---------- upscale several at once ---------- */

function pickableCards() {
  return Array.from(cards.values()).filter((card) => card.result && !card.node.classList.contains('is-removed'));
}

function pickedCards() {
  return pickableCards().filter((card) => card.q('.card-pick-box').checked);
}

function renderBatch() {
  for (const card of cards.values()) card.node.classList.toggle('is-picked', card.q('.card-pick-box').checked);
  const count = pickedCards().length;
  els.batchCount.textContent = count ? `${count} selected` : 'Tick the images to upscale.';
  els.batchStart.textContent = count ? `upscale ${count}` : 'upscale';
  els.batchStart.disabled = count === 0;
}

function setSelecting(on) {
  document.body.classList.toggle('is-selecting', on);
  els.batchBar.hidden = !on;
  if (!on) for (const card of cards.values()) card.q('.card-pick-box').checked = false;
  if (on) {
    els.batchStyle.value = state.upscale.style;
    els.batchScale.value = state.upscale.x2;
    els.batchNoise.value = state.upscale.noise;
  }
  renderBatch();
}

function initBatch() {
  const selects = [[els.batchStyle, UPSCALE_STYLES, 'style'], [els.batchScale, UPSCALE_SCALES, 'x2'], [els.batchNoise, UPSCALE_NOISE, 'noise']];
  for (const [select, options, name] of selects) {
    fillSelect(select, options, state.upscale[name]);
    select.addEventListener('change', () => {
      state.upscale = { ...state.upscale, [name]: select.value };
      savePrefs();
    });
  }
  els.upscaleSeveral.addEventListener('click', () => setSelecting(!document.body.classList.contains('is-selecting')));
  els.batchDone.addEventListener('click', () => setSelecting(false));
  els.batchAll.addEventListener('click', () => {
    for (const card of pickableCards()) card.q('.card-pick-box').checked = true;
    renderBatch();
  });
  els.batchStart.addEventListener('click', () => {
    const picked = pickedCards();
    if (!picked.length) return;
    const options = { ...state.upscale };
    const s = picked.length > 1 ? 's' : '';
    const settings = `${optionText(UPSCALE_SCALES, options.x2)}, ${optionText(UPSCALE_STYLES, options.style)}, ${optionText(UPSCALE_NOISE, options.noise)}`;
    if (!window.confirm(`Upscale ${picked.length} image${s} (${settings})? Uses ${picked.length} bigjpg API call${s}.`)) return;
    // oldest first: they're processed in that order and the gallery ends up mirroring the originals
    for (const card of picked) startUpscale(card, options);
    setSelecting(false);
  });
}

// Which part of an upscale a Worker path belongs to, so a failure says where it stopped
function upscaleStep(path, init) {
  if (path === '/upload') {
    const size = init.body && init.body.size ? ` (${(init.body.size / MB).toFixed(1)} MB)` : '';
    return `uploading the image${size}`;
  }
  if (path === '/task') return 'starting the enlarge';
  if (path.startsWith('/task/')) return 'checking on the enlarge';
  if (path.startsWith('/image')) return 'downloading the result';
  return 'talking to it';
}

async function upscalerFetch(path, init, signal) {
  const { url, password } = state.upscaler;
  let response;
  try {
    response = await fetch(`${url}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), 'X-Proxy-Password': password },
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new StudioError('upscale', { detail: `Couldn't reach your bigjpg Worker while ${upscaleStep(path, init)}. Check your connection and the Worker address in the key panel.` });
  }
  if (response.status === 401) {
    throw new StudioError('upscale', { detail: 'The Worker says the password is wrong. Update it in the key panel.', openKey: true });
  }
  return response;
}

async function upscalerJson(path, init, signal) {
  const response = await upscalerFetch(path, init, signal);
  const data = safeJson(await response.text());
  if (!response.ok || !data || data.error) {
    const said = data && data.error ? data.error : `status ${response.status}`;
    throw new StudioError('upscale', { detail: `The Worker said, while ${upscaleStep(path, init)}: ${said}` });
  }
  return data;
}

async function requestUpscale(card, signal) {
  const { job } = card;
  const p = job.params;
  const note = card.q('.pending-note');
  if (!job.source) throw new StudioError('upscale', { detail: 'The original image is no longer in memory. Upscale it again from its own card.' });

  note.textContent = 'Uploading to bigjpg...';
  const { fileurl } = await upscalerJson('/upload', { method: 'POST', headers: { 'Content-Type': job.source.type || 'image/png' }, body: job.source }, signal);

  note.textContent = 'Starting the enlarge...';
  const task = await upscalerJson('/task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ style: p.style, noise: p.noise, x2: p.x2, input: fileurl }),
  }, signal);
  if (!task.tid) throw new StudioError('upscale', { detail: `bigjpg didn't start the enlarge (${task.status || 'no task id'}).` });

  const estimate = task.minute ? `bigjpg estimates about ${task.minute} min.` : 'bigjpg is enlarging.';
  const left = typeof task.remaining_api_calls === 'number' ? ` ${task.remaining_api_calls} API calls left.` : '';
  note.textContent = estimate + left;

  let misses = 0;
  for (;;) {
    await pause(UPSCALE_POLL_MS, signal);
    let all;
    try {
      all = await upscalerJson(`/task/${task.tid}`, {}, signal);
      if (misses) note.textContent = estimate + left;
      misses = 0;
    } catch (err) {
      // a wrong password won't fix itself; anything else gets a few more tries
      if (!(err instanceof StudioError) || err.openKey || ++misses >= UPSCALE_POLL_MISSES) throw err;
      note.textContent = 'Lost touch with the Worker for a moment. Still waiting...';
      continue;
    }
    const status = all[task.tid] || {};
    if (status.status === 'success' && status.url) {
      note.textContent = 'Downloading the result...';
      return { bytes: await downloadUpscale(status.url, signal) };
    }
    // Only "process" and "success" have been seen; anything that reads as a failure stops,
    // anything else keeps waiting until the timeout
    if (/error|fail/i.test(status.status || '')) {
      throw new StudioError('upscale', { detail: `bigjpg reported "${status.status}". Enlarging sometimes fails on their side; try again.` });
    }
  }
}

// bigjpg's file host allows cross-origin reads; the Worker's /image route is the fallback
async function downloadUpscale(url, signal) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await upscaleBytes(url, signal);
    } catch (err) {
      if (!(err instanceof StudioError) || attempt >= UPSCALE_DOWNLOAD_TRIES) {
        // the enlarge itself worked, so offer the file as a link
        if (err instanceof StudioError && !err.url) err.url = url;
        throw err;
      }
      await pause(5000, signal);
    }
  }
}

async function upscaleBytes(url, signal) {
  try {
    return await fetchImageBytes(url, signal);
  } catch (err) {
    if (!(err instanceof StudioError)) throw err;
  }
  const response = await upscalerFetch(`/image?url=${encodeURIComponent(url)}`, {}, signal);
  if (!response.ok) throw new StudioError('upscale', { detail: "The enlarged image couldn't be downloaded.", url });
  return new Uint8Array(await response.arrayBuffer());
}

// A large enlargement can be too big for this browser to re-encode, so keep bigjpg's file instead.
async function toPngOrKeep(bytes, job) {
  try {
    return await toPng(bytes);
  } catch (err) {
    if (!(err instanceof StudioError)) throw err;
    const format = sniffFormat(bytes);
    return {
      blob: new Blob([bytes], { type: MIME_FOR[format] || 'image/jpeg' }),
      width: job.params.width,
      height: job.params.height,
      format,
    };
  }
}

function openViewer(card) {
  if (!card.objectUrl) return;
  els.viewerImg.src = card.objectUrl;
  els.viewerImg.alt = card.job.prompt;
  if (typeof els.viewer.showModal === 'function') {
    els.viewer.showModal();
  } else {
    window.open(card.objectUrl, '_blank', 'noopener');
  }
}

function initViewer() {
  els.viewer.addEventListener('click', () => els.viewer.close());
  els.viewerClose.addEventListener('click', () => els.viewer.close());
  els.viewer.addEventListener('close', () => {
    els.viewerImg.removeAttribute('src');
  });
}

/* ---------- saved results (IndexedDB) ---------- */

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(DB_NAME, 1);
      } catch (err) {
        reject(err);
        return;
      }
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

async function dbRun(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const request = action(tx.objectStore(DB_STORE));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

function newSavedId() {
  const random = new Uint32Array(2);
  crypto.getRandomValues(random);
  return `${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function renderSavedLine() {
  if (saved.available === false) {
    els.savedLine.textContent = "This browser won't let the page save images, so results disappear when you close the tab.";
    return;
  }
  const count = saved.bytes.size;
  if (!count) {
    els.savedLine.textContent = '';
    return;
  }
  const total = Array.from(saved.bytes.values()).reduce((sum, size) => sum + size, 0);
  const full = saved.full ? ' · storage full, oldest images were dropped' : '';
  els.savedLine.textContent = `${count} saved on this device · ${formatBytes(total)}${full}`;
}

async function saveResult(card) {
  const record = {
    id: newSavedId(),
    createdAt: card.createdAt,
    blob: card.result.blob,
    width: card.result.width,
    height: card.result.height,
    format: card.result.format,
    tookMs: card.tookMs,
    job: {
      modelId: card.job.modelId,
      modelName: card.job.modelName,
      family: card.job.family,
      prompt: card.job.prompt,
      params: card.job.params,
      refCount: card.job.refs.length || card.job.refCount || 0,
    },
  };
  // When storage is full, drop the oldest saved images (they stay on screen for now) and try again.
  for (;;) {
    try {
      await dbRun('readwrite', (store) => store.put(record));
      if (!cards.has(card.id)) {
        await dbRun('readwrite', (store) => store.delete(record.id)).catch(() => {});
        return;
      }
      card.savedId = record.id;
      saved.available = true;
      saved.bytes.set(record.id, record.blob.size);
      renderSavedLine();
      return;
    } catch (err) {
      if (!err || err.name !== 'QuotaExceededError') {
        saved.available = false;
        renderSavedLine();
        return;
      }
      const oldest = Array.from(cards.values())
        .filter((other) => other.savedId && other !== card)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      saved.full = true;
      if (!oldest) {
        card.q('.card-info').textContent += ' · not saved, storage is full';
        renderSavedLine();
        return;
      }
      await forgetSaved(oldest.savedId);
      oldest.savedId = null;
    }
  }
}

async function forgetSaved(id) {
  saved.bytes.delete(id);
  renderSavedLine();
  try {
    await dbRun('readwrite', (store) => store.delete(id));
  } catch (_) {
    /* already gone or storage unavailable; nothing else to clean up */
  }
}

async function restoreSaved() {
  let records;
  try {
    records = await dbRun('readonly', (store) => store.getAll());
    saved.available = true;
  } catch (_) {
    saved.available = false;
    renderSavedLine();
    return;
  }
  records
    .filter((record) => record && record.blob instanceof Blob && record.job && typeof record.job.modelId === 'string')
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((record) => {
      const card = createCard({ ...record.job, params: record.job.params || {}, refs: [] });
      card.savedId = record.id;
      card.createdAt = record.createdAt;
      saved.bytes.set(record.id, record.blob.size);
      showResult(card, { blob: record.blob, width: record.width, height: record.height, format: record.format }, record.tookMs || 0, true);
    });
  renderSavedLine();
}

/* ---------- reuse a result's settings ---------- */

// null when the model that made the image isn't in the picker (any more)
function pickerFor(job) {
  const model = MODELS.find((m) => m.id === job.modelId);
  return model ? { model, resolution: job.params.resolution || null } : null;
}

function reuseSettings(card, button) {
  const { job } = card;
  const pick = pickerFor(job);
  if (!pick) {
    flashButton(button, 'model not available');
    return;
  }
  const { model } = pick;
  const p = job.params || {};
  state.modelId = model.id;
  if (pick.resolution && model.resolutions && model.resolutions.includes(pick.resolution)) state.resolution = pick.resolution;
  if (model.aspectRatios && model.aspectRatios.includes(p.aspect)) state.aspect = p.aspect;
  if (model.family === 'gpt') {
    if (GPT_SIZES.some(([value]) => value === p.size)) state.size = p.size;
    if (GPT_BACKGROUNDS.includes(p.background)) state.background = p.background;
    if (GPT_QUALITIES.some(([value]) => value === p.quality)) state.quality = p.quality;
    if (GPT_MODERATIONS.some(([value]) => value === p.moderation)) state.moderation = p.moderation;
  }
  if (model.family === 'gemini') {
    if (GEMINI_PROVIDERS.some(([value]) => value === p.provider)) state.provider = p.provider;
    if (typeof p.webSearch === 'boolean') state.webSearch = p.webSearch;
  }

  els.prompt.value = job.prompt;
  renderModels();
  els.size.value = state.size;
  els.background.value = state.background;
  els.quality.value = state.quality;
  els.moderation.value = state.moderation;
  els.provider.value = state.provider;
  els.webSearch.checked = state.webSearch;
  renderControls();
  savePrefs();
  clearFormError();

  const refCount = job.refs.length || job.refCount || 0;
  setRefsNote(refCount ? `The original used ${refCount} reference image${refCount > 1 ? 's' : ''}. Add ${refCount > 1 ? 'them' : 'it'} again if you want ${refCount > 1 ? 'them' : 'it'}.` : '');
  flashButton(button, 'settings loaded');
  if (window.matchMedia('(max-width: 959px)').matches) els.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- prompt history ---------- */

function loadHistory() {
  try {
    const list = JSON.parse(storageGet('localStorage', STORAGE_HISTORY) || '[]');
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string' && p.trim()).slice(0, HISTORY_LIMIT) : [];
  } catch (_) {
    return [];
  }
}

function rememberPrompt(prompt) {
  const list = [prompt, ...loadHistory().filter((p) => p !== prompt)].slice(0, HISTORY_LIMIT);
  storageSet('localStorage', STORAGE_HISTORY, JSON.stringify(list));
  if (!els.historyPanel.hidden) renderHistory();
}

function renderHistory() {
  const list = loadHistory();
  els.historyClear.hidden = !list.length;
  if (!list.length) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = 'No prompts yet. Each prompt you generate with is saved here.';
    els.historyList.replaceChildren(empty);
    return;
  }
  els.historyList.replaceChildren(
    ...list.map((prompt) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';
      button.title = prompt;
      button.textContent = prompt;
      button.addEventListener('click', () => {
        els.prompt.value = prompt;
        clearFormError();
        setHistoryOpen(false);
        // focusing on a phone pops the keyboard over the page, so only do it with a mouse
        if (window.matchMedia('(pointer: fine)').matches) els.prompt.focus();
      });
      item.append(button);
      return item;
    }),
  );
}

function setHistoryOpen(open) {
  if (open) renderHistory();
  els.historyPanel.hidden = !open;
  els.historyToggle.setAttribute('aria-expanded', String(open));
  els.historyToggle.textContent = open ? 'close history' : 'history';
}

function initHistory() {
  els.historyToggle.addEventListener('click', () => setHistoryOpen(els.historyPanel.hidden));
  els.historyClear.addEventListener('click', () => {
    if (!window.confirm('Clear your prompt history on this device?')) return;
    storageRemove('localStorage', STORAGE_HISTORY);
    renderHistory();
  });
  els.historyPanel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setHistoryOpen(false);
      els.historyToggle.focus();
    }
  });
}

/* ---------- generate ---------- */

function clearFormError() {
  els.formError.textContent = '';
}

function validate() {
  if (!state.apiKey) {
    setKeyPanelOpen(true);
    return 'Add your AI/ML API key first.';
  }
  if (!els.prompt.value.trim()) {
    els.prompt.focus();
    return 'Write a prompt first.';
  }
  const problems = refProblems();
  if (problems.length) return problems.join(' ');
  return '';
}

function initGenerate() {
  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const problem = validate();
    els.formError.textContent = problem;
    if (problem) return;
    const job = snapshotJob();
    rememberPrompt(job.prompt);
    for (let i = 0; i < state.count; i++) runCard(createCard(job));
    if (window.matchMedia('(max-width: 959px)').matches) {
      els.gallery.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  els.prompt.addEventListener('input', clearFormError);
  els.prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (typeof els.form.requestSubmit === 'function') els.form.requestSubmit();
      else els.generate.click();
    }
  });

  els.clearGallery.addEventListener('click', () => {
    const pending = upscaleQueue.waiting.length > 0 || Array.from(cards.values()).some((card) => card.controller);
    const message = pending
      ? 'Clear all results? Images still generating will be cancelled, and saved images are deleted from this device.'
      : 'Clear all results? They are deleted from this device too, so download anything you want to keep first.';
    if (!window.confirm(message)) return;
    for (const card of Array.from(cards.values())) removeCard(card);
    saved.full = false;
    dbRun('readwrite', (store) => store.clear()).catch(() => {});
    saved.bytes.clear();
    renderSavedLine();
  });
}

loadPrefs();
initTheme();
initKey();
initUpscaler();
initUpscaleOwn();
initBatch();
initControls();
initRefs();
initViewer();
initHistory();
initGenerate();
updateGalleryChrome();
restoreSaved();
