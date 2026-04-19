import fetch from "node-fetch";
import { spawn } from "child_process";
import http from "http";

const API = process.env.API_BASE;
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;

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
// HELPERS
// =====================
function encodeName(name) {
  return encodeURIComponent(name).replace(/'/g, "%27");
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// =====================
// API
// =====================
async function getLogs() {
  const res = await fetch(`${API}/logs`, {
    headers: { Authorization: "Bearer " + TOKEN }
  });
  return await res.json();
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
    return data.air || null;
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

    const raw = matches[matches.length - 1].trim();
    const lower = raw.toLowerCase();

    let type = "song";
    if (lower.includes("sweep")) type = "sweeper";
    if (lower.includes("vt")) type = "vt";

    items.push({ type, name: raw });
  }

  return items;
}

// =====================
// MIX ENGINE
// =====================
function mixTracks({ music, next = null, voice = null, delay = 20000 }) {
  return new Promise((resolve) => {
    console.log("🎚 Mixing:", music, "→", next || "-", voice ? "+ overlay" : "");

    const args = ["-i", music];

    if (next) {
      args.push("-itsoffset", (delay / 1000).toString(), "-i", next);
    }

    if (voice) {
      args.push("-i", voice);
    }

    let filter;

    if (voice) {
      // 🎙 overlay (sweeper or VT)
      filter = "[0:a]volume=0.7[a0];[2:a]volume=1.2[a2];[a0][a2]amix=inputs=2:duration=first";
    } else if (next) {
      // 🔁 transition
      filter = "[0:a][1:a]amix=inputs=2:duration=first";
    } else {
      // 🎵 single track
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

    ffmpeg.stdout.pipe(ffplay.stdin);

    // prevent crash
    ffmpeg.stdout.on("error", (err) => {
      if (err.code !== "EPIPE") console.error("FFmpeg pipe error:", err);
    });

    ffplay.stdin.on("error", (err) => {
      if (err.code !== "EPIPE") console.error("FFplay stdin error:", err);
    });

    ffplay.on("exit", () => {
      if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
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
      if (!logs.length) {
        console.log("⚠️ No logs found");
        await sleep(5000);
        continue;
      }

      const latest = logs.sort().reverse()[0];
      console.log("📄 Using:", latest);

      const text = await loadLog(latest);
      const items = parseASC(text);

      console.log(`🎵 ${items.length} items`);

      for (let i = 0; i < items.length; i++) {
        const current = items[i];
        const next = items[i + 1];

        const currentUrl = `${API}/audio/song/${encodeName(current.name)}`;
        const nextUrl = next
          ? `${API}/audio/song/${encodeName(next.name)}`
          : null;

        // =====================
        // 🔊 SWEEPER / VT OVERLAY
        // =====================
        if ((current.type === "sweeper" || current.type === "vt") && next) {
          console.log("🎙 Overlay:", current.name, "→", next.name);

          await mixTracks({
            music: nextUrl,
            voice: currentUrl,
            delay: 0
          });

          i++; // skip next (already used)
          continue;
        }

        // =====================
        // 🎵 NORMAL SONG TRANSITION
        // =====================
        let delay = 20000;

        if (next) {
          const air = await getAIR(current.name);

          if (air?.intro) {
            delay = Math.max(air.intro * 1000, 5000);
            console.log(`🎯 Intro: ${air.intro}s`);
          } else {
            console.log("⚠️ Using fallback mix delay");
          }
        }

        await mixTracks({
          music: currentUrl,
          next: nextUrl,
          delay
        });
      }

      console.log("🔁 Restarting log...");
      await sleep(5000);

    } catch (err) {
      console.error("❌ Error:", err);
      await sleep(3000);
    }
  }
}

start();

// =====================
// GLOBAL SAFETY
// =====================
process.on("uncaughtException", (err) => {
  console.error("🔥 Uncaught:", err);
});
