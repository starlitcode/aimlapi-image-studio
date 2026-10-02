// Cloudflare Worker that lets the image studio use bigjpg's upscaler.
// bigjpg's API sends no CORS headers, so a browser page can't call it directly.
// This Worker calls it instead and keeps the bigjpg key out of the browser.
//
// Secrets (Worker settings > Variables and Secrets, type "Secret"):
//   BIGJPG_KEY      the X-API-KEY from bigjpg's API page
//   PROXY_PASSWORD  any password; the page sends it as X-Proxy-Password
//
// Routes:
//   POST /upload        body: the image bytes, Content-Type: image/png or image/jpeg
//                       uploads it to bigjpg and answers { fileurl }
//   POST /task          body: { style, noise, x2, input } as bigjpg's enlarge API
//   GET  /task/<ids>    bigjpg's result query, ids comma separated
//   GET  /image?url=... fetches a finished image so the page can read it

const BIGJPG = 'https://bigjpg.com';
const ALLOWED_ORIGIN = 'https://api-airforce-image-generator.pages.dev';
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Password',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

async function passwordMatches(given, expected) {
  if (!given || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(given)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// bigjpg answers JSON, but an error page from its firewall would not be
async function readBigjpg(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    return { status: 'not_json', http_status: response.status, body: text.slice(0, 500) };
  }
}

// The upload answer's field names aren't in bigjpg's public docs, so try the likely ones
function pick(data, names) {
  for (const name of names) {
    if (typeof data[name] === 'string' && data[name]) return data[name];
  }
  return '';
}

async function upload(request, env, origin) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!EXTENSIONS[type]) return json({ error: 'Send a PNG, JPEG or WebP image.' }, 415, origin);

  const ticket = await readBigjpg(
    await fetch(`${BIGJPG}/api/img_upload`, {
      method: 'POST',
      headers: { 'X-API-KEY': env.BIGJPG_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ filename: `image.${EXTENSIONS[type]}`, filetype: type }),
    }),
  );
  const uploadUrl = pick(ticket, ['upload_url', 'uploadUrl', 'put_url', 'signed_url', 'url']);
  const fileUrl = pick(ticket, ['fileurl', 'file_url', 'fileUrl', 'public_url', 'image_url']);
  if (!uploadUrl || !fileUrl) return json({ error: 'Unexpected answer from bigjpg upload.', bigjpg: ticket }, 502, origin);

  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': type }, body: request.body });
  if (!put.ok) return json({ error: `Upload to storage failed (${put.status}).` }, 502, origin);
  return json({ fileurl: fileUrl }, 200, origin);
}

async function forward(url, init, env, origin) {
  const response = await fetch(url, { ...init, headers: { ...init.headers, 'X-API-KEY': env.BIGJPG_KEY } });
  return json(await readBigjpg(response), response.ok ? 200 : 502, origin);
}

async function image(url, origin) {
  const target = new URL(url).searchParams.get('url') || '';
  if (!/^https:\/\//.test(target)) return json({ error: 'Give an https image url.' }, 400, origin);
  const response = await fetch(target);
  if (!response.ok) return json({ error: `Image download failed (${response.status}).` }, 502, origin);
  return new Response(response.body, {
    headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream', ...cors(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (!env.BIGJPG_KEY || !env.PROXY_PASSWORD) return json({ error: 'The Worker is missing its secrets.' }, 500, origin);
    if (!(await passwordMatches(request.headers.get('X-Proxy-Password'), env.PROXY_PASSWORD))) {
      return json({ error: 'Wrong password.' }, 401, origin);
    }

    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/upload') return await upload(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/task') {
        // sent the way bigjpg's own curl example sends it: JSON text with curl's default type
        const init = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: await request.text() };
        return await forward(`${BIGJPG}/api/task/`, init, env, origin);
      }
      const ids = url.pathname.match(/^\/task\/([\w,-]+)$/);
      if (request.method === 'GET' && ids) return await forward(`${BIGJPG}/api/task/${ids[1]}`, { headers: {} }, env, origin);
      if (request.method === 'GET' && url.pathname === '/image') return await image(request.url, origin);
    } catch (err) {
      return json({ error: `Worker error: ${err.message}` }, 502, origin);
    }
    return json({ error: 'Not found.' }, 404, origin);
  },
};
