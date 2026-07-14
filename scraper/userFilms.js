const API_BASE_URL = "http://localhost:8000";

export async function getUserFilms(username, onProgress) {
  const url = `${API_BASE_URL}/users/${encodeURIComponent(username)}/films`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch user films from API (${response.status})`);
  }
  const data = await response.json();
  const films = data.films || [];
  if (onProgress) {
    onProgress(films.length);
  }
  return films;
}