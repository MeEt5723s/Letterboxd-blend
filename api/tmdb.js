const TMDB_API_KEY = "caaba2a8686cdefda89210da60097d41";
const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";


import {
    getCachedMovie,
    cacheMovie
} from "../cache/metadataCache.js";


async function tmdbFetch(endpoint) {
    const url =
        `${BASE_URL}${endpoint}` +
        `${endpoint.includes("?") ? "&" : "?"}` +
        `api_key=${TMDB_API_KEY}`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`TMDB request failed (${response.status})`);
    }

    return response.json();
}

export async function searchMovie(title, year = "") {

    title = title.replace(/\s*\(\d{4}\)$/, "");

    // Cache key includes the year so different films that share a title
    // (remakes, sequels-in-name-only, etc.) don't collide with each
    // other in the cache.
    const cacheKey = year ? `${title}::${year}` : title;

    // Check cache first
    const cached = getCachedMovie(cacheKey);

    if (cached) {
        return cached;
    }


    const query =
        `/search/movie?query=${encodeURIComponent(title)}` +
        (year ? `&year=${year}` : "");

    const data = await tmdbFetch(query);

    if (!data.results.length)
        return null;

    // TMDB's `year` param only nudges ranking, it doesn't filter — so
    // the top result can still be the wrong film (e.g. a more popular
    // same-titled movie from a different year). Prefer an exact
    // title+year match, then any exact-year match, then an exact title
    // match, before falling back to TMDB's own top pick.
    const movie = pickBestMatch(data.results, title, year);

    // Save to cache
    cacheMovie(cacheKey, movie);

    return movie;
}

function pickBestMatch(results, title, year) {

    const normalize = s =>
        (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const target = normalize(title);

    if (year) {

        const titleAndYear = results.find(r =>
            r.release_date?.slice(0, 4) === year &&
            normalize(r.title) === target
        );
        if (titleAndYear) return titleAndYear;

        const yearOnly = results.find(
            r => r.release_date?.slice(0, 4) === year
        );
        if (yearOnly) return yearOnly;

    }

    const titleOnly = results.find(r => normalize(r.title) === target);
    if (titleOnly) return titleOnly;

    return results[0];

}

export async function getMovie(id) {

    return await tmdbFetch(
        `/movie/${id}?append_to_response=credits,keywords`
    );

}

export async function getRecommendations(movieId) {

    const data =
        await tmdbFetch(`/movie/${movieId}/recommendations`);

    return data.results;

}

export async function getSimilar(movieId) {

    const data =
        await tmdbFetch(`/movie/${movieId}/similar`);

    return data.results;

}

let genreCache = null;

export async function getGenres() {

    if (genreCache)
        return genreCache;

    const data =
        await tmdbFetch("/genre/movie/list");

    genreCache = {};

    for (const genre of data.genres) {
        genreCache[genre.id] = genre.name;
    }

    return genreCache;

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

// Returns the country-keyed watch-provider map for a movie, e.g.
// { US: { link, flatrate: [...], rent: [...], buy: [...] }, IN: {...}, ... }
export async function getWatchProviders(movieId) {

    try {

        const data =
            await tmdbFetch(`/movie/${movieId}/watch/providers`);

        return data.results || {};

    } catch (e) {

        return {};

    }

}

export async function getKeywords(movieId) {

    const data =
        await tmdbFetch(`/movie/${movieId}/keywords`);

    return data.keywords;

}

export async function fetchMovieData(movieTitles) {

    const movies = [];

    for (const title of movieTitles) {

        try {

            const movie = await searchMovie(title);

            if(movie)
                movies.push(movie);

        } catch(e) {
            console.log(title, e);
        }
    }

    return movies;

}