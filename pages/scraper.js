function buildPosterUrl(id, slug) {
  if (!id) return "";
  const digits = id.split("").join("/");
  const imageSlug = slug.replace(/-\d{4}(-\d+)?$/, "");
  return `https://a.ltrbxd.com/resized/film-poster/${digits}/${id}-${imageSlug}-0-150-0-225-crop.jpg`;
}

async function getUserFilms(username) {
  const movies = [];
  let page = 1;

  while (true) {
    const url = `https://letterboxd.com/${username}/films/page/${page}/`;

    const response = await fetch(url, { credentials: "include" });

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

  movies.push({
    id,
    slug,
    title,
    poster: posterUrl,
    rating
  });
});

    page++;
  }

  return movies;
}

// ---------- Following List ----------
// Scrapes https://letterboxd.com/<username>/following/ to list the
// accounts a user follows, for the "choose friends" picker.
// NOTE: based on Letterboxd's typical person-table markup — if this
// comes back empty, the selectors below may need adjusting to match
// the live page (inspect a .person-table row on /following/).
async function getFollowing(username) {
  const people = [];
  const seen = new Set();
  let page = 1;

  while (true) {
    const url = `https://letterboxd.com/${username}/following/page/${page}/`;

    const response = await fetch(url, { credentials: "include" });

    if (response.status === 404) break;

    if (response.status === 403) {
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    if (!response.ok) break;

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const rows = doc.querySelectorAll(
      ".person-table .table-person, .person-summary"
    );

    if (!rows.length) break;

    rows.forEach(row => {
      // Skip accounts flagged as deactivated/private if Letterboxd marks them
      if (row.querySelector(".deactivated, .private")) return;

      const link =
        row.querySelector("a.avatar[href]") ||
        row.querySelector("a.name[href]") ||
        row.querySelector("a[href]");

      if (!link) return;

      const href = link.getAttribute("href") || "";
      const match = href.match(/^\/([^\/]+)\/$/);

      if (!match) return;

      const handle = match[1];

      if (seen.has(handle)) return;
      seen.add(handle);

      const nameEl = row.querySelector(".name");
      const displayName = nameEl?.textContent.trim() || handle;

      const avatarImg = row.querySelector("img");
      const avatar = avatarImg?.src || null;

      people.push({ username: handle, displayName, avatar });
    });

    page++;
  }

  return people;
}