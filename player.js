import fetch from "node-fetch";
import { spawn } from "child_process";
import http from "http";

const API = process.env.API_BASE;
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;

let currentProcess = null;

// =====================
// KEEP CONTAINER ALIVE
// =====================
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(PORT, () => {
  console.log(`🌐 Health server running on port ${PORT}`);
});

// =====================
// SAFE ENCODE
// =====================
function encodeName(name) {
  return encodeURIComponent(name).replace(/'/g, "%27");
}

// =====================
// FETCH LOG LIST
// =====================
async function getLogs() {
  const res = await fetch(`${API}/logs`, {
    headers: { Authorization: "Bearer " + TOKEN }
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("LOG ERROR:", res.status, text);
    throw new Error("Failed to load logs");
  }

  return await res.json();
}

// =====================
// LOAD LOG CONTENT
// =====================
async function loadLog(filename) {
  const res = await fetch(`${API}/logs/${filename}`, {
    headers: { Authorization: "Bearer " + TOKEN }
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("LOG FILE ERROR:", res.status, text);
    throw new Error("Failed to load log file");
  }

  return await res.text();
}

// =====================
// PARSE ASC LOG
// =====================
function parseASC(text) {
  const lines = text.split("\n");
  const items = [];

  for (const line of lines) {
    if (!line) continue;

    const matches = line.match(/[^\\\/]+\.mp3/gi);
    if (!matches) continue;

    const name = matches[matches.length - 1].trim();

    const isSweeper = name.toLowerCase().includes("sweep");

    items.push({
      type: isSweeper ? "sweeper" : "song",
      name
    });
  }

  return items;
}

// =====================
// GET AIR TAGS
// =====================
async function getAIR(name) {
  try {
    const res = await fetch(`${API}/music/tag/${encodeName(name)}`, {
      headers: { Authorization: "Bearer " + TOKEN }
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.air || null;
  } catch {
    return null;
  }
}

// =====================
// PLAY WITH INTRO TIMING
// =====================
function playWithMix(currentUrl, nextUrl, delayMs) {
  return new Promise((resolve) => {
    console.log("▶ Mixing:", currentUrl, "→", nextUrl);

    const delay = Math.max(delayMs, 0);

    const ffmpeg = spawn("ffmpeg", [
      "-i", currentUrl,
      "-itsoffset", (delay / 1000).toString(),
      "-i", nextUrl,
      "-filter_complex",
      "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2",
      "-f", "wav",
      "-"
    ]);

    const ffplay = spawn("ffplay", [
      "-nodisp",
      "-autoexit",
      "-"
    ]);

    ffmpeg.stdout.pipe(ffplay.stdin);

    ffmpeg.on("exit", resolve);
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

      if (!logs.length) {
        console.log("⚠️ No logs found");
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const latest = logs.sort().reverse()[0];
      console.log("📄 Using log:", latest);

      const text = await loadLog(latest);
      const items = parseASC(text);

      console.log(`🎵 ${items.length} playable items`);
      console.log("First 5:", items.slice(0, 5));

      if (!items.length) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

for (let i = 0; i < items.length; i++) {

}
      }

      console.log("🔁 Finished log, restarting...");
      await new Promise(r => setTimeout(r, 5000));

    } catch (err) {
      console.error("Playback error:", err);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

start();
