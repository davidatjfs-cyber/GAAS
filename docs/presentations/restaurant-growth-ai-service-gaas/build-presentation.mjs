import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import PptxGenJS from "/Users/xieding/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/pptxgenjs@4.0.1/node_modules/pptxgenjs/dist/pptxgen.es.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_PORT = 4174;
const PREVIEW_URL = process.env.PREVIEW_URL || `http://127.0.0.1:${PREVIEW_PORT}/preview/index.html`;
const USE_EXISTING_SERVER = process.env.USE_EXISTING_SERVER === "1";
const PLAYWRIGHT = "/Library/Frameworks/Python.framework/Versions/3.11/bin/playwright";
const OUT_DIR = path.join(ROOT, "outputs");
const ASSET_DIR = path.join(ROOT, "assets");
const PPTX_PATH = path.join(OUT_DIR, "restaurant-growth-ai-service-gaas.pptx");
const WIDTH = 13.333;
const HEIGHT = 7.5;
const SLIDE_COUNT = 24;

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for preview server: ${url}`);
}

function slidePath(index) {
  return path.join(ASSET_DIR, `slide-${String(index).padStart(2, "0")}.png`);
}

function renderSlideScreenshot(index) {
  const url = `${PREVIEW_URL}?slide=${index}&export=1`;
  const outPath = slidePath(index);
  execFileSync(
    PLAYWRIGHT,
    [
      "screenshot",
      "--browser",
      "chromium",
      "--timeout",
      "120000",
      "--viewport-size",
      "1280,720",
      "--wait-for-timeout",
      "2500",
      url,
      outPath,
    ],
    {
      stdio: "inherit",
      cwd: ROOT,
      env: process.env,
    },
  );
  return outPath;
}

async function buildPptx(slideImages) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Codex";
  pptx.company = "OpenAI";
  pptx.subject = "餐厅增长 AI 操作系统";
  pptx.title = "餐厅增长 AI 操作系统";
  pptx.lang = "zh-CN";
  pptx.theme = {
    headFontFace: "Aptos",
    bodyFontFace: "Aptos",
    lang: "zh-CN",
  };

  for (const imagePath of slideImages) {
    const slide = pptx.addSlide();
    slide.background = { color: "0B0F14" };
    slide.addImage({
      path: imagePath,
      x: 0,
      y: 0,
      w: WIDTH,
      h: HEIGHT,
    });
  }

  await pptx.writeFile({ fileName: PPTX_PATH });
}

async function main() {
  await ensureDir(OUT_DIR);

  let server = null;
  try {
    if (!USE_EXISTING_SERVER) {
      server = spawn("python3", ["-m", "http.server", String(PREVIEW_PORT), "--directory", ROOT], {
        cwd: ROOT,
        stdio: "ignore",
        detached: true,
      });
    }

    await waitForServer(PREVIEW_URL);

    const slideImages = [];
    for (let i = 1; i <= SLIDE_COUNT; i += 1) {
      slideImages.push(renderSlideScreenshot(i));
    }

    await buildPptx(slideImages);
    console.log(`PPTX written to ${PPTX_PATH}`);
  } finally {
    if (server) {
      try {
        process.kill(-server.pid);
      } catch {
        try {
          server.kill();
        } catch {
          // ignore
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
