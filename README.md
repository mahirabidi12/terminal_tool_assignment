# AI Agent CLI Tool — Website Cloner

A conversational CLI agent that clones any website by visiting it live with a real browser, taking screenshots, and using an AI vision model to replicate the design as a standalone HTML file.

## How It Works

### The Agent Loop

The agent follows a strict reasoning loop inspired by ReAct-style agents:

```
START → THINK → TOOL → OBSERVE → THINK → ... → OUTPUT
```

Every response from the model is a single JSON step. The agent cannot skip ahead — it must wait for an `OBSERVE` before continuing. This forces it to reason one step at a time.

```json
{ "step": "THINK", "content": "I need to visit the website first to see what it looks like" }
{ "step": "TOOL",  "tool_name": "visitAndCapture", "tool_args": { "url": "https://scaler.com", "outputDir": "scaler-clone" } }
{ "step": "OBSERVE", "content": "{ screenshot taken, 12 assets downloaded ... }" }
{ "step": "TOOL",  "tool_name": "writeFile", "tool_args": { "path": "scaler-clone/index.html", "content": "..." } }
{ "step": "OUTPUT", "content": "Done! Opened in browser." }
```

### Step 1 — Visit the Live Website (Playwright)

When you ask the agent to clone a website, it calls `visitAndCapture()`. This launches a real headless Chromium browser (via Playwright), visits the URL, and collects:

- **3 screenshots** — full viewport, header crop, hero section crop
- **Computed CSS styles** — exact `backgroundColor`, `fontFamily`, `fontSize`, `fontWeight`, `background`, etc. for key elements (header, h1, hero section, buttons, footer)
- **CSS variables** — all `--var` values from `:root`
- **Page content** — headings (with innerHTML), nav links, buttons (with styles), paragraphs, hero text, ticker items, footer text
- **Downloaded assets** — all images saved locally to `outputDir/assets/images/`

### Step 2 — Vision Model Sees the Screenshots

All 3 screenshots are sent directly to **OpenAI o3** as images alongside the structured page data. The model literally sees the page and can identify:

- Exact colors, gradients, and background patterns
- Multi-line headline structure and gradient text effects
- Highlight boxes behind words
- Button styles, spacing, typography

### Step 3 — Write the Clone

The model writes a single `index.html` file with all CSS in a `<style>` tag and all JavaScript in a `<script>` tag. It references downloaded local assets where available, and falls back to CDN URLs for anything that failed to download.

The file is then opened automatically in the browser.

---

## Project Structure

```
terminal_tool_assignment/
├── index.js          # Main agent — CLI loop, system prompt, step dispatcher
├── tools.js          # Tool implementations (Playwright, file system)
├── .env              # OPENAI_API_KEY (not committed)
├── .env.example      # Template
└── package.json
```

### `index.js`

- Reads user input via `readline`
- Maintains a conversation `history` array across turns
- Calls OpenAI with `response_format: { type: "json_object" }` to enforce structured output
- Dispatches each step: logs THINK, calls tools on TOOL, attaches screenshots as vision messages on `visitAndCapture`, breaks on OUTPUT

### `tools.js`

Five tools available to the agent:

| Tool | What it does |
|------|-------------|
| `visitAndCapture({ url, outputDir })` | Playwright: visit URL, take 3 screenshots, extract styles + content, download images |
| `writeFile({ path, content })` | Write any file, auto-creates parent directories |
| `createFolder({ path })` | Create a directory |
| `downloadAsset({ url, savePath })` | Download a single file from a URL |
| `executeCommand({ cmd })` | Run a shell command (used to `open index.html` in the browser) |

---

## Setup

```bash
# Install dependencies
npm install

# Install Playwright's Chromium browser
npx playwright install chromium

# Add your OpenAI API key
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```

## Usage

```bash
node index.js
```

```
You: Clone the Scaler website
You: Clone the Netflix landing page
You: Build a portfolio website
```

The agent works for any website — not just Scaler. It visits the live site, sees what it looks like, and replicates it.

## Model

Uses **OpenAI o3** — the most capable OpenAI model with vision support. It receives the screenshots as images and uses them to make pixel-accurate design decisions.
