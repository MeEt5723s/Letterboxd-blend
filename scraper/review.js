const API_BASE_URL = "https://letterboxd-blend-backend-en2i.onrender.com";
const reviewCache = new Map();

export async function getUserReview(username, slug, reviewUrl) {
  const cacheKey = `${username}:${slug}`;

  if (reviewCache.has(cacheKey)) {
    return reviewCache.get(cacheKey);
  }

  let url = `${API_BASE_URL}/users/${encodeURIComponent(username)}/review?slug=${encodeURIComponent(slug)}`;
  if (reviewUrl) {
    url += `&url=${encodeURIComponent(reviewUrl)}`;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      reviewCache.set(cacheKey, null);
      return null;
    }
    const data = await response.json();
    const text = data.review;
    reviewCache.set(cacheKey, text);
    return text;
  } catch (e) {
    console.error(e);
    reviewCache.set(cacheKey, null);
    return null;
  }
}