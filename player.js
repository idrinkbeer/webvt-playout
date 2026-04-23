import fetch from "node-fetch";
import { spawn } from "child_process";
import http from "http";
import fs from "fs";

const API = process.env.API_BASE;
const TOKEN = process.env.TOKEN;
const PORT = 8080;

let nowPlaying = null;
let nextPlaying = null;
let startedAt = null;
let durationMs = 0;
let queue = [];

let player = null;

// =====================
// HTTP SERVER
// =====================
http.createServer((req, res) => {

  if (req.url.startsWith("/status")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      nowPlaying,
      nextPlaying,
      startedAt,
      durationMs,
      queue
    }));
    return;
  }

  if (req.url === "/" || req.url.startsWith("/index")) {
    const file = fs.readFileSync("./index.html", "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(file);
    return;
  }

  res.writeHead(404);
  res.end();

}).listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Server running on port ${PORT}`);

  startPlayer(); // 🔥 start audio output
  start();       // 🔥 start scheduler
});

// =====================
// AUDIO ENGINE
// =====================
function startPlayer() {
  player = spawn("ffplay", [
    "-nodisp",
    "-autoexit",
    "-f", "wav",
    "-"
  ]);

  player.stdin.on("error", () => {});
}

function playTrack(url, delay = 0, volume = 1) {
  setTimeout(() => {
    console.log("▶️ Playing:", url);

    const ffmpeg = spawn("ffmpeg", [
      "-i", url,
      "-filter:a", `volume=${volume}`,
      "-f", "wav",
      "-"
    ]);

    ffmpeg.stdout.pipe(player.stdin, { end: false });

    ffmpeg.on("error", () => {});
  }, delay);
}

function playOverlay(url, delay) {
  setTimeout(() => {
    console.log("🎙 Overlay:", url);

    const ffmpeg = spawn("ffmpeg", [
      "-i", url,
      "-filter:a", "volume=1.2",
      "-f", "wav",
      "-"
    ]);

    ffmpeg.stdout.pipe(player.stdin, { end: false });

  }, delay);
}

// =====================
// HELPERS
// =====================
function encodeName(name) {
  return encodeURIComponent(name).replace(/'/g, "%27");
}

// =====================
// API
// =====================
async function getLogs() {
  const res = await fetch(`${API}/logs`, {
    headers: { Authorization: "Bearer " + TOKEN }
  });

  const text = await res.text();
  console.log("📡 /logs:", text);

  return JSON.parse(text);
}

async function loadLog(filename) {
  const res = await fetch(`${API}/logs/${filename}`, {
    headers: { Authorization: "Bearer " + TOKEN }
  });
  return await res.text();
}

async function getAIR(name) {
  try {
    const res = await fetch(`${API}/music/tag/${encodeName(name)}`, {
      headers: { Authorization: "Bearer " + TOKEN }
    });

    if (!res.ok) return null;

    const data = await res.json();
    console.log("🎧 RAW AIR:", data.air);

    return parseAIR(data.air);
  } catch {
    return null;
  }
}

// =====================
// PARSE LOG
// =====================
function parseASC(text) {
  const lines = text.split("\n");
  const items = [];

  for (const line of lines) {
    const matches = line.match(/[^\\\/]+\.mp3/gi);
    if (!matches) continue;

    const name = matches[matches.length - 1].trim().toLowerCase();

    let type = "song";
    if (name.includes("sweep")) type = "sweeper";
    if (name.includes("vt")) type = "vt";

    items.push({ type, name });
  }

  return items;
}

// =====================
// MAIN ENGINE
// =====================
async function start() {
  while (true) {
    try {
      console.log("📂 Loading logs...");

      const logs = await getLogs();
      const latest = logs.sort().reverse()[0];

      const text = await loadLog(latest);
      const items = parseASC(text);

      queue = items;

      for (let i = 0; i < items.length; i++) {
        const current = items[i];

        if (current.type !== "song") continue;

        let nextIndex = i + 1;
        let overlay = null;

        if (items[i + 1] && (items[i + 1].type === "vt" || items[i + 1].type === "sweeper")) {
          overlay = items[i + 1];
        }

        while (items[nextIndex] &&
          (items[nextIndex].type === "vt" || items[nextIndex].type === "sweeper")) {
          nextIndex++;
        }

        const next = items[nextIndex];

        const currentUrl = `${API}/audio/song/${encodeName(current.name)}`;
        const nextUrl = next ? `${API}/audio/song/${encodeName(next.name)}` : null;
        const overlayUrl = overlay ? `${API}/audio/song/${encodeName(overlay.name)}` : null;

        const duration = await getDuration(currentUrl);

        let delay = 15000;

        if (next) {
          const air = await getAIR(current.name);

          if (air && air.seg > 0) {
            delay = air.seg * 1000;
            console.log(`🎯 SEG: ${air.seg}s`);
          } else {
            delay = (duration - 8) * 1000;
            console.log("⚠️ Fallback SEG");
          }
        }

        nowPlaying = current;
        nextPlaying = next;
        startedAt = Date.now();
        durationMs = duration * 1000;

        // ▶️ PLAY CURRENT
        playTrack(currentUrl);

        // ▶️ PLAY NEXT AT SEG
        if (nextUrl) {
          playTrack(nextUrl, delay);
        }

        // 🎙 OVERLAY
        if (overlayUrl) {
          const voiceDelay = Math.max(delay - 3000, 2000);
          playOverlay(overlayUrl, voiceDelay);
        }

        // ⏱ WAIT FULL SONG
        await new Promise(r => setTimeout(r, duration * 1000));
      }

      console.log("🔁 Restarting log...");
      await new Promise(r => setTimeout(r, 5000));

    } catch (err) {
      console.error("❌ Error:", err);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// =====================
// DURATION
// =====================
async function getDuration(url) {
  return new Promise((resolve) => {
    const probe = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      url
    ]);

    let output = "";

    probe.stdout.on("data", (d) => {
      output += d.toString();
    });

    probe.on("exit", () => {
      const seconds = parseFloat(output);
      resolve(isNaN(seconds) ? 180 : seconds);
    });
  });
}

// =====================
// AIR PARSER
// =====================
function parseAIR(airString) {
  if (!airString || !airString.startsWith("AIR#")) return null;

  try {
    return {
      start: parseInt(airString.substr(4, 6)) / 100,
      seg: parseInt(airString.substr(10, 6)) / 100,
      end: parseInt(airString.substr(16, 6)) / 100,
      intro: parseInt(airString.substr(22, 3)) / 10
    };
  } catch {
    return null;
  }
}
