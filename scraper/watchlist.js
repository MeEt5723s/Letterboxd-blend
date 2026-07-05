export async function getWatchlist(username) {
  const movies = [];
  let page = 1;

  while (true) {
    const url = `https://letterboxd.com/${username}/watchlist/page/${page}/`;

    const response = await fetch(`${url}?_=${Date.now()}`, {
      credentials: "include",
      cache: "no-store"
    });

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

    posters.forEach(poster => {
      const slug = poster.dataset.itemSlug;
      const title = poster.dataset.itemName || slug;

      const img = poster.querySelector(".poster img");

      const posterUrl =
        img?.src ||
        img?.getAttribute("srcset")?.split(" ")[0] ||
        "";

      let id = null;

      try {
        const identifier = JSON.parse(poster.dataset.posteredIdentifier);
        id = identifier.uid.replace("film:", "");
      } catch {}

      movies.push({ id, slug, title, poster: posterUrl });
    });

    page++;
  }

  return movies;
}