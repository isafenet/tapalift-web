// Watch me home by a link: the page (Jay, 18 Oct 2026). Fetches the sealed update every 15 seconds, opens it here,
// and draws where they've been. Stops when the watch is over (or gone: the service deletes it at the end).
import { describe, keyFromFragment, linkID, openUpdate } from "./watch-core.js";

const service = "https://tapalift-relay.isafenet-feedback.workers.dev";
const $ = (id) => document.getElementById(id);
const time = (seconds) => new Date(seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
let streetMap = false;
let last = null;

function say(title, line, late = false) {
  $("title").textContent = title;
  $("line").textContent = line;
  $("card").classList.toggle("late", late);
  document.title = `${title} · Tapalift`;
}

// Web Mercator, in pixels at a zoom.
function project(lat, lon, zoom) {
  const scale = 256 * 2 ** zoom, sin = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
}

function draw(points) {
  const box = $("map").getBoundingClientRect(), width = box.width || 340, height = box.height || 320;
  const lats = points.map((p) => p[0]), lons = points.map((p) => p[1]);
  // The closest zoom that fits the whole line with room round it (street level at most).
  let zoom = 17;
  while (zoom > 3) {
    const [x1, y1] = project(Math.max(...lats), Math.min(...lons), zoom), [x2, y2] = project(Math.min(...lats), Math.max(...lons), zoom);
    if (x2 - x1 < width * 0.7 && y2 - y1 < height * 0.7) break;
    zoom -= 1;
  }
  const now = points[points.length - 1];
  const [cx, cy] = project(now[0], now[1], zoom);
  const left = cx - width / 2, top = cy - height / 2;
  const xy = (p) => { const [x, y] = project(p[0], p[1], zoom); return [x - left, y - top]; };
  const path = points.map((p, i) => `${i ? "L" : "M"}${xy(p).map((v) => v.toFixed(1)).join(" ")}`).join(" ");
  const [dx, dy] = xy(now);
  // The rough part: how sure the phone was, as a circle round the dot.
  const metresPerPixel = (156543.03 * Math.cos((now[0] * Math.PI) / 180)) / 2 ** zoom;
  const radius = Math.max(10, Math.min(now[2] / metresPerPixel, 120));
  $("trail").innerHTML =
    `<path d="${path}" fill="none" stroke="#1F6FEB" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>` +
    `<circle cx="${dx}" cy="${dy}" r="${radius}" fill="#1F6FEB" opacity="0.12"/>` +
    `<circle cx="${dx}" cy="${dy}" r="11" fill="#FFC21A" stroke="#12161C" stroke-width="3"/>`;
  const tiles = $("tiles");
  tiles.textContent = "";
  if (!streetMap) return;
  // Only when asked: the street map's tiles from OpenStreetMap (images, no script), round where they are.
  const first = [Math.floor(left / 256), Math.floor(top / 256)], lastTile = [Math.floor((left + width) / 256), Math.floor((top + height) / 256)];
  for (let x = first[0]; x <= lastTile[0]; x++) {
    for (let y = first[1]; y <= lastTile[1]; y++) {
      const img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
      img.style.left = `${x * 256 - left}px`;
      img.style.top = `${y * 256 - top}px`;
      tiles.appendChild(img);
    }
  }
}

async function main() {
  const key = keyFromFragment(location.hash);
  if (!key) return say("This link isn't complete", "Ask for the link again: the part after # is missing.");
  const id = await linkID(key);
  $("street").addEventListener("click", () => {
    streetMap = !streetMap;
    $("street").textContent = streetMap ? "Hide the street map" : "Show the street map";
    if (last) draw(last);
  });
  let timer;
  const tick = async () => {
    let answer;
    try {
      answer = await fetch(`${service}/v2/watch-links/${id}`, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    } catch {
      say($("title").textContent === "Opening…" ? "Can't reach Tapalift" : $("title").textContent, "No connection just now. Trying again…");
      return;
    }
    if (answer.status === 404) {
      clearInterval(timer);
      $("map").hidden = true;
      $("buttons").hidden = true;
      return say("This watch has ended", "Sharing stopped. Nothing more is shown here.");
    }
    if (!answer.ok) return;
    const { sealed } = await answer.json();
    const update = await openUpdate(sealed, key);
    if (!update) return say("This link doesn't open", "Ask for the link again.");
    const now = Date.now() / 1000;
    const words = describe(update, now, time);
    say(words.title, words.line, words.late === true);
    if (words.over || !update.p.length) {
      $("map").hidden = true;
      $("buttons").hidden = true;
      if (words.over) clearInterval(timer);
      return;
    }
    last = update.p;
    $("map").hidden = false;
    $("buttons").hidden = false;
    const [lat, lon] = update.p[update.p.length - 1];
    $("apple").href = `https://maps.apple.com/?daddr=${lat},${lon}`;
    $("google").href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    draw(update.p);
  };
  await tick();
  timer = setInterval(tick, 15000);
}

main();
