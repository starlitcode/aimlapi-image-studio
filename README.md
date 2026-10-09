# AI/ML API Image Studio

An image generator page for [AI/ML API](https://aimlapi.com) with Nano Banana 2 and GPT Image 2.5. Plain HTML, CSS and JavaScript, no build step and no server: the page calls AI/ML API straight from the browser with your own key.

## Running it

Serve the folder with any static file server and open it in a browser, for example:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000, click the key button at the top and paste your [AI/ML API key](https://aimlapi.com/app/keys). Any static host works the same way, such as GitHub Pages.

After editing `app.js` or `styles.css`, re-stamp their `?v=` in `index.html` with the first 10 characters of each file's SHA-256, so browsers holding an old copy pick up the new one:

```sh
sha256sum app.js styles.css | cut -c1-10
```

## Models

| Picker | Model ID | Endpoint |
| --- | --- | --- |
| Nano Banana 2 | `google/gemini-3.1-flash-image` | `POST /v1/images/generations` |
| GPT Image 2.5 Sunburst | `openai/gpt-image-2.5-sunburst` | `/v1/images/generations`, or `/v1/images/edits` with references |
| GPT Image 2.5 Flare | `openai/gpt-image-2.5-flare` | `/v1/images/generations`, or `/v1/images/edits` with references |

- Nano Banana 2 gets `aspect_ratio` (including `auto`), `resolution`, `provider` (`google` or `fal`; left out for auto, which falls back from Google to fal.ai) and `enable_web_search` as JSON. References go in `image_urls` as base64 data URIs, up to 14. It answers with a link on `cdn.aimlapi.com`, which allows cross-origin reads, and the page converts the image to PNG.
- GPT gets `size`, `quality`, `background`, `output_format: png` and `response_format: b64_json`. `moderation: low` is sent only without references, because the edit endpoint has no such field. With references the fields go to the edit endpoint as multipart form data, the images as `image[]` files, up to 16. `size` is always sent because AI/ML API's default is 1024x1024, not auto.

### Options AI/ML API doesn't list

The pickers offer everything OpenAI and Google document for these models. AI/ML API's schema lists less, and none of the extras have been tried against it yet. Picking one shows a note under the control; if AI/ML API rejects it, the failed card shows their validation error.

| Setting | AI/ML API lists | Also offered |
| --- | --- | --- |
| GPT size | auto, 1024x1024, 1536x1024, 1024x1536 | 2K and 4K presets, custom sizes (multiples of 16, edges up to 3840, 1:3 to 3:1) |
| GPT quality | low, medium, high | auto, xhigh, max |
| Nano Banana 2 aspect ratio | auto, 1:1, 4:5, 5:4, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9, 21:9 | 9:21, 1:4, 4:1, 1:8, 8:1 |
| Nano Banana 2 resolution | 1K, 2K, 4K | 512 |

### Errors

- Errors come back as `{ status, message, requestId, error: { name, message, data: { kind } } }`. A used-up balance is a 403 with kind `err_insufficent_credits`. The "details for a bug report" box on a failed card includes the request ID support asks for. Status codes are listed at [4xx](https://docs.aimlapi.com/errors-and-messages/errors-with-status-code-4xx) and [5xx](https://docs.aimlapi.com/errors-and-messages/errors-with-status-code-5xx).

## Storage

- Your AI/ML API key stays in the browser: `sessionStorage` by default, `localStorage` with "remember on this device". It's only ever sent to AI/ML API.
- Finished images are kept in IndexedDB in the browser. Each site address has its own storage.
