const TMDB_API_KEY = "caaba2a8686cdefda89210da60097d41";
const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";


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
    // Check cache first
    const cached = getCachedMovie(title);

    if (cached) {
        console.log("Cache hit:", title);
        return cached;
    }

    console.log("TMDB request:", title);

    const query =
        `/search/movie?query=${encodeURIComponent(title)}` +
        (year ? `&year=${year}` : "");

    const data = await tmdbFetch(query);

    if (!data.results.length)
        return null;

    const movie = data.results[0];

    // Save to cache
    cacheMovie(title, movie);

    return movie;
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