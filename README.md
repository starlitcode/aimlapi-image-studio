# AI/ML API image generator

Private image generator page for [AI/ML API](https://aimlapi.com), with bigjpg upscaling. Plain HTML, CSS and JavaScript, no build step.

## Hosting

- Cloudflare Pages deploys `main` automatically (no build command, root folder).
- Cloudflare Access puts an email-code login in front of the site; the policy allows one email.
- After editing `app.js` or `styles.css`, re-stamp their `?v=` in `index.html` with the first 10 characters of each file's SHA-256.

## Models

| Picker | Model ID | Endpoint |
| --- | --- | --- |
| Nano Banana 2 | `google/gemini-3.1-flash-image` | `POST /v1/images/generations` |
| GPT Image 2.5 Sunburst | `openai/gpt-image-2.5-sunburst` | `/v1/images/generations`, or `/v1/images/edits` with references |
| GPT Image 2.5 Flare | `openai/gpt-image-2.5-flare` | `/v1/images/generations`, or `/v1/images/edits` with references |

- Nano Banana 2 gets `aspect_ratio` (including `auto`), `resolution`, `provider` (`google` or `fal`; left out for auto, which falls back from Google to fal.ai) and `enable_web_search` as JSON. References go in `image_urls` as base64 data URIs, up to 14. It answers with a link on `cdn.aimlapi.com`, which allows cross-origin reads, and the page converts the image to PNG.
- AI/ML API's schema lists 1K, 2K and 4K for Nano Banana 2. 512 is offered too, untested; if AI/ML API rejects it, the card shows their validation error.
- GPT gets `size` (auto, 1024x1024, 1536x1024, 1024x1536; AI/ML API's default is 1024x1024, so `auto` is sent explicitly), `quality`, `background`, `output_format: png` and `response_format: b64_json`. `moderation: low` is sent only without references, because the edit endpoint has no such field. With references the fields go to the edit endpoint as multipart form data, the images as `image[]` files, up to 16.
- Errors come back as `{ status, message, requestId, error: { name, message, data: { kind } } }`. A used-up balance is a 403 with kind `err_insufficent_credits`. The "details for a bug report" box on a failed card includes the request ID support asks for. Status codes are listed at [4xx](https://docs.aimlapi.com/errors-and-messages/errors-with-status-code-4xx) and [5xx](https://docs.aimlapi.com/errors-and-messages/errors-with-status-code-5xx).

## bigjpg upscaling

bigjpg's API sends no CORS headers, so `worker/bigjpg-proxy.js` runs as a Cloudflare Worker in between.

- Worker secrets: `BIGJPG_KEY` (the key alone, without `X-API-KEY:`) and `PROXY_PASSWORD`.
- Worker variable: `ALLOWED_ORIGIN`, the site's address with no trailing slash. Changing the Worker means pasting the file into Cloudflare's editor and deploying.
- The page's key panel holds the Worker address and password (in the browser only). Saving checks them without using an API call.
- Each upscale uses one bigjpg API call; progress checks don't. Upscales run two at a time, and a progress check has to fail six times in a row before an upscale fails.
- Results come back as JPEG and get re-encoded to PNG, unless they're too large for the browser, in which case the JPEG is kept.
- Paid bigjpg accounts accept uploads up to 50 MB.

## Storage

- The AI/ML API key and the Worker details stay in the browser: `sessionStorage` by default, `localStorage` with "remember on this device".
- Finished images are kept in IndexedDB in the browser. Each site address has its own storage.
