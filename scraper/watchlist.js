const API_BASE_URL = "http://localhost:8000";

export async function getWatchlist(username) {
  const url = `${API_BASE_URL}/users/${encodeURIComponent(username)}/watchlist`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch user watchlist from API (${response.status})`);
  }
  const data = await response.json();
  return data.watchlist || [];
}