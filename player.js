import fetch from "node-fetch";
import { spawn } from "child_process";

const API = process.env.API_BASE;
const TOKEN = process.env.TOKEN;

let currentProcess = null;

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
// PARSE ASC LOG (robust)
// =====================
function parseASC(text) {
  const lines = text.split("\n");
  const items = [];

  for (const line of lines) {
    if (!line) continue;

    // find ALL mp3 matches in line
    const matches = line.match(/[^\\\/]+\.mp3/gi);
    if (!matches) continue;

    // ALWAYS take the LAST match (real filename)
    const name = matches[matches.length - 1].trim();

    items.push({
      type: "song",
      name
    });
  }

  return items;
}

// =====================
// PLAY FILE
// =====================
function playFile(url) {
  return new Promise((resolve) => {
    console.log("▶ Playing:", url);

    currentProcess = spawn("ffplay", [
      "-nodisp",
      "-autoexit",
      url
    ]);

    currentProcess.on("exit", resolve);
    currentProcess.on("error", resolve);
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

      if (!items.length) {
        console.log("⚠️ Nothing playable in log");
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      console.log("First 5:", items.slice(0, 5));

      for (const item of items) {
        if (item.type === "song") {
          const url = `${API}/audio/song/${encodeURIComponent(item.name)}`;
          await playFile(url);
        }

        // future:
        // sweeper / vtx / etc
      }

      console.log("🔁 Finished log, restarting...");
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error("Playback error:", err);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

start();
