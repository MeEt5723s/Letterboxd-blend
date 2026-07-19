const API_BASE_URL = "https://letterboxd-blend-backend-en2i.onrender.com";

/**
 * Fetches a user's full film list, reporting a live-updating count via
 * onProgress as pages come in from the backend (server-sent events),
 * instead of only knowing anything once the entire scrape is done.
 *
 * Falls back to the plain one-shot endpoint if EventSource isn't
 * available in this environment (shouldn't happen in a real browser,
 * but keeps things from hard-failing anywhere weird SSE support is
 * missing).
 */
export function getUserFilms(username, onProgress) {
  if (typeof EventSource === "undefined") {
    return getUserFilmsFallback(username);
  }

  return new Promise((resolve, reject) => {
    const url = `${API_BASE_URL}/users/${encodeURIComponent(username)}/films/stream`;
    const source = new EventSource(url);
    let settled = false;

    const cleanup = () => {
      source.close();
    };

    source.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (e) {
        return; // Malformed chunk - ignore and wait for the next one.
      }

      if (payload.error) {
        settled = true;
        cleanup();
        reject(new Error(payload.detail || `Failed to fetch films for ${username}`));
        return;
      }

      if (typeof payload.count === "number" && onProgress) {
        onProgress(payload.count);
      }

      if (payload.done) {
        settled = true;
        cleanup();
        resolve(payload.films || []);
      }
    };

    source.onerror = () => {
      // EventSource fires onerror on the connection dropping too, not
      // just on genuine failures, but if we already resolved/rejected
      // via a "done"/"error" message, there's nothing left to do here.
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Connection lost while fetching films for ${username}`));
    };
  });
}

async function getUserFilmsFallback(username) {
  const url = `${API_BASE_URL}/users/${encodeURIComponent(username)}/films`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch films for ${username} (${response.status})`);
  }
  const data = await response.json();
  return data.films || [];
}