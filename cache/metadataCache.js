const movieCache = new Map();

/**
 * Returns a cached movie if available.
 */
export function getCachedMovie(title) {

    return movieCache.get(title.toLowerCase()) || null;

}

/**
 * Stores a movie inside the cache.
 */
export function cacheMovie(title, movieData) {

    movieCache.set(
        title.toLowerCase(),
        movieData
    );

}

/**
 * Checks whether a movie exists in cache.
 */
export function hasMovie(title) {

    return movieCache.has(
        title.toLowerCase()
    );

}

/**
 * Clears the cache.
 */
export function clearCache() {

    movieCache.clear();

}

/**
 * Returns the number of cached movies.
 */
export function cacheSize() {

    return movieCache.size;

}