const API_BASE_URL = "http://localhost:8000";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

import {
    getCachedMovie,
    cacheMovie
} from "../cache/metadataCache.js";

export async function searchMovie(title, year = "") {
    title = title.replace(/\s*\(\d{4}\)$/, "");
    const cacheKey = year ? `${title}::${year}` : title;

    // Check cache first
    const cached = getCachedMovie(cacheKey);
    if (cached) {
        return cached;
    }

    const url = `${API_BASE_URL}/tmdb/search?title=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMDB proxy request failed (${response.status})`);
    }
    const movie = await response.json();

    if (movie) {
        cacheMovie(cacheKey, movie);
    }
    return movie;
}

export function getPoster(path) {
    if (!path)
        return "images/noPoster.png";
    return IMAGE_BASE + path;
}

export function getBackdrop(path) {
    if (!path)
        return null;
    return BACKDROP_BASE + path;
}