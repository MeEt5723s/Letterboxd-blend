import { searchMovie, getPoster } from "../api/tmdb.js";

export function buildPosterUrl(id, slug) {

    if (!id || !slug) return "";

    const digits = String(id).split("").join("/");

    const imageSlug =
        slug.replace(/-\d{4}(-\d+)?$/, "");

    return `https://a.ltrbxd.com/resized/film-poster/${digits}/${id}-${imageSlug}-0-150-0-225-crop.jpg`;
}

export async function applyPosterFallback(img, movie) {
    // Clear both handlers so the fallback image itself (or the TMDB image)
    // doesn't re-trigger this logic in a loop.
    img.onerror = null;
    img.onload = null;

    try {

        const yearMatch =
            movie.slug?.match(/-(\d{4})(?:-\d+)?$/);

        const year =
            yearMatch ? yearMatch[1] : "";

        const tmdbMovie =
            await searchMovie(
                movie.title,
                year
            );
        if (tmdbMovie?.poster_path) {

            img.src =
                getPoster(tmdbMovie.poster_path);

        } else {

            img.src =
                "https://s.ltrbxd.com/static/img/empty-poster-230.png";

        }

    } catch (e) {

        console.error(e);

        img.src =
            "https://s.ltrbxd.com/static/img/empty-poster-230.png";

    }

}

/**
 * Sets an <img>'s poster with a fallback chain, and — importantly —
 * attaches the load/error handlers BEFORE setting src. This avoids two
 * separate failure modes:
 *
 * 1. Race condition: if `src` is set first and the image fails fast
 *    (e.g. cached 404), the error can fire before `onerror` is attached,
 *    so the fallback silently never runs.
 * 2. Blank/lazy-load placeholder: Letterboxd's scraped poster URL
 *    sometimes resolves to a 1x1 placeholder pixel rather than a real
 *    404. That "succeeds" as far as the browser is concerned (onerror
 *    never fires) but nothing visible is shown. We catch this by
 *    checking naturalWidth once the image loads.
 */
export function setPosterWithFallback(img, movie) {
    const primarySrc = movie.poster || buildPosterUrl(movie.id, movie.slug);

    img.onerror = () => applyPosterFallback(img, movie);

    img.onload = () => {
        // A real poster should never be this small. Anything at or below
        // a couple of pixels wide is almost certainly a lazy-load
        // placeholder or tracking pixel, not an actual poster.
        if (img.naturalWidth <= 2) {
            applyPosterFallback(img, movie);
        }
    };

    if (!primarySrc) {
        // Nothing usable to try first — go straight to the fallback chain.
        applyPosterFallback(img, movie);
        return;
    }

    img.src = primarySrc;
}