'use strict';

const API_URL = 'https://api.airforce/v1/images/generations';

// Long renders (4K, high quality) can take minutes. Past this the request is dropped.
const REQUEST_TIMEOUT_MS = 6 * 60 * 1000;
const MAX_REF_BYTES = 7 * 1024 * 1024;

const STORAGE_KEY = 'airforce-image-studio:key';
const STORAGE_THEME = 'airforce-image-studio:theme';
const STORAGE_PREFS = 'airforce-image-studio:prefs';

const BASIC_REF_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const MODELS = [
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash Image',
    note: 'Google. Up to 14 reference images, resolution up to 4K.',
    family: 'gemini',
    aspectRatios: ['1:1', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9', '21:9', '9:21', '1:4', '4:1', '1:8', '8:1'],
    resolutions: ['512', '1K', '2K', '4K'],
    defaultResolution: '1K',
    maxRefs: 14,
    refTypes: [...BASIC_REF_TYPES, 'image/heic', 'image/heif'],
  },
  {
    id: 'gpt-image-2.5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    note: 'OpenAI base model, tuned for quality.',
    family: 'gpt',
    maxRefs: 16,
    refTypes: BASIC_REF_TYPES,
  },
  {
    id: 'gpt-image-2.5-flare',
    name: 'GPT Image 2.5 Flare',
    note: 'OpenAI small model, tuned for speed.',
    family: 'gpt',
    maxRefs: 16,
    refTypes: BASIC_REF_TYPES,
  },
  {
    id: 'mj_imagine',
    name: 'Midjourney',
    note: 'Stylised looks. Upscale and vary results afterwards.',
    family: 'mj',
    aspectRatios: ['1:1', '16:9', '9:16'],
    maxRefs: 4,
    refTypes: BASIC_REF_TYPES,
  },
];

const GPT_SIZES = [
  ['auto', 'auto'],
  ['1024x1024', '1024 × 1024 square'],
  ['1536x1024', '1536 × 1024 landscape'],
  ['1024x1536', '1024 × 1536 portrait'],
  ['2048x2048', '2048 × 2048 square, 2K'],
  ['2048x1152', '2048 × 1152 landscape, 2K'],
  ['1152x2048', '1152 × 2048 portrait, 2K'],
  ['3840x2160', '3840 × 2160 landscape, 4K'],
  ['2160x3840', '2160 × 3840 portrait, 4K'],
];
const GPT_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
const GPT_BACKGROUNDS = ['auto', 'opaque', 'transparent'];
const COUNTS = [1, 2, 3, 4];

// The api.airforce docs list these models but not their exact contract, so each
// action sends the finished image as the reference along with the original prompt.
const MJ_ACTIONS = [
  { model: 'mj_upscale', label: 'upscale' },
  { model: 'mj_low_variation', label: 'vary subtle' },
  { model: 'mj_high_variation', label: 'vary strong' },
  { model: 'mj_reroll', label: 'reroll' },
  { model: 'mj_zoom', label: 'zoom out' },
];

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
  aspectGrid: $('#aspect-grid'),
  resGroup: $('#res-group'),
  size: $('#size'),
  quality: $('#quality'),
  background: $('#background'),
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
  quality: 'auto',
  background: 'auto',
  count: 1,
  refs: [],
};

