function buildPosterUrl(id, slug) {
  if (!id) return "";
  const digits = id.split("").join("/");
  const imageSlug = slug.replace(/-\d{4}(-\d+)?$/, "");
  return `https://a.ltrbxd.com/resized/film-poster/${digits}/${id}-${imageSlug}-0-150-0-225-crop.jpg`;
}

export async function getUserFilms(username, onProgress) {
  const movies = [];
  let page = 1;

  while (true) {
    const url = `https://letterboxd.com/${username}/films/page/${page}/`;

    const response = await fetch(
    `${url}?_=${Date.now()}`,
    {
        credentials: "include",
        cache: "no-store"
    }
);

    if (response.status === 404) break;

    if (response.status === 403) {
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    if (!response.ok) break;

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const posters = doc.querySelectorAll(".react-component[data-item-slug]");

    if (!posters.length) break;
posters.forEach((poster) => {
  const slug = poster.dataset.itemSlug;
  const title =
    poster.dataset.itemName || slug;

  const img =
    poster.querySelector(".poster img");

  const posterUrl =
    img?.src ||
    img?.getAttribute("srcset")?.split(" ")[0] ||
    "";

  let id = null;

  try {
    const identifier = JSON.parse(
      poster.dataset.posteredIdentifier
    );

    id = identifier.uid.replace(
      "film:",
      ""
    );
  } catch {}

  // ---------- Rating ----------
  let rating = null;

  const gridItem =
    poster.closest(".griditem");

  const ratingEl =
    gridItem?.querySelector(
      ".poster-viewingdata .rating"
    );

  if (ratingEl) {
    const ratingClass =
      [...ratingEl.classList]
        .find(c =>
          c.startsWith("rated-")
        );

    if (ratingClass) {
      rating =
        parseInt(
          ratingClass.replace(
            "rated-",
            ""
          )
        ) / 2;
    }
  }

  // ---------- Liked (heart) ----------
  // NOTE: Letterboxd marks a hearted film with a "liked"/"icon-liked"
  // element inside .poster-viewingdata — if this stops matching, inspect
  // a hearted film's markup on a /films/ page and adjust the selector.
  const liked = !!gridItem?.querySelector(
    ".poster-viewingdata .icon-liked, .poster-viewingdata .like"
  );

  // ---------- Review ----------
  // NOTE: same caveat as above — Letterboxd shows a small review icon
  // link inside .poster-viewingdata when the user wrote a review.
  const reviewEl = gridItem?.querySelector(
    ".poster-viewingdata .icon-review, .poster-viewingdata [class*='review']"
  );

  const reviewed = !!reviewEl;

  // Prefer the actual href Letterboxd gives us for this specific log
  // entry (important for rewatches — the generic /film/slug/ page only
  // reflects the latest entry and can miss the one with the review).
  const reviewAnchor =
    reviewEl?.tagName === "A" ? reviewEl : reviewEl?.closest("a");

  const reviewHref = reviewAnchor?.getAttribute("href") || null;

  const reviewUrl = reviewHref
    ? new URL(reviewHref, "https://letterboxd.com").href
    : reviewed
    ? `https://letterboxd.com/${username}/film/${slug}/`
    : null;

  movies.push({
    id,
    slug,
    title,
    poster: posterUrl,
    rating,
    liked,
    reviewed,
    reviewUrl
  });
});

    if (onProgress) onProgress(movies.length);

    page++;
  }
  return movies;
}