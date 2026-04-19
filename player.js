import http from "http";

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(PORT, () => {
  console.log(`🌐 Health server running on port ${PORT}`);
});


import fetch from "node-fetch";
import { spawn } from "child_process";

const API = process.env.API_BASE;
const TOKEN = process.env.TOKEN;

let currentProcess = null;
let isPlaying = false;

// =====================
// CLEAN SHUTDOWN
// =====================
process.on("SIGTERM", () => {
  console.log("🛑 Shutting down...");
  if (currentProcess) currentProcess.kill("SIGKILL");
  process.exit(0);
});

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
// PLAY FILE
// =====================
function playFile(url, nextUrl = null) {
  return new Promise((resolve) => {
    console.log("▶ Playing:", url);

    const main = spawn("ffplay", [
      "-nodisp",
      "-autoexit",
      url
    ]);

    currentProcess = main;

    let overlapped = false;

    main.stderr.on("data", (data) => {
      const msg = data.toString();

      // crude duration detection
      const match = msg.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);

      if (match && nextUrl && !overlapped) {
        const mins = parseInt(match[2]);
        const secs = parseFloat(match[3]);
        const total = mins * 60 + secs;

        // 🔥 start next track ~5s before end
        setTimeout(() => {
          console.log("🔀 Starting next early:", nextUrl);

          spawn("ffplay", [
            "-nodisp",
            "-autoexit",
            nextUrl
          ]);

        }, (total - 5) * 1000);

        overlapped = true;
      }
    });

    main.on("exit", resolve);
    main.on("error", resolve);
  });
}

// =====================
// SAFE ENCODE
// =====================
function encodeName(name) {
  return encodeURIComponent(name).replace(/'/g, "%27");
}

// =====================
// MAIN ENGINE
// =====================
async function start() {
  while (true) {
    try {
      if (isPlaying) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      isPlaying = true;

      console.log("📂 Loading logs...");

      const logs = await getLogs();

      if (!logs.length) {
        console.log("⚠️ No logs found");
        isPlaying = false;
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
        console.log("⚠️ Nothing playable");
        isPlaying = false;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      for (const item of items) {
        if (item.type === "song") {
          const url = `${API}/audio/song/${encodeName(item.name)}`;
          await playFile(url);
        }

        if (item.type === "sweeper") {
          const url = `${API}/audio/song/${encodeName(item.name)}`;
          await playFile(url);
        }
      }

      console.log("🔁 Finished log. Waiting before reload...");
      isPlaying = false;

      // wait before restarting loop
      await new Promise(r => setTimeout(r, 5000));

    } catch (err) {
      console.error("Playback error:", err);
      isPlaying = false;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

start();
