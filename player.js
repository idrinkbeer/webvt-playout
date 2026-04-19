import fetch from "node-fetch";
import { spawn } from "child_process";

const API = process.env.API_BASE;
const TOKEN = process.env.TOKEN;

let currentProcess = null;

async function getSongs() {
  console.log("Fetching songs...");

  const res = await fetch(`${API}/music`, {
    headers: {
      Authorization: "Bearer " + TOKEN
    }
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("API ERROR:", res.status, text);
    throw new Error("API request failed");
  }

  const data = await res.json();

  // ✅ your API returns array directly
  return data || [];
}

async function updateNowPlaying(song) {
  try {
    await fetch(`${API}/played`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + TOKEN
      },
      body: JSON.stringify({
        artist: song.artist,
        title: song.title,
        startTime: new Date().toISOString(),
        duration: 0
      })
    });
  } catch (err) {
    console.error("Now playing update failed:", err);
  }
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

    currentProcess.on("error", (err) => {
      console.error("FFplay error:", err);
      resolve();
    });
  });
}

async function start() {
  while (true) {
    try {
      const songs = await getSongs();

      if (!songs.length) {
        console.log("⚠️ No songs found");
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      for (const name of songs) {
        const url = `${API}/audio/song/${encodeURIComponent(name)}`;

        await updateNowPlaying({
          artist: "Unknown",
          title: name
        });

        await playFile(url);
      }

    } catch (err) {
      console.error("Playback error:", err);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

start();
