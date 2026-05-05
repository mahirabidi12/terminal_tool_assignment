import "dotenv/config";
import { OpenAI } from "openai";
import readline from "readline";
import fs from "fs";
import { tool_map, TOOLS_DESCRIPTION } from "./tools.js";

// o3 — OpenAI's most capable model with vision support
const client = new OpenAI();
const MODEL = "o3";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function prompt(q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are an AI Agent that builds pixel-accurate website clones.
Your process: visit the live website → study ALL screenshots → use the extracted styles → write HTML/CSS/JS.

You work in a strict step-by-step loop: START → THINK → TOOL → OBSERVE → THINK → ... → OUTPUT.
Do exactly ONE step per response, then stop and wait for the next message.

You have access to these tools:
${TOOLS_DESCRIPTION}

RULES:
1. Every response must be a single valid JSON object — no extra text outside the JSON.
2. One step per response. Wait for OBSERVE before continuing.
3. When asked to clone a website, ALWAYS call visitAndCapture first.
4. After visitAndCapture you will receive THREE screenshot images (viewport, header, hero).
   Study every pixel: colors, gradients, fonts, spacing, layout, background patterns, animations.
5. You MUST implement every visual effect you see, including:
   - Gradient text: use "background: linear-gradient(...); -webkit-background-clip: text; -webkit-text-fill-color: transparent;"
   - Highlight/box behind a word: wrap the word in a <span> with background-color
   - Background patterns (diagonal lines, dots, grids): recreate with SVG or CSS
   - Scrolling/marquee tickers: use CSS animation or JS scroll
   - Subtle background gradients on sections
6. Use the extracted elementStyles and cssVars from the OBSERVE data to get exact colors and fonts.
7. For every image/logo, check downloadedAssets in the OBSERVE data:
   - status "ok"     → use local path:    <img src="assets/images/filename.svg">
   - status "failed" → use fallbackUrl:   <img src="https://...the-cdn-url...">
   - NEVER invent a local path that wasn't in the downloaded list.
8. Output MUST be a single index.html file containing:
   - All HTML structure
   - All CSS inside a <style> tag in the <head>
   - All JavaScript inside a <script> tag before </body>
   Do NOT create separate .css or .js files. Everything in one file. No exceptions.
9. The final HTML must include: sticky header, hero section, footer — all matching the real site visually.
10. Only emit OUTPUT when the HTML file is written and opened.

JSON schema (omit unused fields):
{ "step": "START|THINK|TOOL|OBSERVE|OUTPUT", "content": "string", "tool_name": "string", "tool_args": {} }
`;

// ─── Agent Loop ───────────────────────────────────────────────────────────────

async function runAgent(userMessage, history) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];

  while (true) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("\n\x1b[31m[ERROR]\x1b[0m Could not parse response:", raw.slice(0, 200));
      break;
    }

    messages.push({ role: "assistant", content: JSON.stringify(parsed) });

    switch (parsed.step) {
      case "START":
        console.log(`\n\x1b[36m[START]\x1b[0m   ${parsed.content}`);
        break;

      case "THINK":
        console.log(`\x1b[33m[THINK]\x1b[0m   ${parsed.content}`);
        break;

      case "TOOL": {
        const { tool_name, tool_args = {} } = parsed;
        const argsPreview = JSON.stringify(tool_args).slice(0, 100);
        console.log(`\x1b[35m[TOOL]\x1b[0m    ${tool_name}(${argsPreview}...)`);

        const fn = tool_map[tool_name];
        if (!fn) {
          messages.push({
            role: "user",
            content: JSON.stringify({
              step: "OBSERVE",
              content: `Tool '${tool_name}' not found. Available: ${Object.keys(tool_map).join(", ")}`,
            }),
          });
          break;
        }

        let result;
        try {
          result = await fn(tool_args);
        } catch (err) {
          const errMsg = `Error in ${tool_name}: ${err.message}`;
          console.log(`\x1b[31m[ERROR]\x1b[0m   ${errMsg}`);
          messages.push({
            role: "user",
            content: JSON.stringify({ step: "OBSERVE", content: errMsg }),
          });
          break;
        }

        // If visitAndCapture returned screenshots, attach all of them as vision messages
        if (tool_name === "visitAndCapture" && result?.screenshotPath) {
          const { screenshotPath, heroScreenshotPath, headerScreenshotPath,
                  pageData, elementStyles, cssVars, downloadedAssets, summary } = result;
          console.log(`\x1b[32m[OBSERVE]\x1b[0m ${summary}`);
          console.log(`\x1b[36m[VISION]\x1b[0m  Sending 3 screenshots to model...`);

          const toBase64 = (p) => {
            try { return fs.readFileSync(p).toString("base64"); } catch { return null; }
          };

          const contentBlocks = [
            {
              type: "text",
              text: JSON.stringify({
                step: "OBSERVE",
                content: {
                  summary,
                  pageData,
                  elementStyles,
                  cssVars,
                  downloadedAssets,
                  note: "Three screenshots follow: (1) full viewport, (2) header crop, (3) hero crop. Study them carefully — replicate exact colors, gradients, background patterns, text effects, and layout.",
                },
              }),
            },
          ];

          // Attach all available screenshots
          for (const [label, p] of [
            ["Full viewport", screenshotPath],
            ["Header crop", headerScreenshotPath],
            ["Hero crop", heroScreenshotPath],
          ]) {
            const b64 = toBase64(p);
            if (b64) {
              contentBlocks.push({ type: "text", text: `Screenshot: ${label}` });
              contentBlocks.push({
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" },
              });
            }
          }

          messages.push({ role: "user", content: contentBlocks });
        } else {
          // Normal text observe for all other tools
          const preview = typeof result === "string" ? result : JSON.stringify(result);
          console.log(`\x1b[32m[OBSERVE]\x1b[0m ${preview.slice(0, 120)}`);
          messages.push({
            role: "user",
            content: JSON.stringify({ step: "OBSERVE", content: result }),
          });
        }
        break;
      }

      case "OUTPUT":
        console.log(`\n\x1b[32m[OUTPUT]\x1b[0m  ${parsed.content}\n`);
        history.push({ role: "user", content: userMessage });
        history.push({ role: "assistant", content: parsed.content });
        return;

      default:
        console.log(`[${parsed.step}] ${parsed.content ?? ""}`);
    }
  }
}

// ─── Main CLI Loop ────────────────────────────────────────────────────────────

async function main() {
  console.log("\x1b[1m\x1b[36m");
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   AI Agent CLI — Live Website Cloner         ║");
  console.log("║   Powered by Playwright + GPT-4o Vision      ║");
  console.log("║   Type your instruction, or 'exit' to quit   ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("\x1b[0m");

  const history = [];

  while (true) {
    const input = await prompt("\x1b[1mYou:\x1b[0m ");
    if (!input.trim()) continue;
    if (input.trim().toLowerCase() === "exit") {
      console.log("Goodbye!");
      rl.close();
      break;
    }
    try {
      await runAgent(input.trim(), history);
    } catch (err) {
      console.error("\n\x1b[31m[FATAL]\x1b[0m", err.message);
    }
  }
}

main();
