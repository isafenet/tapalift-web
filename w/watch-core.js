// Watch me home by a link: the page's own workings, apart from the page so Node can test them against what the phone
// seals (relay/test/watchlink.test.js; the format is in docs/sync-protocol.md section 17 and TapaliftSeal's WatchLink).
// Jay, 18 Oct 2026.
//
// The key is after the # in the link, which the browser never sends anywhere. From it: the id the update is kept under
// (SHA-256 of "tapalift-watch-link-v1" and the key, its first 16 bytes as hex), and the key that opens it (AES-256-GCM,
// the key itself, with "tapalift-watch-link-v1\n" and the id as associated data).

const label = "tapalift-watch-link-v1";

export function fromBase64url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/// The key from the link's fragment ("#AAEC…"), or null if it isn't one.
export function keyFromFragment(fragment) {
  const key = fromBase64url((fragment ?? "").replace(/^#/, ""));
  return key && key.length === 32 ? key : null;
}

export async function linkID(key) {
  const bytes = new Uint8Array([...new TextEncoder().encode(label), ...key]);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/// The update, opened: or null if it doesn't open with this key.
export async function openUpdate(sealedText, key) {
  const sealed = fromBase64url(sealedText);
  if (!sealed || sealed.length < 28) return null;
  const id = await linkID(key);
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.slice(0, 12), additionalData: new TextEncoder().encode(`${label}\n${id}`), tagLength: 128 },
      cryptoKey, sealed.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

function minutesUntil(seconds, now) { return Math.max(0, Math.ceil((seconds - now) / 60)); }

export function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${Math.floor(minutes / 60)} hr` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

export function ago(seconds, now) {
  const minutes = Math.floor((now - seconds) / 60);
  return minutes < 1 ? "just now" : `${duration(minutes)} ago`;
}

/// The words, as the app says them (TapaliftCore's WatchMeHomeText): names, not pronouns; calm.
/// `time` turns seconds since 1970 into "21:18".
export function describe(update, now, time) {
  const name = update.n;
  const last = update.p.length ? update.p[update.p.length - 1] : null;
  switch (update.s) {
    case "arrived":
      return { title: update.h ? `${name} is home` : `${name} is at ${update.d}`, line: "Sharing stopped.", over: true };
    case "stopped":
      return { title: `${name} stopped Watch me home`, line: "Sharing stopped.", over: true };
    case "timedOut":
      return { title: `Watch me home for ${name} ended after 2 hours`, line: "Sharing stopped.", over: true };
  }
  const seen = last ? `Last seen ${ago(last[3], now)}.` : `No position from ${name}'s phone yet.`;
  if (update.s === "late" || now >= update.alert) {
    return {
      title: update.h ? `${name} hasn't got home yet` : `${name} hasn't got to ${update.d} yet`,
      line: `${seen} Try calling ${name}.`, late: true,
    };
  }
  const due = minutesUntil(update.due, now);
  return {
    title: update.h ? `${name} is on the way home` : `${name} is on the way to ${update.d}`,
    line: due === 0 ? `Due now. ${seen}` : `${duration(due)} to ${update.h ? "Home" : update.d} · due about ${time(update.due)}. ${seen}`,
  };
}
