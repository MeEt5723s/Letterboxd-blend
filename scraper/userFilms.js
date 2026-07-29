import { API_BASE_URL } from "../config.js";

/**
 * Fetches just a user's real film COUNT (not the film list itself), via
 * GET /users/{username}/profile - a single cheap page, on the backend's
 * dedicated fast lane, never queued behind bulk film/watchlist pagination.
 *
 * Exported separately (rather than folded into getUserFilms below) so
 * callers rendering MULTIPLE users at once - e.g. blend.js's loading
 * screen - can fire this for every user in parallel, wait for all of them,
 * and reveal every counter at the same instant. Calling it per-user
 * on-the-fly the moment each one resolves makes counters pop in staggered
 * by network timing instead of together.
 *
 * Returns null (not a throw) on any failure - callers should treat that as
 * "no early count available for this user," not a hard error.
 */
export async function getFilmCount(username) {
  try {
    const url = `${API_BASE_URL}/users/${encodeURIComponent(username)}/films/count`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const count = Number(data.count);
    return Number.isFinite(count) ? count : null;
  } catch (e) {
    // Non-fatal: no early count to animate toward, but the real /films
    // fetch below still runs and resolves normally either way.
    return null;
  }
}

/**
 * Fetches a user's full film list. onProgress, if given, is called once
 * with the exact real count when the list lands - useful as a final
 * correction after getFilmCount()'s earlier estimate (Letterboxd's
 * headline stat can drift slightly from the actual scraped list, e.g.
 * private/unrated entries).
 */
export async function getUserFilms(username, onProgress) {
  const films = await getUserFilmsList(username);
  if (onProgress) onProgress(films.length);
  return films;
}

async function getUserFilmsList(username) {
  const url = `${API_BASE_URL}/users/${encodeURIComponent(username)}/films`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch films for ${username} (${response.status})`);
  }
  const data = await response.json();
  return data.films || [];
}