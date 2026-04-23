import fetch from "node-fetch";
import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import { PassThrough } from "stream";

const API = process.env.API_BASE;
const TOKEN = process.env.TOKEN;
const PORT = 8080;

let nowPlaying = null;
let nextPlaying = null;
let startedAt = null;
let durationMs = 0;
let queue = [];
let currentIndex = 0;

const audioStream = new PassThrough();

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
      queue,
      currentIndex
    }));
    return;
  }

  if (req.url.startsWith("/stream")) {
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Transfer-Encoding": "chunked"
    });

    audioStream.pipe(res);

    req.on("close", () => {
      audioStream.unpipe(res);
    });

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
  start();
});

// =====================
// AUDIO ENGINE (FIXED)
// =====================
function playTrack(url) {
  return new Promise((resolve) => {
    console.log("▶️ Playing:", url);

    const ffmpeg = spawn("ffmpeg", [
      "-re",                // 🔥 real-time playback
      "-i", url,
      "-f", "mp3",
      "-b:a", "128k",
      "-"
    ]);

    ffmpeg.stdout.pipe(audioStream, { end: false });

    ffmpeg.stderr.on("data", () => {}); // suppress noise

    ffmpeg.on("exit", () => {
      console.log("⏹ Finished:", url);
      resolve();
    });
  });
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
// MAIN ENGINE (SEQUENTIAL FOR NOW)
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
        currentIndex = i;

        const current = items[i];
        if (current.type !== "song") continue;

        const currentUrl = `${API}/audio/song/${encodeName(current.name)}`;

        const duration = await getDuration(currentUrl);

        nowPlaying = current;
        nextPlaying = null;
        startedAt = Date.now();
        durationMs = duration * 1000;

        // ▶️ PLAY FULL TRACK (NO CUTS)
        await playTrack(currentUrl);
      }

      console.log("🔁 Restarting log...");
      await new Promise(r => setTimeout(r, 3000));

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
