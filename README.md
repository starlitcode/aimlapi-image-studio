# api.airforce image generator

A small web page for generating images through [api.airforce](https://api.airforce/docs/api/media/). It's plain HTML, CSS and JavaScript with no build step and no dependencies. It works on phones and laptops, and it opens in dark mode with a light mode toggle.

## Models

| Model ID | Settings |
| --- | --- |
| `gemini-3.1-flash-image-preview` (1K), `-2k`, `-4k` | 15 aspect ratios; the resolution buttons pick the model, since api.airforce has a separate model per resolution, up to 14 reference images, 7 MB each (PNG, JPEG, WebP, HEIC, HEIF) |
| `gpt-image-2.5-sunburst` | preset or custom size, quality (auto to max), background (auto, opaque, transparent), up to 16 reference images, 20 MB each (PNG, JPEG, WebP) |
| `gpt-image-2.5-flare` | same as Sunburst |
| `mj_imagine` | 14 preset ratios or any custom whole-number ratio from 1:99 to 99:1, up to 4 reference images, 7 MB each (PNG, JPEG, WebP) |

Custom GPT sizes are checked against OpenAI's rules as you type: both sides must be multiples of 16, neither side can be over 3840, the shape has to stay between 1:3 and 3:1, and the total has to be 655,360 to 8,294,400 pixels. Anything above 2560 × 1440 is flagged as experimental. Midjourney ratios wider than 2:1 or taller than 1:2 get a warning that results can be unpredictable, but you can still use them.

Midjourney [parameters](https://docs.midjourney.com/hc/en-us/articles/32859204029709-Parameter-List) like `--ar 16:9`, `--v 7` or `--no boats` turn pink in the prompt box and on result cards, a stronger pink for the name and a softer one for the value. A parameter only counts when there's a space before the `--`, which is Midjourney's own rule. Phones often turn `--` into a long dash (—) as you type, so that gets colored too and is changed back to `--` before a Midjourney request goes out.

Midjourney results also get upscale, vary subtle, vary strong, reroll and zoom out buttons (`mj_upscale`, `mj_low_variation`, `mj_high_variation`, `mj_reroll`, `mj_zoom`). The api.airforce docs don't say what these models expect as input, so each button sends the finished image as a reference along with the original prompt. They're marked experimental in the UI.

## Output is always PNG

Every result is a PNG. When a provider sends back JPEG or WebP, the page decodes it and re-encodes it as PNG in your browser before showing it or offering the download. A PNG from the provider is kept byte for byte. The card says when an image was converted.

## Using it

1. Open the page. GitHub Pages works: Settings → Pages → deploy from the `main` branch, root folder.
2. Paste your `sk-air-...` key into the key panel and save it.
3. Pick a model, write a prompt, generate.

Results only exist in the open tab, so download the ones you want to keep.

## Your API key

- The key is stored only in your browser. By default it goes in `sessionStorage` and is cleared when you close the tab. If you tick "remember on this device" it goes in `localStorage` instead. "forget key" clears both.
- The key is sent only in the `Authorization` header of requests to `https://api.airforce`. It never goes in a URL, and it's never logged or written into the page. If an error message from the API happens to contain the key, it gets removed before the message is shown.
- The page's Content Security Policy only lets scripts and styles load from this site, which blocks third-party and inline scripts. Network requests can only go to https hosts. No analytics, fonts or CDNs are loaded.
- The key never touches this repository. Anyone else who uses the page has to bring their own key.

Don't tick "remember" on a shared computer.

## Notes

- Requests use `sse: true` so long renders don't get cut off by proxy timeouts. If nothing comes back after 6 minutes, the request is dropped. You can also cancel a pending image yourself with its cancel button. Removing a finished image with ✕ gives you 8 seconds to undo before it's gone.
- Each model shows its live status from api.airforce's public model list (up, slow, partial outage, major outage or down). The page checks when it opens, every 5 minutes while the tab is open, after a failed image, and when you press refresh. It warns you before you use a model that's listed as down. The list doesn't need a key, so the key isn't sent with it.
- When the model's provider fails (a 502 or 503, or a failure reported inside an otherwise successful response), the page tries again on its own: after 3 seconds, then after 8. The card says when it's retrying, and other errors are never retried.
- Error messages follow api.airforce's [troubleshooting guide](https://api.airforce/docs/troubleshooting/). Each one says what failed and what to try next. API and network errors also have a "details for a bug report" box with the fields their support asks for: time in UTC, endpoint, model, status, error body and the request's trace id. Your key and your prompt are never included.
- The page calls api.airforce directly from your browser. api.airforce allows this (its CORS headers accept requests from the GitHub Pages address), so no proxy is needed.
