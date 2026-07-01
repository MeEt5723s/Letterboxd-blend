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