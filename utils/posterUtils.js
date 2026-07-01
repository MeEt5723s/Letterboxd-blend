import { searchMovie, getPoster } from "../api/tmdb.js";

export function buildPosterUrl(id, slug) {

    if (!id) return "";

    const digits = id.split("").join("/");

    const imageSlug =
        slug.replace(/-\d{4}(-\d+)?$/, "");

    return `https://a.ltrbxd.com/resized/film-poster/${digits}/${id}-${imageSlug}-0-150-0-225-crop.jpg`;
}

export async function applyPosterFallback(img, movie) {
    img.onerror = null;

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