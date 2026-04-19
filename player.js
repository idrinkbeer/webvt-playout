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

// =====================
// API CALLS
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

    const args = [
      "-i", music
    ];

    if (next) {
      args.push("-itsoffset", (delay / 1000).toString(), "-i", next);
    }

    if (voice) {
      args.push("-i", voice);
    }

    let filter = "";

    if (voice) {
      // duck music under voice
      filter = `
        [0:a]volume=0.5[a0];
        [2:a]volume=1.5[a2];
        [a0][a2]amix=inputs=2:duration=first[aout]
      `;
    } else if (next) {
      filter = `[0:a][1:a]amix=inputs=2:duration=first`;
    } else {
      filter = `[0:a]anull`;
    }

    const ffmpeg = spawn("ffmpeg", [
      ...args,
      "-filter_complex", filter.replace(/\n/g, ""),
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
      const latest = logs.sort().reverse()[0];

      console.log("📄 Using:", latest);

      const text = await loadLog(latest);
      const items = parseASC(text);

      console.log(`🎵 ${items.length} items`);

      for (let i = 0; i < items.length; i++) {
        const current = items[i];
        const next = items[i + 1];
        const next2 = items[i + 2];

        const musicUrl = `${API}/audio/song/${encodeName(current.name)}`;
        const nextUrl = next ? `${API}/audio/song/${encodeName(next.name)}` : null;

        let delay = 20000;

        if (next) {
          const air = await getAIR(current.name);
          if (air?.intro) {
            delay = Math.max(air.intro * 1000, 5000);
            console.log(`🎯 Intro: ${air.intro}s`);
          }
        }

        // detect VT after song
        let voiceUrl = null;
        if (next && next.type === "vt") {
          voiceUrl = `${API}/audio/song/${encodeName(next.name)}`;
          console.log("🎙 Voice track detected");
          i++; // skip VT in loop
        }

        await mixTracks({
          music: musicUrl,
          next: nextUrl,
          voice: voiceUrl,
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

start();
