const API_BASE_URL = "http://localhost:8000";

export async function getFollowing(username) {
  const url = `${API_BASE_URL}/users/${encodeURIComponent(username)}/following`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch user following list from API (${response.status})`);
  }
  const data = await response.json();
  return data.following || [];
}