import fs from "fs";
import path from "path";
import { exec } from "child_process";
import axios from "axios";

export function writeFile({ path: filePath, content }) {
  const dir = path.dirname(filePath);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return `File written: ${filePath} (${content.length} chars)`;
}

export function createFolder({ path: folderPath }) {
  fs.mkdirSync(folderPath, { recursive: true });
  return `Folder created: ${folderPath}`;
}

export function executeCommand({ cmd }) {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      resolve(error ? `Error: ${error.message}` : stdout || stderr || "Done");
    });
  });
}

export async function downloadAsset({ url: assetUrl, savePath }) {
  const dir = path.dirname(savePath);
  fs.mkdirSync(dir, { recursive: true });
  const response = await axios.get(assetUrl, { responseType: "arraybuffer", timeout: 15000 });
  fs.writeFileSync(savePath, response.data);
  return `Downloaded: ${assetUrl} → ${savePath}`;
}

export async function visitAndCapture({ url, outputDir }) {
  const { chromium } = await import("playwright");

  fs.mkdirSync(path.join(outputDir, "assets", "images"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  console.log(`\x1b[36m[PLAYWRIGHT]\x1b[0m Visiting ${url}...`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

  // ── Screenshots ─────────────────────────────────────────────────────────────
  const screenshotPath = path.join(outputDir, "screenshot_viewport.jpg");
  const heroScreenshotPath = path.join(outputDir, "screenshot_hero.jpg");
  const headerScreenshotPath = path.join(outputDir, "screenshot_header.jpg");

  await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 90, fullPage: false });
  console.log(`\x1b[36m[PLAYWRIGHT]\x1b[0m Viewport screenshot saved`);

  // Header section screenshot
  try {
    const headerEl = await page.$("header, nav");
    if (headerEl) {
      await headerEl.screenshot({ path: headerScreenshotPath, type: "jpeg", quality: 90 });
      console.log(`\x1b[36m[PLAYWRIGHT]\x1b[0m Header screenshot saved`);
    }
  } catch {}

  // Hero section screenshot (clip top portion of page below header)
  try {
    await page.screenshot({
      path: heroScreenshotPath,
      type: "jpeg",
      quality: 90,
      clip: { x: 0, y: 60, width: 1440, height: 700 },
    });
    console.log(`\x1b[36m[PLAYWRIGHT]\x1b[0m Hero screenshot saved`);
  } catch {}

  // ── Computed styles for key elements ────────────────────────────────────────
  const elementStyles = await page.evaluate(() => {
    const styleOf = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        selector,
        backgroundColor: cs.backgroundColor,
        background: cs.background,
        backgroundImage: cs.backgroundImage,
        color: cs.color,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        textTransform: cs.textTransform,
        padding: cs.padding,
        margin: cs.margin,
        borderRadius: cs.borderRadius,
        border: cs.border,
        display: cs.display,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
        gap: cs.gap,
        webkitTextFillColor: cs.webkitTextFillColor,
        webkitBackgroundClip: cs.webkitBackgroundClip,
      };
    };
    return {
      body: styleOf("body"),
      header: styleOf("header") || styleOf('[class*="header"]') || styleOf("nav"),
      h1: styleOf("h1"),
      heroSection:
        styleOf('[class*="hero"]') ||
        styleOf("main > section:first-child") ||
        styleOf("main > div:first-child") ||
        styleOf("section:first-of-type"),
      primaryBtn: styleOf('[class*="btn-primary"]') || styleOf('[class*="primary"]') || styleOf("button"),
      footer: styleOf("footer"),
    };
  });

  // ── CSS variables from :root ─────────────────────────────────────────────────
  const cssVars = await page.evaluate(() => {
    const vars = {};
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText === ":root") {
            rule.style.cssText.split(";").forEach((d) => {
              const [p, v] = d.split(":");
              if (p?.trim().startsWith("--")) vars[p.trim()] = v?.trim() ?? "";
            });
          }
        }
      } catch {}
    }
    return vars;
  });

  // ── Full text content extraction ─────────────────────────────────────────────
  const pageData = await page.evaluate(() => {
    const getAll = (sel) => Array.from(document.querySelectorAll(sel));
    return {
      title: document.title,
      headings: getAll("h1,h2,h3")
        .slice(0, 10)
        .map((h) => ({ tag: h.tagName, text: h.innerText.trim(), html: h.innerHTML })),
      navLinks: getAll("nav a, header a")
        .map((a) => ({ text: a.innerText.trim(), href: a.getAttribute("href") }))
        .filter((a) => a.text && a.text.length < 80)
        .slice(0, 25),
      buttons: getAll("button, a[class*='btn'], a[class*='cta'], [class*='button']")
        .map((b) => ({
          text: b.innerText.trim(),
          bg: getComputedStyle(b).backgroundColor,
          color: getComputedStyle(b).color,
          border: getComputedStyle(b).border,
          borderRadius: getComputedStyle(b).borderRadius,
          padding: getComputedStyle(b).padding,
          fontWeight: getComputedStyle(b).fontWeight,
        }))
        .filter((b) => b.text && b.text.length < 80)
        .slice(0, 15),
      paragraphs: getAll("p")
        .map((p) => p.innerText.trim())
        .filter((t) => t.length > 10)
        .slice(0, 12),
      images: getAll("img")
        .map((i) => ({ src: i.src, alt: i.alt, width: i.width, height: i.height }))
        .filter((i) => i.src && !i.src.startsWith("data:"))
        .slice(0, 20),
      footerContent: (() => {
        const footer = document.querySelector("footer");
        return footer ? footer.innerText.trim().slice(0, 1000) : "";
      })(),
      // Try to capture the hero section's full text
      heroText: (() => {
        const hero =
          document.querySelector('[class*="hero"]') ||
          document.querySelector("main > section:first-child") ||
          document.querySelector("main > div:first-child");
        return hero ? hero.innerText.trim().slice(0, 800) : "";
      })(),
      // Marquee / ticker items
      tickerItems: getAll('[class*="marquee"] *, [class*="ticker"] *, [class*="scroll"] span, [class*="slide"] *')
        .map((el) => el.innerText.trim())
        .filter((t) => t && t.length < 100)
        .slice(0, 20),
    };
  });

  // ── Download images ──────────────────────────────────────────────────────────
  const downloadedAssets = [];
  for (const img of pageData.images) {
    try {
      const urlObj = new URL(img.src);
      // Strip query params — CDN tokens often cause download failures
      const cleanUrl = `${urlObj.origin}${urlObj.pathname}`;
      let filename = path.basename(urlObj.pathname) || `img_${downloadedAssets.length}.png`;
      if (!path.extname(filename)) filename += ".png";
      const savePath = path.join(outputDir, "assets", "images", filename);
      // Try clean URL first, fall back to original
      let res;
      try {
        res = await axios.get(cleanUrl, { responseType: "arraybuffer", timeout: 8000 });
      } catch {
        res = await axios.get(img.src, { responseType: "arraybuffer", timeout: 8000 });
      }
      fs.writeFileSync(savePath, res.data);
      downloadedAssets.push({ original: img.src, cleanUrl, local: `assets/images/${filename}`, alt: img.alt, status: "ok" });
      console.log(`\x1b[36m[PLAYWRIGHT]\x1b[0m Downloaded: ${filename}`);
    } catch (e) {
      // Both attempts failed — pass clean CDN URL so model uses it directly
      const cleanUrl = (() => { try { const u = new URL(img.src); return `${u.origin}${u.pathname}`; } catch { return img.src; } })();
      downloadedAssets.push({ original: img.src, cleanUrl, local: null, alt: img.alt, status: "failed", fallbackUrl: cleanUrl });
      console.log(`\x1b[33m[PLAYWRIGHT]\x1b[0m Failed: ${img.src.slice(0, 80)}`);
    }
  }

  await browser.close();

  pageData.images = pageData.images.map((img) => {
    const asset = downloadedAssets.find((a) => a.original === img.src);
    return { ...img, local: asset?.local ?? null };
  });

  return {
    screenshotPath,           // viewport screenshot — will be shown to model as image
    heroScreenshotPath,       // hero crop — also shown to model
    headerScreenshotPath,     // header crop — also shown to model
    outputDir,
    pageData,
    elementStyles,
    cssVars: Object.fromEntries(Object.entries(cssVars).slice(0, 50)),
    downloadedAssets,
    summary: `Visited ${url}. Took 3 screenshots (viewport, header crop, hero crop). Downloaded ${downloadedAssets.length} assets. Found: ${pageData.headings.length} headings, ${pageData.navLinks.length} nav links, ${pageData.buttons.length} buttons.`,
  };
}

export const TOOLS_DESCRIPTION = `
1. visitAndCapture({ url: string, outputDir: string })
   Launches a real Chromium browser, visits the URL, and returns:
   - 3 screenshots: full viewport, header crop, hero crop (all shown to you as images)
   - Computed CSS styles for: body, header, h1, hero section, primary button, footer
   - All CSS variables from :root
   - Page content: headings (with innerHTML), nav links, buttons (with styles), paragraphs,
     hero text block, ticker/marquee items, footer text
   - Downloaded local copies of all images

2. downloadAsset({ url: string, savePath: string })
   Download a single file (image, font, SVG) from a URL to a local path.

3. writeFile({ path: string, content: string })
   Write a file. Creates parent dirs automatically. Reference downloaded assets by their
   local path (e.g. "assets/images/logo.png").

4. createFolder({ path: string })
   Create a directory and any missing parents.

5. executeCommand({ cmd: string })
   Run a shell command. Use "open <file>" on macOS to launch in browser.
`;

export const tool_map = {
  visitAndCapture,
  downloadAsset,
  writeFile,
  createFolder,
  executeCommand,
};
