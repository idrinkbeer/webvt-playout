import fetch from "node-fetch";
import { spawn } from "child_process";
import http from "http";

const API = process.env.API_BASE;
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;

let nowPlaying = null;
let nextPlaying = null;
let startedAt = null;
let durationMs = 0;
let queue = [];


// =====================
// KEEP CONTAINER ALIVE
// =====================
import fs from "fs";
import path from "path";

http.createServer((req, res) => {

  if (req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      nowPlaying,
      nextPlaying,
      startedAt,
      durationMs,
      queue // 👈 add this
    }));
    return;
  }

  // serve index.html
  if (req.url === "/" || req.url === "/index.html") {
    const file = fs.readFileSync("./index.html");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(file);
    return;
  }

  res.writeHead(404);
  res.end();

}).listen(PORT);

// =====================
// HELPERS
// =====================
function encodeName(name) {
  return encodeURIComponent(name).replace(/'/g, "%27");
}

// =====================
// API CALLS
// =====================
async function getLogs() {
  const res = await fetch(`${API}/logs`, {
    headers: { Authorization: "Bearer " + TOKEN }
  });

  const text = await res.text();

  console.log("📡 /logs response:", text);

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON from /logs: ${text}`);
  }
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
// MIX ENGINE (CORE)
// =====================
function mixTracks({ music, next, voice = null, delay = 20000 }) {
  return new Promise((resolve) => {
    console.log("🎚 Mixing:", music, "→", next, voice ? "+ VT" : "");

    const args = ["-i", music];

    if (next) {
      args.push("-itsoffset", (delay / 1000).toString(), "-i", next);
    }

if (voice) {
  const voiceDelay = Math.max(delay - 3000, 2000); // play during ramp
  args.push("-itsoffset", (voiceDelay / 1000).toString(), "-i", voice);
}

    let filter = "";

    if (voice) {
      filter = `
[0:a][2:a]sidechaincompress=threshold=0.05:ratio=10:attack=5:release=300[a0];
[a0]anull[aout]
`.replace(/\n/g, "");
    } else if (next) {
const fade = 3; // seconds

filter = `
[0:a]afade=t=out:st=${(delay/1000)-fade}:d=${fade}[a0];
[1:a]afade=t=in:st=0:d=${fade}[a1];
[a0][a1]amix=inputs=2:duration=first
`.replace(/\n/g, "");
    } else {
      filter = "[0:a]anull";
    }

    const ffmpeg = spawn("ffmpeg", [
      ...args,
      "-filter_complex", filter,
      "-f", "wav",
      "-"
    ]);

    const ffplay = spawn("ffplay", [
      "-nodisp",
      "-autoexit",
      "-"
    ]);

    // 🔥 PIPE SAFELY
    ffmpeg.stdout.pipe(ffplay.stdin);

    // 🔥 HANDLE PIPE BREAK
    ffmpeg.stdout.on("error", (err) => {
      if (err.code !== "EPIPE") {
        console.error("FFmpeg pipe error:", err);
      }
    });

    ffplay.stdin.on("error", (err) => {
      if (err.code !== "EPIPE") {
        console.error("FFplay stdin error:", err);
      }
    });

    // 🔥 KILL ffmpeg when ffplay exits
    ffplay.on("exit", () => {
      if (!ffmpeg.killed) {
        ffmpeg.kill("SIGKILL");
      }
      resolve();
    });

    ffmpeg.on("error", resolve);
  });
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

      console.log("📄 Using:", latest);

const text = await loadLog(latest);
const items = parseASC(text);

queue = items; // ✅ correct place

      console.log(`🎵 ${items.length} items`);

for (let i = 0; i < items.length; i++) {
  const current = items[i];

  // ❌ skip sweepers as standalone items
  if (current.type === "sweeper" || current.type === "vt") {
    continue;
  }

  // 🔍 find next REAL song (skip sweepers/vt)
  let nextIndex = i + 1;
  let overlay = null;

  // collect overlay if immediately after
  if (items[i + 1] && (items[i + 1].type === "sweeper" || items[i + 1].type === "vt")) {
    overlay = items[i + 1];
    console.log("🎙 Overlay:", overlay.name);
  }

  while (
    items[nextIndex] &&
    (items[nextIndex].type === "sweeper" || items[nextIndex].type === "vt")
  ) {
    nextIndex++;
  }

  const next = items[nextIndex];

  const currentUrl = `${API}/audio/song/${encodeName(current.name)}`;
  const nextUrl = next
    ? `${API}/audio/song/${encodeName(next.name)}`
    : null;

  const overlayUrl = overlay
    ? `${API}/audio/song/${encodeName(overlay.name)}`
    : null;

  // 🎯 timing
let delay = 15000;

if (next) {
  const duration = await getDuration(currentUrl);
  const air = await getAIR(current.name);

  if (air && air.seg > 0) {
    delay = air.seg * 1000;
    console.log(`🎯 SEG timing: ${air.seg}s`);
  } else {
    // smarter fallback
    const fallback = Math.min(12, duration * 0.15);
    delay = (duration - fallback) * 1000;
    console.log("⚠️ Using smart fallback");
  }

  delay = Math.max(delay, 5000);
}

nowPlaying = current;
nextPlaying = next;
startedAt = Date.now();
durationMs = delay;

  // 🎚 mix properly
  await mixTracks({
    music: currentUrl,
    next: nextUrl,
    voice: overlayUrl,
    delay
  });
}

      console.log("🔁 Restarting log...");
      await new Promise(r => setTimeout(r, 5000));

    } catch (err) {
      console.error("❌ Error:", err);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}


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
      resolve(isNaN(seconds) ? 180 : seconds); // fallback
    });
  });
}


function parseAIR(airString) {
  if (!airString || !airString.startsWith("AIR#")) return null;

  try {
    const start = parseInt(airString.substr(4, 6)) / 100;
    const seg   = parseInt(airString.substr(10, 6)) / 100;
    const end   = parseInt(airString.substr(16, 6)) / 100;
    const intro = parseInt(airString.substr(22, 3)) / 10;

    return { start, seg, end, intro };
  } catch {
    return null;
  }
}

start();