let nextId = 1;
const cards = new Map();

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
      setKeyStatus('That key has spaces in it. Copy it again from your api.airforce dashboard.', true);
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
    if (!key.startsWith('sk-air-')) message += ' Heads up: api.airforce keys usually start with sk-air-.';
    setKeyStatus(message, false);
    clearFormError();
  });

  els.keyForget.addEventListener('click', () => {
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
  const { modelId, aspect, resolution, size, quality, background, count } = state;
  storageSet('localStorage', STORAGE_PREFS, JSON.stringify({ modelId, aspect, resolution, size, quality, background, count }));
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
  if (GPT_QUALITIES.includes(prefs.quality)) state.quality = prefs.quality;
  if (GPT_BACKGROUNDS.includes(prefs.background)) state.background = prefs.background;
  if (COUNTS.includes(prefs.count)) state.count = prefs.count;
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
        name,
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

function renderAspects(model) {
  if (!model.aspectRatios.includes(state.aspect)) state.aspect = '1:1';
  const box = 26;
  els.aspectGrid.replaceChildren(
    ...model.aspectRatios.map((ratio) => {
      const { w, h } = ratioParts(ratio);
      const label = document.createElement('label');
      label.className = 'aspect-option';
      const shapeWrap = document.createElement('span');
      shapeWrap.className = 'aspect-shape';
      const shape = document.createElement('span');
      const r = w / h;
      shape.style.setProperty('--w', `${r >= 1 ? box : Math.max(4, box * r)}px`);
      shape.style.setProperty('--h', `${r >= 1 ? Math.max(4, box / r) : box}px`);
      shapeWrap.append(shape);
      const text = document.createElement('span');
      text.textContent = ratio;
      label.append(
        makeRadio('aspect', ratio, ratio === state.aspect, (value) => {
          state.aspect = value;
          savePrefs();
        }),
        shapeWrap,
        text,
      );
      return label;
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
  showControl('quality', isGpt);
  showControl('background', isGpt);

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
  els.refsHint.textContent = `PNG, JPEG, WebP${heic ? ', HEIC' : ''}. Up to ${model.maxRefs}, 7 MB each.`;
  renderRefs();
}

function initControls() {
  renderModels();
  fillSelect(els.size, GPT_SIZES, state.size);
  fillSelect(els.quality, GPT_QUALITIES.map((q) => [q, q]), state.quality);
  fillSelect(els.background, GPT_BACKGROUNDS.map((b) => [b, b]), state.background);
  renderSegmented(els.countGroup, 'count', COUNTS, state.count, (value) => {
    state.count = value;
    savePrefs();
  });

  els.size.addEventListener('change', () => {
    state.size = els.size.value;
    savePrefs();
  });
  els.quality.addEventListener('change', () => {
    state.quality = els.quality.value;
    savePrefs();
  });
  els.background.addEventListener('change', () => {
    state.background = els.background.value;
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

function refProblems(model = currentModel()) {
  const problems = [];
  if (state.refs.length > model.maxRefs) {
    problems.push(`${model.name} takes up to ${model.maxRefs} reference images. Remove ${state.refs.length - model.maxRefs}.`);
  }
  const unsupported = state.refs.filter((ref) => !model.refTypes.includes(ref.type));
  if (unsupported.length) {
    problems.push(`${model.name} can't use HEIC references. Remove ${unsupported.map((r) => r.name).join(', ')}.`);
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
  if (blob.size > MAX_REF_BYTES) {
    return `${name} is over 7 MB.`;
  }
  let base64;
  try {
    base64 = await readAsBase64(blob);
  } catch (_) {
    return `${name} couldn't be read.`;
  }
  state.refs.push({ id: nextId++, name, type, base64, previewUrl: URL.createObjectURL(blob) });
  return null;
}

async function addRefFiles(fileList) {
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
      remove.addEventListener('click', () => removeRef(ref.id));
      item.append(img, badge, remove);
      return item;
    }),
  );
  setRefsError(refProblems(model));
}

function initRefs() {
  els.refInput.addEventListener('change', async () => {
    const files = els.refInput.files;
    if (files && files.length) await addRefFiles(files);
    els.refInput.value = '';
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
  constructor(status, type, message, cfRay) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.type = type || '';
    this.serverMessage = message || '';
    this.cfRay = cfRay || '';
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
    params.quality = state.quality;
    params.background = state.background;
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

function buildBody(job) {
  const body = {
    model: job.modelId,
    prompt: job.prompt,
    n: 1,
    // base64 comes back in the response itself, so the image can be re-encoded
    // to PNG here without depending on the file host allowing cross-origin reads
    response_format: 'b64_json',
    sse: true,
  };
  const p = job.params;
  if (p.aspect) body.aspect_ratio = p.aspect;
  if (p.resolution) body.resolution = p.resolution;
  if (p.size && p.size !== 'auto') body.size = p.size;
  if (p.quality && p.quality !== 'auto') body.quality = p.quality;
  if (p.background && p.background !== 'auto') body.background = p.background;
  if (job.family === 'gpt') body.output_format = 'png';
  if (job.refs.length) body.input_images = job.refs.map((ref) => ({ b64_json: ref.base64 }));
  return body;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

// With sse: true the body is "data: {json}\n\ndata: [DONE]". Plain JSON is handled too.
function parsePayload(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return safeJson(trimmed);
  let found = null;
  for (const block of trimmed.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data || data === '[DONE]') continue;
    const parsed = safeJson(data);
    if (parsed && (parsed.data || parsed.error || !found)) found = parsed;
  }
  return found;
}

function errorFromPayload(status, payload, cfRay) {
  const err = payload && payload.error;
  if (!err) return new ApiError(status, '', '', cfRay);
  if (typeof err === 'string') return new ApiError(status, '', err, cfRay);
  const code = Number(err.code);
  return new ApiError(status >= 400 ? status : code || status, err.type, err.message, cfRay);
}

async function requestImage(job, signal) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildBody(job)),
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  });
  const text = await response.text();
  const payload = parsePayload(text);
  if (!response.ok || (payload && payload.error)) {
    // cf-ray helps api.airforce support find the request; it's null when CORS hides the header
    throw errorFromPayload(response.status, payload, response.headers.get('cf-ray'));
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

function cleanServerMessage(message) {
  if (!message) return '';
  const text = redact(String(message)).trim();
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
        return { title: 'No API key', body: 'Add your api.airforce key with the key button at the top.' };
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

  // Wording follows https://api.airforce/docs/troubleshooting/
  if (err instanceof ApiError) {
    const detail = cleanServerMessage(err.serverMessage);
    const withDetail = (text) => (detail ? `${text} API said: ${detail}` : text);
    const s = err.status;
    const type = err.type.toLowerCase();
    const model = job.modelId;
    if (s === 401) {
      return { title: 'Key rejected', body: "api.airforce didn't accept your key. Check it matches the one in Dashboard → API Keys and enter it again.", openKey: true };
    }
    if (s === 402) return { title: 'Out of credits', body: withDetail('Your plan or pay-as-you-go balance is used up. Top up or subscribe from your dashboard.') };
    if (s === 403) return { title: 'No access', body: withDetail(`Your plan or this key's permissions don't allow ${model}.`) };
    if (s === 404 || type === 'unknown_model' || type === 'model_not_found') {
      return { title: 'Model not found', body: withDetail(`${model} wasn't recognised or has been retired. Check the Models page on api.airforce.`) };
    }
    if (s === 413) return { title: 'Request too large', body: 'Shorten the prompt, or use fewer or smaller reference images.' };
    if (s === 429) return { title: 'Rate limited', body: withDetail('Too many requests this minute, or a daily cap was hit. Wait a bit and try again.') };
    if (s === 502) return { title: 'api.airforce is restarting', body: 'They deploy a few times a day. Wait 5 to 10 seconds and try again.' };
    if (s === 503) {
      return { title: 'Model unavailable', body: withDetail(`Every provider behind ${model} failed at once. Try another model, or report it if it lasts more than a few minutes.`) };
    }
    if (s >= 500) {
      return { title: 'Server error', body: withDetail("Something broke on api.airforce's side. Try again, and report it if it keeps happening for more than a minute.") };
    }
    if (s >= 400) return { title: 'Request rejected', body: detail || "The API didn't accept these settings. Try a different size, aspect ratio, or fewer references." };
    return { title: 'Something went wrong', body: detail || `The API returned status ${s}.` };
  }

  if (err instanceof TypeError) {
    return {
      title: "Couldn't reach api.airforce",
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
  if (p.aspect) {
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
  if (p.quality && p.quality !== 'auto') parts.push(`quality ${p.quality}`);
  if (p.background && p.background !== 'auto') parts.push(`${p.background} bg`);
  if (job.refs.length) parts.push(`${job.refs.length} ref${job.refs.length > 1 ? 's' : ''}`);
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
  node.classList.toggle('is-mj', job.family === 'mj' || job.family === 'mj-action');

  card.q('.card-cancel').addEventListener('click', () => card.controller && card.controller.abort());
  card.q('.card-retry').addEventListener('click', () => runCard(card));
  card.q('.card-dismiss').addEventListener('click', () => removeCard(card));
  card.q('.card-remove').addEventListener('click', () => removeCard(card));
  card.q('.card-open').addEventListener('click', () => openViewer(card));
  card.q('.card-copy').addEventListener('click', () => copyPrompt(card));
  card.q('.card-report-copy').addEventListener('click', () => copyReport(card));
  card.q('.card-ref').addEventListener('click', () => useAsReference(card));

  card.q('.card-mj-buttons').replaceChildren(
    ...MJ_ACTIONS.map((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost-btn';
      button.textContent = action.label;
      button.addEventListener('click', () => runMjAction(card, action));
      return button;
    }),
  );

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

async function runCard(card) {
  const { job } = card;
  stopCardTimers(card);
  setCardState(card, 'pending');
  card.node.style.setProperty('--ar', String(guessRatio(job)));

  const started = Date.now();
  const elapsed = card.q('.elapsed');
  elapsed.textContent = '0s';
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
    const answer = await requestImage(job, controller.signal);
    const bytes = answer.base64 ? base64ToBytes(answer.base64) : await fetchImageBytes(answer.url, controller.signal);
    const png = await toPng(bytes);
    if (!cards.has(card.id)) return;
    showResult(card, png, Date.now() - started);
  } catch (err) {
    if (!cards.has(card.id)) return;
    const info = describeError(err, job, timedOut);
    const reportable = !timedOut && (err instanceof ApiError || err instanceof TypeError);
    showFailure(card, info, reportable ? errorReport(err, job, new Date()) : '');
  } finally {
    stopCardTimers(card);
    card.controller = null;
  }
}

function showResult(card, png, tookMs) {
  if (card.objectUrl) URL.revokeObjectURL(card.objectUrl);
  card.result = png;
  card.objectUrl = URL.createObjectURL(png.blob);

  const img = card.q('.card-open img');
  img.src = card.objectUrl;
  img.alt = card.job.prompt;
  card.node.style.setProperty('--ar', String(png.width / png.height));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const download = card.q('.card-download');
  download.href = card.objectUrl;
  download.download = `${card.job.modelId}-${stamp}.png`;

  const converted = png.format === 'png' ? '' : ` · converted from ${png.format}`;
  card.q('.card-info').textContent = `${describeParams(card.job)} · ${png.width}×${png.height} png${converted} · ${formatElapsed(tookMs)}`;
  setCardState(card, 'done');
}

// The checklist api.airforce asks for in a support ticket. It never includes the key or the prompt.
function errorReport(err, job, when) {
  const lines = [
    `time: ${when.toISOString().slice(0, 19)}Z`,
    'endpoint: POST /v1/images/generations',
    `model: ${job.modelId}`,
    `settings: ${describeParams(job).split(' · ').slice(1).join(' · ') || 'defaults'}`,
  ];
  if (err instanceof ApiError) {
    lines.push(`status: ${err.status}`);
    if (err.type) lines.push(`type: ${err.type}`);
    const message = cleanServerMessage(err.serverMessage);
    if (message) lines.push(`message: ${message}`);
    if (err.cfRay) lines.push(`cf-ray: ${err.cfRay}`);
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

function removeCard(card) {
  if (card.controller) card.controller.abort();
  stopCardTimers(card);
  if (card.objectUrl) URL.revokeObjectURL(card.objectUrl);
  card.node.remove();
  cards.delete(card.id);
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

async function runMjAction(card, action) {
  if (!card.result) return;
  const base64 = await readAsBase64(card.result.blob);
  const job = {
    modelId: action.model,
    modelName: action.label,
    family: 'mj-action',
    prompt: card.job.prompt,
    params: {},
    refs: [{ base64, type: 'image/png' }],
  };
  runCard(createCard(job));
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

/* ---------- generate ---------- */

function clearFormError() {
  els.formError.textContent = '';
}

function validate() {
  if (!state.apiKey) {
    setKeyPanelOpen(true);
    return 'Add your api.airforce key first.';
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
    const message = pending ? 'Clear all results? Images still generating will be cancelled.' : 'Clear all results? Download anything you want to keep first.';
    if (!window.confirm(message)) return;
    for (const card of Array.from(cards.values())) removeCard(card);
  });
}

loadPrefs();
initTheme();
initKey();
initControls();
initRefs();
initViewer();
initGenerate();
updateGalleryChrome();
