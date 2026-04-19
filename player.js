import fetch from "node-fetch";
import { spawn } from "child_process";

const API = process.env.API_BASE;
const TOKEN = process.env.TOKEN;

let currentProcess = null;

async function getSongs() {
  const res = await fetch(`${API}/api/library?type=music`, {
    headers: {
      Authorization: "Bearer " + TOKEN
    }
  });

  // 🔥 debug response
  if (!res.ok) {
    const text = await res.text();
    console.error("API ERROR:", res.status, text);
    throw new Error("API request failed");
  }

  const data = await res.json();
  return data.items || [];
}

async function updateNowPlaying(song) {
  await fetch(`${API}/api/played`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + TOKEN   // 🔥 REQUIRED
    },
    body: JSON.stringify({
      artist: song.artist,
      title: song.title,
      startTime: new Date().toISOString(),
      duration: 0
    })
  });
}

function playFile(url) {
  return new Promise((resolve) => {
    console.log("▶ Playing:", url);

    currentProcess = spawn("ffplay", [
      "-nodisp",
      "-autoexit",
      url
    ]);

    currentProcess.on("exit", () => {
      resolve();
    });
  });
}

async function start() {
  while (true) {
    try {
      const songs = await getSongs();

      for (const song of songs) {
        const url = `${API}/api/audio/song/${encodeURIComponent(song.name)}`;

        await updateNowPlaying(song);
        await playFile(url);
      }

    } catch (err) {
      console.error("Playback error:", err);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

start();


console.log("Fetching songs...");
