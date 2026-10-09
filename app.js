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
    aspectRatios: ['auto', '1:1', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9', '21:9', '9:21', '1:4', '4:1', '1:8', '8:1'],
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

const GPT_SIZES = [
  ['auto', 'auto'],
  ['1024x1024', '1024 × 1024 square'],
  ['1536x1024', '1536 × 1024 landscape'],
  ['1024x1536', '1024 × 1536 portrait'],
  ['2048x2048', '2048 × 2048 square, 2K (experimental)'],
  ['2048x1152', '2048 × 1152 landscape, 2K'],
  ['1152x2048', '1152 × 2048 portrait, 2K'],
  ['3840x2160', '3840 × 2160 landscape, 4K (experimental)'],
  ['2160x3840', '2160 × 3840 portrait, 4K (experimental)'],
  ['custom', 'custom size'],
];

// GPT Image 2.5 size rules from OpenAI's image guide
const GPT_EDGE_STEP = 16;
const GPT_MAX_EDGE = 3840;
const GPT_MAX_RATIO = 3;
const GPT_MIN_PIXELS = 655360;
const GPT_MAX_PIXELS = 8294400;
const GPT_STABLE_PIXELS = 2560 * 1440;

// What AI/ML API's own schema lists. The pickers also offer what OpenAI and Google document
// for these models; AI/ML API may pass those through or reject them, and the page says so.
const AIML_LISTED = {
  size: ['auto', '1024x1024', '1536x1024', '1024x1536'],
  quality: ['low', 'medium', 'high'],
  aspect: ['auto', '21:9', '1:1', '4:3', '3:2', '2:3', '5:4', '4:5', '3:4', '16:9', '9:16'],
  resolution: ['1K', '2K', '4K'],
};

const GPT_BACKGROUNDS = ['auto', 'opaque', 'transparent'];
const GPT_QUALITIES = [['auto', 'auto'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max']];
// Only the no-reference endpoint has a moderation setting
const GPT_MODERATIONS = [['auto', 'auto'], ['low', 'low (less filtering)']];
// Where AI/ML API sends a Nano Banana 2 request; auto falls back from Google to fal.ai
const GEMINI_PROVIDERS = [['auto', 'auto (Google, then fal.ai)'], ['google', 'Google only'], ['fal', 'fal.ai only']];
const COUNTS = [1, 2, 3, 4];

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
  aspectNote: $('#aspect-note'),
  resNote: $('#res-note'),
  sizeCustom: $('#size-custom'),
  sizeW: $('#size-w'),
  sizeH: $('#size-h'),
  sizeNote: $('#size-note'),
  qualityNote: $('#quality-note'),
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
  customSize: { w: 1280, h: 720 },
  refs: [],
};

let nextId = 1;
const cards = new Map();

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
    // the badge now shows the key; a blocked-storage warning stays up so it gets read
    if (stored) setKeyPanelOpen(false);
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

/* ---------- preferences (non-sensitive, per device) ---------- */

function savePrefs() {
  const { modelId, aspect, resolution, size, customSize, background, quality, moderation, provider, webSearch, count } = state;
  storageSet('localStorage', STORAGE_PREFS, JSON.stringify({ modelId, aspect, resolution, size, customSize, background, quality, moderation, provider, webSearch, count }));
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
  const pair = (value) => value && Number.isInteger(value.w) && Number.isInteger(value.h) && value.w > 0 && value.h > 0;
  if (pair(prefs.customSize)) state.customSize = { w: prefs.customSize.w, h: prefs.customSize.h };
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
    renderNotes();
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

function wholeNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const fmt = (n) => n.toLocaleString('en-US');

function checkGptSize(w, h) {
  if (!w || !h) return { error: 'Enter a width and height in pixels.' };
  if (w % GPT_EDGE_STEP || h % GPT_EDGE_STEP) {
    const round = (n) => Math.max(GPT_EDGE_STEP, Math.round(n / GPT_EDGE_STEP) * GPT_EDGE_STEP);
    return { error: `Both sides must be multiples of ${GPT_EDGE_STEP}. Closest: ${round(w)} × ${round(h)}.` };
  }
  if (w > GPT_MAX_EDGE || h > GPT_MAX_EDGE) return { error: `Neither side can be over ${fmt(GPT_MAX_EDGE)} pixels.` };
  if (Math.max(w, h) / Math.min(w, h) > GPT_MAX_RATIO) return { error: `The shape has to stay between 1:${GPT_MAX_RATIO} and ${GPT_MAX_RATIO}:1.` };
  const pixels = w * h;
  if (pixels < GPT_MIN_PIXELS) return { error: `${fmt(pixels)} pixels is too small. The minimum is ${fmt(GPT_MIN_PIXELS)}.` };
  if (pixels > GPT_MAX_PIXELS) return { error: `${fmt(pixels)} pixels is too big. The maximum is ${fmt(GPT_MAX_PIXELS)}.` };
  if (pixels > GPT_STABLE_PIXELS) return { warning: 'Bigger than 2560 × 1440 is experimental, so results may vary.' };
  return {};
}

function showNote(note, result, inputs = []) {
  note.textContent = result.error || result.warning || '';
  note.classList.toggle('is-error', Boolean(result.error));
  note.classList.toggle('is-warn', !result.error && Boolean(result.warning));
  for (const input of inputs) input.setAttribute('aria-invalid', String(Boolean(result.error)));
}

// The size a job will actually send, with "custom" resolved to numbers.
function resolvedSize() {
  return state.size === 'custom' ? `${state.customSize.w}x${state.customSize.h}` : state.size;
}

function sizeCheck() {
  if (currentModel().family !== 'gpt' || state.size === 'auto') return {};
  if (state.size === 'custom') {
    const [w, h] = resolvedSize().split('x').map(wholeNumber);
    const result = checkGptSize(w, h);
    if (result.error) return result;
  }
  return unlisted('size', resolvedSize());
}

function unlisted(kind, value) {
  if (AIML_LISTED[kind].includes(value)) return {};
  return { warning: `AI/ML API doesn't list ${value} for this model, so it may reject it. If it does, the card says why.` };
}

// The notes under the pickers: size rules for a custom GPT size, and a heads-up wherever
// the picked value is one AI/ML API's schema doesn't list.
function renderNotes() {
  const model = currentModel();
  const isCustom = model.family === 'gpt' && state.size === 'custom';
  els.sizeCustom.hidden = !isCustom;
  showNote(els.sizeNote, sizeCheck(), isCustom ? [els.sizeW, els.sizeH] : []);
  showNote(els.qualityNote, model.family === 'gpt' ? unlisted('quality', state.quality) : {});
  showNote(els.aspectNote, model.family === 'gemini' ? unlisted('aspect', state.aspect) : {});
  showNote(els.resNote, model.family === 'gemini' ? unlisted('resolution', state.resolution) : {});
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
      renderNotes();
    });
  }
  renderNotes();

  els.refInput.accept = model.refTypes.join(',');
  els.refsHint.textContent = `PNG, JPEG, WebP. Up to ${model.maxRefs}, ${model.maxRefMB} MB each.`;
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
    renderNotes();
  });
  els.sizeW.value = String(state.customSize.w);
  els.sizeH.value = String(state.customSize.h);
  const onSizeInput = () => {
    state.customSize = { w: wholeNumber(els.sizeW.value) || 0, h: wholeNumber(els.sizeH.value) || 0 };
    savePrefs();
    renderNotes();
    clearFormError();
  };
  els.sizeW.addEventListener('input', onSizeInput);
  els.sizeH.addEventListener('input', onSizeInput);
  els.background.addEventListener('change', () => {
    state.background = els.background.value;
    savePrefs();
  });
  els.quality.addEventListener('change', () => {
    state.quality = els.quality.value;
    savePrefs();
    renderNotes();
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
  return (file.type || '').toLowerCase();
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
      // a file the browser can't preview shows its name instead
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
    params.size = resolvedSize();
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
  const costUsd = costOf(payload);
  if (item && typeof item.b64_json === 'string' && item.b64_json) return { base64: item.b64_json, costUsd };
  if (item && typeof item.url === 'string' && item.url) return { url: item.url, costUsd };
  throw new StudioError('empty');
}

// What the request cost, from meta.usage. GPT reports usd_spent; Nano Banana 2 only reports
// credits_used. Every example in AI/ML API's docs that has both works out to 2,000,000 credits
// per dollar (120000 credits = $0.06), so credits are converted at that rate and marked "~".
const CREDITS_PER_USD = 2000000;

function costOf(payload) {
  const usage = payload && payload.meta && payload.meta.usage;
  if (!usage) return null;
  if (Number.isFinite(usage.usd_spent)) return { usd: usage.usd_spent, estimated: false };
  if (Number.isFinite(usage.credits_used)) return { usd: usage.credits_used / CREDITS_PER_USD, estimated: true };
  return null;
}

function formatCost(cost) {
  if (!cost || !Number.isFinite(cost.usd)) return '';
  if (cost.usd === 0) return '$0';
  // three decimals show a 5-cent image as $0.05 and a 9.5-cent one as $0.095; tiny costs get four
  let amount = cost.usd.toFixed(cost.usd < 0.01 ? 4 : 3);
  if (cost.usd >= 0.01 && amount.endsWith('0')) amount = amount.slice(0, -1);
  return `${cost.estimated ? '~' : ''}$${amount}`;
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
      body: `No answer after ${REQUEST_TIMEOUT_MS / 60000} minutes. The model may be overloaded. Try again or pick another model.`,
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

function describeParams(job) {
  const p = job.params;
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

  card.q('.card-cancel').addEventListener('click', () => {
    if (!card.controller) return;
    if (window.confirm('Stop generating this image?')) card.controller.abort();
  });
  card.q('.card-retry').addEventListener('click', () => runCard(card));
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
  }, REQUEST_TIMEOUT_MS);

  try {
    if (!state.apiKey) throw new StudioError('no-key');
    const answer = await requestWithRetries(card, controller.signal);
    const bytes = answer.base64 ? base64ToBytes(answer.base64) : await fetchImageBytes(answer.url, controller.signal);
    const png = await toPng(bytes);
    if (!cards.has(card.id)) return;
    card.cost = answer.costUsd;
    showResult(card, png, Date.now() - started);
  } catch (err) {
    if (!cards.has(card.id)) return;
    const info = describeError(err, job, timedOut);
    if (err instanceof ApiError && err.attempts > 1) info.body += ` Tried ${err.attempts} times.`;
    const reportable = !timedOut && (err instanceof ApiError || err instanceof TypeError);
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
  const download = card.q('.card-download');
  download.href = card.objectUrl;
  // model IDs carry a provider prefix like "openai/", which can't go in a file name
  download.download = `${card.job.modelId.replace(/\//g, '-')}-${stamp}.png`;

  const converted = png.format !== 'png' ? ` · converted from ${png.format}` : '';
  const cost = formatCost(card.cost);
  card.q('.card-info').textContent = `${describeParams(card.job)} · ${png.width}×${png.height} png${converted} · ${formatElapsed(tookMs)}${cost ? ` · ${cost}` : ''}`;
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
    cost: card.cost || null,
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
      card.cost = record.cost || null;
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
    if (p.size && GPT_SIZES.some(([value]) => value === p.size)) {
      state.size = p.size;
    } else if (p.size) {
      const [w, h] = p.size.split('x').map(wholeNumber);
      if (w && h) {
        state.size = 'custom';
        state.customSize = { w, h };
      }
    }
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
  els.sizeW.value = String(state.customSize.w);
  els.sizeH.value = String(state.customSize.h);
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
  const size = sizeCheck();
  if (size.error) return `Size: ${size.error}`;
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
    const pending = Array.from(cards.values()).some((card) => card.controller);
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
initControls();
initRefs();
initViewer();
initHistory();
initGenerate();
updateGalleryChrome();
restoreSaved();
