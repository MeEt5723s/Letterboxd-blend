import { searchMovie, getPoster, getBackdrop, fetchLetterboxdBackdrop } from "../api/tmdb.js";

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
// Letterboxd sometimes serves this static placeholder as if it were the
// actual poster - it's a real, normally-sized image (so a tiny-pixel
// check alone won't catch it), it just isn't the movie's poster.
const LETTERBOXD_PLACEHOLDER_HINT = "empty-poster";

function isUsableScrapedPoster(src) {
    return !!src && !src.includes(LETTERBOXD_PLACEHOLDER_HINT);
}

export function setPosterWithFallback(img, movie) {
    // Prefer the scraped poster only if it isn't Letterboxd's own
    // placeholder image; otherwise go straight to our own deterministic
    // CDN URL built from id + slug, which is far more reliable than
    // trusting whatever the scrape happened to pick up.
    const scrapedSrc = isUsableScrapedPoster(movie.poster) ? movie.poster : "";
    const primarySrc = scrapedSrc || buildPosterUrl(movie.id, movie.slug);

    img.onerror = () => applyPosterFallback(img, movie);

    img.onload = () => {
        const loadedSrc = img.currentSrc || img.src;

        // Anything at or below a few pixels wide is almost certainly a
        // lazy-load placeholder or tracking pixel, not an actual poster.
        // We also re-check the loaded URL itself, in case a redirect or
        // CDN fallback landed on Letterboxd's placeholder image, which
        // is a normal size and wouldn't be caught by naturalWidth alone.
        if (img.naturalWidth <= 4 || loadedSrc.includes(LETTERBOXD_PLACEHOLDER_HINT)) {
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

/**
 * Same letterboxd-first / tmdb-fallback shape as setPosterWithFallback,
 * but for backdrops. Unlike the poster, there's no deterministic CDN URL
 * we can build from id+slug alone - the letterboxd backdrop has to be
 * scraped from the film page (see /films/{slug}/backdrop on the API),
 * so this path is async all the way through rather than "set src and
 * let onerror handle it".
 */
export async function applyBackdropFallback(img, movie) {
    img.onerror = null;
    img.onload = null;

    try {
        const yearMatch = movie.slug?.match(/-(\d{4})(?:-\d+)?$/);
        const year = yearMatch ? yearMatch[1] : "";

        const tmdbMovie = await searchMovie(movie.title, year);
        if (tmdbMovie?.backdrop_path) {
            img.src = getBackdrop(tmdbMovie.backdrop_path);
        } else {
            // No letterboxd backdrop and no TMDB backdrop either - hide
            // rather than show a broken image.
            img.removeAttribute("src");
            img.style.display = "none";
        }
    } catch (e) {
        console.error(e);
        img.removeAttribute("src");
        img.style.display = "none";
    }
}

export async function setBackdropWithFallback(img, movie) {
    img.onerror = () => applyBackdropFallback(img, movie);
    img.onload = () => {
        if (img.naturalWidth <= 4) {
            applyBackdropFallback(img, movie);
        }
    };

    // Try the scraped Letterboxd backdrop first.
    try {
        const letterboxdBackdrop = await fetchLetterboxdBackdrop(movie.slug);
        if (letterboxdBackdrop) {
            img.src = letterboxdBackdrop;
            return;
        }
    } catch (e) {
        console.error(e);
    }

    // Letterboxd has nothing (or the request failed) - fall back to TMDB.
    await applyBackdropFallback(img, movie);
}