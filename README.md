# api.airforce image generator

Private image generator page for api.airforce, with bigjpg upscaling. Plain HTML, CSS and JavaScript, no build step.

## Hosting

- Cloudflare Pages deploys `main` automatically (no build command, root folder).
- Cloudflare Access puts an email-code login in front of the site; the policy allows one email.
- After editing `app.js` or `styles.css`, re-stamp their `?v=` in `index.html` with the first 10 characters of each file's SHA-256.

## api.airforce quirks found by testing

- Gemini ignores `aspect_ratio` and returns a square. The page sends the shape as `size` (width x height, about one megapixel); the model decides the resolution.
- A `resolution` field gets Gemini requests rejected, so each resolution is its own model: 1K `nano-banana-2`, 2K `gemini-3.1-flash-image-preview-2k`, 4K `gemini-3.1-flash-image-preview-4k`. `nano-banana-2` always renders 1K whatever size is sent; it stands in for `gemini-3.1-flash-image-preview`, which failed every request (as did the non-preview `gemini-3.1-flash-image`, same backend).
- Gemini always returns JPEG; the page re-encodes results to PNG.
- GPT quality is dropped or turned into "standard" (see the `X-Airforce-Adapted` response header), and "high" can make the request fail, so the page sends no quality.
- After a few failures in a row, a model can answer "Model not found" for a while even though the status list says it's up. The page then shows it as down for 10 minutes.
- Prices on the generate button are api.airforce's list prices; some models also list a lower "from" price.

## bigjpg upscaling

bigjpg's API sends no CORS headers, so `worker/bigjpg-proxy.js` runs as a Cloudflare Worker in between.

- Worker secrets: `BIGJPG_KEY` (the key alone, without `X-API-KEY:`) and `PROXY_PASSWORD`.
- `ALLOWED_ORIGIN` at the top of the Worker must match the site's address. Changing the Worker means pasting the file into Cloudflare's editor and deploying.
- The page's key panel holds the Worker address and password (in the browser only). Saving checks them without using an API call.
- Each upscale uses one bigjpg API call; progress checks don't. Upscales run two at a time, and a progress check has to fail six times in a row before an upscale fails.
- Results come back as JPEG and get re-encoded to PNG, unless they're too large for the browser, in which case the JPEG is kept.
- Paid bigjpg accounts accept uploads up to 50 MB.

## Storage

- The api.airforce key and the Worker details stay in the browser: `sessionStorage` by default, `localStorage` with "remember on this device".
- Finished images are kept in IndexedDB in the browser. Each site address has its own storage.
