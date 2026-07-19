// ---------- Setup & State ----------

const USER_COLORS = [
  "#00e054", "#40bcf4", "#ff8000", "#ff4081",
  "#b388ff", "#ffd740", "#ff5252", "#69f0ae"
];
import { getUserFilms } from "../scraper/userFilms.js";
import { getFollowing } from "../scraper/following.js";
import { getWatchlist } from "../scraper/watchlist.js";
import { getUserReview } from "../scraper/review.js";
import { searchMovie, getBackdrop } from "../api/tmdb.js";
import { setPosterWithFallback } from "../utils/posterUtils.js";
import {
  computeCommonWatchlist,
  computePairwise,
  computeRatingSimilarity,
  computeSharedScore,
  computeConfidence,
  ratingSpread,
  compareByYear
} from "../engine/compatibility.js";

function colorFor(username) {
  const i = users.indexOf(username);
  return USER_COLORS[i % USER_COLORS.length];
}

function getUsersFromUrl() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("users")) {
    return params
      .get("users")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
  }

  // legacy support: ?u1=&u2=&u3=...
  const legacy = [];
  let i = 1;

  while (params.get("u" + i)) {
    legacy.push(params.get("u" + i));
    i++;
  }

  return legacy;
}

function updateUrl() {
  const params = new URLSearchParams(window.location.search);

  params.set("users", users.join(","));

  for (let i = 1; params.has("u" + i); i++) {
    params.delete("u" + i);
  }

  history.replaceState(
    null,
    "",
    `${location.pathname}?${params.toString()}`
  );
}

let users = getUsersFromUrl();
// The original owner (page loader), kept around even if they remove
// themselves from the comparison — used e.g. to fetch "following" list.
const ownerUsername = users[0];
const userData = {}; // username -> { films, avatar }
let sharedMode = "all"; // "all" | "any"
let movieSearchQuery = "";
let movieSortMode = "default";
let lastSharedMovies = []; // base (agreement-sorted) list before search/sort applied

// Insight data, recomputed on every recomputeAndRender() but only rendered
// into the shared insight modal lazily, when its corresponding tab is
// clicked (or live-refreshed if that modal happens to already be open).
let latestAgreements = [];
let latestDisagreements = [];
let latestLoved = [];
let latestIncomplete = [];
let latestPairwiseMatrix = [];

// Loading-screen feedback timers (declared here, not near their
// functions below, since the main IIFE further down calls
// loadAllUsers() immediately and would otherwise hit these while
// still in their temporal dead zone).
let messageRotationTimer = null;
let progressTrickleTimer = null;

// Tracks in-flight animations for the live per-user film count, keyed by
// user index - see animateLoadingCount() below.
const loadingCountAnimations = {};

// Friends added via the "Add Friend" flow that haven't been fetched
// and folded into the comparison yet — they only become part of
// `userData` / the rendered comparison once "Compare" is clicked.
let pendingFriends = [];

document.getElementById("users").innerHTML = renderUserChips();

function renderUserChips() {
  // Keep at least 2 people in the comparison — below that there's
  // nothing left to "blend", so hide the remove button once we're
  // down to the minimum.
  const canRemove = users.length > 2;

  return users
    .map(u => {
      const pending = pendingFriends.includes(u);

      return `<span class="user-chip${
        pending ? " pending-chip" : ""
      }" style="color:${colorFor(u)}">${u}${
        pending ? ' <small class="pending-label">(pending)</small>' : ""
      }${
        canRemove
          ? `<button type="button" class="remove-chip-btn" data-username="${u}" title="Remove ${u} from comparison">✕</button>`
          : ""
      }</span>`;
    })
    .join('<span class="user-sep"> × </span>');
}

// Delegated so it keeps working across every re-render of #users
// (renderUserChips() replaces innerHTML each time).
document.getElementById("users").addEventListener("click", e => {
  const btn = e.target.closest(".remove-chip-btn");
  if (!btn) return;

  removeFriend(btn.dataset.username);
});

// ---------- Main Flow ----------

(async () => {
  await loadAllUsers(users);
  recomputeAndRender();
  finishLoading();
})();

async function loadAllUsers(usernames) {
  updateLoading(10);
  buildLoadingAvatars(usernames);
  startLoadingFeedback();
  startProgressTrickle(10, 85);

  await fetchUsersWithProgress(usernames);

  stopLoadingMessageRotation();
  stopProgressTrickle();
  updateLoading(95);
}

// Fetches avatars and film lists for a batch of usernames, filling in
// userData as results come in. Avatars are requested independently of
// (usually much slower) film scraping, so all of them can pop in
// together almost instantly instead of being gated behind whichever
// user happens to have the biggest watchlist. Film progress is reported
// live per-user via a running count.
async function fetchUsersWithProgress(usernames) {
  const avatarWork = usernames.map(async (u, i) => {
    const avatar = await getAvatar(u);

    if (userData[u]) {
      userData[u].avatar = avatar;
    } else {
      userData[u] = { films: [], avatar };
    }

    setLoadingAvatar(i, avatar);
  });

  const filmWork = usernames.map(async (u, i) => {
    const films = await getUserFilms(u, count => setLoadingCount(i, count));

    if (userData[u]) {
      userData[u].films = films;
    } else {
      userData[u] = { films, avatar: null };
    }
  });

  const watchlistWork = usernames.map(async u => {
    const watchlist = await getWatchlist(u);

    if (userData[u]) {
      userData[u].watchlist = watchlist;
    } else {
      userData[u] = { films: [], avatar: null, watchlist };
    }
  });

  await Promise.all([...avatarWork, ...filmWork, ...watchlistWork]);
}

function buildLoadingAvatars(usernames) {
  const container = document.getElementById("loading-users-list");
  container.innerHTML = "";

  usernames.forEach((u, i) => {
    const div = document.createElement("div");
    div.className = "loading-user";

    div.innerHTML = `
      <div class="avatar-placeholder loading" id="avatar-${i}"></div>
      <p>${u}</p>
      <small class="loading-count" id="film-count-${i}"></small>
    `;

    container.appendChild(div);
  });
}

function setLoadingAvatar(index, avatarUrl) {
  const el = document.getElementById(`avatar-${index}`);
  if (!el) return;

  el.classList.remove("loading");

  if (!avatarUrl) return;

  el.style.backgroundImage = `url(${avatarUrl})`;
  el.style.backgroundSize = "cover";
  el.style.backgroundPosition = "center";
}

function setLoadingCount(index, count) {
  const el = document.getElementById(`film-count-${index}`);
  if (!el) return;

  // The backend reports counts in whole-page jumps (however many films
  // Letterboxd puts on one page), which would otherwise flash that exact
  // number at the viewer every update. Smoothly animate the displayed
  // value up to the real count instead of snapping to it, so it just
  // reads as "counting up," not "jumped by exactly 72."
  const target = Math.max(0, Number(count) || 0);
  const currentTarget = Number(el.dataset.target || 0);
  if (target < currentTarget) return; // never let the real count go backwards
  el.dataset.target = target;

  animateLoadingCount(index, el, target);
}

function animateLoadingCount(index, el, target) {
  const displayed = Number(el.dataset.displayed || 0);
  if (displayed === target) return;

  const existing = loadingCountAnimations[index];
  if (existing) cancelAnimationFrame(existing);

  const start = displayed;
  const delta = target - start;
  // Longer jumps get a longer animation (so a 72-film jump doesn't blast
  // by in one frame), but capped so it never feels sluggish.
  const duration = Math.min(1100, Math.max(350, delta * 14));
  const startTime = performance.now();

  const step = (now) => {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const value = Math.round(start + delta * eased);

    el.dataset.displayed = value;
    el.textContent = `${value} film${value === 1 ? "" : "s"} found`;

    if (progress < 1) {
      loadingCountAnimations[index] = requestAnimationFrame(step);
      return;
    }

    delete loadingCountAnimations[index];
    el.classList.remove("-pulse");
    void el.offsetWidth; // restart the pulse animation even mid-pulse
    el.classList.add("-pulse");
  };

  loadingCountAnimations[index] = requestAnimationFrame(step);
}

// ---------- Loading feedback (messages + progress trickle) ----------
// The real fetch duration is unknown up front (it depends entirely on
// how many films each user has), so instead of a progress bar that
// looks frozen, we trickle it forward continuously and rotate through
// a few status messages so the wait doesn't feel dead.

const LOADING_MESSAGES = [
  "Fetching films...",
  "Scrolling through years of movie nights...",
  "Big watchlists take a little longer...",
  "Matching ratings to films...",
  "Letterboxd pages don't scrape themselves...",
  "Almost there, hang tight..."
];

function startLoadingFeedback() {
  stopLoadingMessageRotation();

  const textEl = document.getElementById("loading-text");
  let i = 0;

  messageRotationTimer = setInterval(() => {
    i = (i + 1) % LOADING_MESSAGES.length;
    textEl.textContent = LOADING_MESSAGES[i];
  }, 3200);
}

function stopLoadingMessageRotation() {
  if (messageRotationTimer) {
    clearInterval(messageRotationTimer);
    messageRotationTimer = null;
  }
}

function startProgressTrickle(from, cap) {
  stopProgressTrickle();
  let value = from;

  progressTrickleTimer = setInterval(() => {
    if (value >= cap) return;

    value += Math.random() * 2 + 0.5;
    updateLoading(Math.min(value, cap));
  }, 400);
}

function stopProgressTrickle() {
  if (progressTrickleTimer) {
    clearInterval(progressTrickleTimer);
    progressTrickleTimer = null;
  }
}

function finishLoading() {
  stopLoadingMessageRotation();
  stopProgressTrickle();
  updateLoading(100);

  const loading = document.getElementById("loading-screen");

  if (loading) {
    setTimeout(() => {
      loading.style.display = "none";
    }, 500);
  }
}

// ---------- Data Aggregation ----------

function buildMovieMap() {
  const map = new Map();

  users.forEach(u => {
    const films = userData[u].films;

    films.forEach(f => {
      const key = f.id || f.slug;

      if (!map.has(key)) {
        map.set(key, {
          id: f.id,
          slug: f.slug,
          title: f.title,
          ratings: {},
          liked: {},
          reviewUrl: {}
        });
      }

      const entry = map.get(key);

      entry.ratings[u] = f.rating;

      if (f.liked) entry.liked[u] = true;
      if (f.reviewed && f.reviewUrl) entry.reviewUrl[u] = f.reviewUrl;
    });
  });

  return map;
}

function watchedBy(movie) {
  return Object.keys(movie.ratings);
}

function ratedByEntries(movie) {
  return Object.entries(movie.ratings).filter(
    ([, rating]) => rating != null
  );
}

function likedBy(movie) {
  return Object.keys(movie.liked || {});
}

// Watched-users first, then everyone else — used so preview/detail lists
// surface the people who actually watched the film before padding out
// with "not watched" entries.
function orderedUsersForMovie(movie) {
  const watchers = watchedBy(movie);
  return [...watchers, ...users.filter(u => !watchers.includes(u))];
}

function getSharedMovies(movieMap, mode) {
  const threshold = mode === "all" ? users.length : 2;

  return [...movieMap.values()].filter(
    m => watchedBy(m).length >= threshold
  );
}


// ---------- Compute + Render ----------

function recomputeAndRender() {
  const movieMap = buildMovieMap();
  const pairwise = computePairwise(users, movieMap);

  const validPairs = pairwise.filter(p => p.compatibility != null);

  const overallCompatibility =
    validPairs.length === 0
      ? 0
      : Math.round(
          validPairs.reduce((s, p) => s + p.compatibility, 0) /
            validPairs.length
        );

  const overallAvgDiff =
    validPairs.length === 0
      ? 0
      : validPairs.reduce((s, p) => s + p.avgDiff, 0) / validPairs.length;

  // Shared movies (mode-dependent)
  const sharedMovies = getSharedMovies(movieMap, sharedMode);
  const sharedCount = sharedMovies.length;

  document.getElementById("shared-count").textContent =
    `${sharedMovies.length} Shared Films`;

  document.getElementById("avg-difference").textContent =
    `Average rating difference: ${overallAvgDiff.toFixed(2)} ★`;

  const ratingSimilarity =
    validPairs.length === 0
        ? 0
        : Math.round(
            validPairs.reduce(
                (s,p)=>s+computeRatingSimilarity(p.avgDiff),
                0
            ) / validPairs.length
        );

const confidence =
    computeConfidence(sharedCount);

const sharedScore =
    computeSharedScore(sharedCount);

const finalCompatibility =
    Math.round(
        (
            ratingSimilarity * 0.60 +
            sharedScore * 0.40
        ) * confidence
    );

animateCompatibility(finalCompatibility);

  renderScoreBreakdown({
    ratingSimilarity,
    sharedScore,
    confidence,
    sharedCount,
    avgDiff: overallAvgDiff,
    finalCompatibility
  });

  // Toggle visibility of shared-movie mode switch
  const modeToggle = document.getElementById("shared-mode-toggle");
  if (users.length > 2) {
    modeToggle.classList.remove("hidden");
  } else {
    modeToggle.classList.add("hidden");
  }

  // Sort shared movies: best-agreement-first, partial ratings last
  const sortedShared = [...sharedMovies].sort((m1, m2) => {
    const spread1 = ratingSpread(m1);
    const spread2 = ratingSpread(m2);

    const s1 = spread1 == null ? 999 : spread1;
    const s2 = spread2 == null ? 999 : spread2;

    return s1 - s2;
  });

  lastSharedMovies = sortedShared;
  renderFilteredSortedMovies();

  // Insights need 2+ raters on a movie within the "all" shared set
  const ratedMovies = [...movieMap.values()].filter(
    m => ratedByEntries(m).length >= 2
  );

 const withSpread = ratedMovies
  .map(movie => ({
    movie,
    spread: ratingSpread(movie)
  }))
  .filter(x => x.spread != null);

const biggestAgreements = withSpread
  .filter(x => x.spread === 0)
  .sort((a, b) => {
    return ratedByEntries(b.movie).length - ratedByEntries(a.movie).length;
  })
  .map(x => x.movie);

const majorDisagreements = [...withSpread]
  .filter(x => x.spread >= 2)
  .sort((a, b) => {
    if (b.spread !== a.spread) {
      return b.spread - a.spread;
    }

    return ratedByEntries(b.movie).length - ratedByEntries(a.movie).length;
  })
  .map(x => x.movie);

latestAgreements = biggestAgreements;
  latestDisagreements = majorDisagreements;

  // Loved across the group: liked by 2+ people. For a two-person blend
  // that means both of them; for larger groups it's "at least two".
  const lovedMovies = [...movieMap.values()]
    .filter(m => likedBy(m).length >= 2)
    .sort((a, b) => likedBy(b).length - likedBy(a).length);

  latestLoved = lovedMovies;

  const watchTogether = computeCommonWatchlist(users, userData);
  renderWatchTogether(watchTogether);

  // Incomplete ratings: everyone watched, not everyone rated
  const incompleteRatings = [...movieMap.values()].filter(m => {
    const watched = watchedBy(m).length;
    const rated = ratedByEntries(m).length;
    return watched === users.length && rated > 0 && rated < users.length;
  });

  latestIncomplete = incompleteRatings;
  latestPairwiseMatrix = pairwise;

  refreshOpenInsightModal();
}



function notWatchedIcon() {
  return `<span class="not-watched-icon" title="Not watched">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round"
      stroke-linejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path>
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path>
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    </svg>
  </span>`;
}

function watchedIcon() {
  return `<span class="watched-icon" title="Watched, not yet rated">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round"
      stroke-linejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  </span>`;
}

function heartIcon() {
  return `<span class="liked-icon" title="Liked">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M12 21s-6.7-4.35-9.3-8.1C.8 10.1 1.4 6.6 4.4 5.1c2.2-1.1 4.6-.4 6 1.4a4.9 4.9 0 0 1 1.6 0c1.4-1.8 3.8-2.5 6-1.4 3 1.5 3.6 5 1.7 7.8C18.7 16.65 12 21 12 21z"></path>
    </svg>
  </span>`;
}

// Preview rows used in card contexts (grid, insights). Shows up to
// `limit` users (watchers first), then a "+n more" line so the card
// doesn't grow unbounded for big groups — click the poster for the
// full breakdown.
function userRatingRows(movie) {
  const ordered = orderedUsersForMovie(movie);
  const limit = ordered.length <= 3 ? ordered.length : 2;
  const shown = ordered.slice(0, limit);
  const remaining = ordered.length - shown.length;

  const rows = shown
    .map(u => {
      const watched = Object.prototype.hasOwnProperty.call(
        movie.ratings,
        u
      );

      const valueHtml = watched
        ? formatRating(movie.ratings[u])
        : notWatchedIcon();

      return `
        <span class="rating-row" style="color:${colorFor(u)}">
          <span class="rating-row-user">${u}</span>
          <span class="rating-row-value">${valueHtml}</span>
        </span>
      `;
    })
    .join("");

  const more =
    remaining > 0
      ? `<span class="rating-row ratings-more">+${remaining} more</span>`
      : "";

  return rows + more;
}

// Full per-user breakdown used in the movie detail modal: everyone
// (watchers first), with a heart for likes, and the review text (if
// any) shown as a quoted line directly under the row — no click,
// no separate box, loaded in automatically.
function renderDetailRatings(movie) {
  const ordered = orderedUsersForMovie(movie);

  return ordered
    .map(u => {
      const watched = Object.prototype.hasOwnProperty.call(
        movie.ratings,
        u
      );

      const valueHtml = watched
        ? formatRating(movie.ratings[u])
        : notWatchedIcon();

      const liked = movie.liked?.[u];
      const reviewUrl = movie.reviewUrl?.[u];

      return `
        <div class="detail-rating-block">
          <div class="detail-rating-row" style="color:${colorFor(u)}">
            <span class="detail-rating-user">
              ${u}${liked ? ` ${heartIcon()}` : ""}
            </span>
            <span class="detail-rating-value">
              ${valueHtml}
            </span>
          </div>
          ${
            reviewUrl
              ? `<p class="review-quote" data-panel-for="${u}"></p>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

// Fetches every review for this movie in parallel and fills each quote
// in as it arrives, so reviews are visible without any extra click.
function loadDetailReviews(movie) {
  const panels = movieDetailBody.querySelectorAll(".review-quote");

  panels.forEach(panel => {
    const username = panel.dataset.panelFor;

    getUserReview(username, movie.slug, movie.reviewUrl?.[username]).then(
      text => {
        if (!text) {
          panel.remove();
          return;
        }

        panel.textContent = `"${text}"`;
      }
    );
  });
}

// Generic poster-grid renderer used inside the shared insight modal
// (Incomplete Ratings / Biggest Agreements / Major Disagreements /
// Loved Across the Group). Cards use the exact same look as the
// Shared Movies grid so all of these feel like one consistent modal.
function renderPosterGrid(container, movies, { showSpread = false, emptyText = "Nothing here yet." } = {}) {
  container.innerHTML = "";

  if (!movies.length) {
    container.innerHTML = `<p class="empty-state">${emptyText}</p>`;
    return;
  }

  movies.forEach(movie => {
    const spread = showSpread ? ratingSpread(movie) : null;

    const card = document.createElement("div");
    card.className = "movie-card";

    card.innerHTML = `
      <img
        alt="${movie.title}"
        loading="lazy"
      >

      <p class="title">
        ${movie.title}
      </p>

      ${
        spread != null
          ? `<div class="insight-spread">${
              spread === 0 ? "Same rating" : `${spread}★ difference`
            }</div>`
          : ""
      }

      <p class="ratings">
        ${userRatingRows(movie)}
      </p>
    `;

    const img = card.querySelector("img");
    setPosterWithFallback(img, movie);

    card.addEventListener("click", () => openMovieDetail(movie));

    container.appendChild(card);
  });
}



const MOVIE_SORTERS = {
  "title-asc": (a, b) => a.title.localeCompare(b.title),
  "title-desc": (a, b) => b.title.localeCompare(a.title),
  "year-desc": (a, b) => compareByYear(a, b, "desc"),
  "year-asc": (a, b) => compareByYear(a, b, "asc")
};

// Applies the current search query and sort mode on top of the base
// (agreement-sorted) shared movies list, then re-renders the grid.
function renderFilteredSortedMovies() {
  const query = movieSearchQuery.trim().toLowerCase();

  let list = query
    ? lastSharedMovies.filter(m => m.title.toLowerCase().includes(query))
    : [...lastSharedMovies];

  const sorter = MOVIE_SORTERS[movieSortMode];
  if (sorter) list = list.sort(sorter);

  const emptyState = document.getElementById("movies-empty-state");
  const grid = document.getElementById("movies-grid");

  if (!list.length) {
    grid.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.textContent = query
      ? `No shared movies match "${movieSearchQuery.trim()}".`
      : "No shared movies yet.";
  } else {
    grid.classList.remove("hidden");
    emptyState.classList.add("hidden");
  }

  renderMovies(list);
}

document.getElementById("movie-search-input").addEventListener("input", e => {
  movieSearchQuery = e.target.value;
  renderFilteredSortedMovies();
});

document.getElementById("movie-sort-select").addEventListener("change", e => {
  movieSortMode = e.target.value;
  renderFilteredSortedMovies();
});

function renderMovies(movies) {
  const grid = document.getElementById("movies-grid");
  grid.innerHTML = "";

  movies.forEach(movie => {
    const card = document.createElement("div");
    card.className = "movie-card";

    card.innerHTML = `
      <img
        alt="${movie.title}"
        loading="lazy"
      >

      <p class="title">
        ${movie.title}
      </p>

      <p class="ratings">
        ${userRatingRows(movie)}
      </p>
    `;

    const img = card.querySelector("img");
    setPosterWithFallback(img, movie);

    card.addEventListener("click", () => openMovieDetail(movie));

    grid.appendChild(card);
  });
}

// Films on everyone's watchlist — a good pick for watching together
// since nobody's seen it yet. Same card/click behavior as the shared
// movies grid, just without a ratings line (nobody's rated it).
function renderWatchTogether(movies) {
  const grid = document.getElementById("watch-together-grid");
  if (!grid) return;

  grid.innerHTML = "";

  if (!movies.length) {
    grid.innerHTML = `
      <p class="empty-state">
        No overlap yet — add films to your Letterboxd watchlists and
        they'll show up here once everyone's queued the same one up.
      </p>
    `;
    return;
  }

  movies.forEach(movie => {
    const card = document.createElement("div");
    card.className = "movie-card";

    card.innerHTML = `
      <img
        alt="${movie.title}"
        loading="lazy"
      >

      <p class="title">
        ${movie.title}
      </p>
    `;

    const img = card.querySelector("img");
    setPosterWithFallback(img, movie);

    card.addEventListener("click", () => openMovieDetail(movie));

    grid.appendChild(card);
  });
}

function renderPairwiseInto(container, matrix) {
  container.innerHTML = "";

  if (users.length < 2) return;

  const grid = document.createElement("div");
  grid.className = "pairwise-grid";

  matrix.forEach(p => {
    const row = document.createElement("div");
    row.className = "pairwise-row";

    const scoreText =
      p.compatibility == null ? "—" : `${p.compatibility}%`;

    row.innerHTML = `
      <span class="pairwise-pair">
        <span style="color:${colorFor(p.a)}">${p.a}</span>
        ×
        <span style="color:${colorFor(p.b)}">${p.b}</span>
      </span>
      <span class="pairwise-score">${scoreText}</span>
    `;

    grid.appendChild(row);
  });

  container.appendChild(grid);
}

// Renders a breakdown of how the overall compatibility score was
// built: rating similarity (how close ratings are on shared films),
// shared score (how much overlap there is), and confidence (how much
// to trust that overlap given the sample size) — then shows how those
// three combine into the final weighted, confidence-adjusted number.
function renderScoreBreakdown({
  ratingSimilarity,
  sharedScore,
  confidence,
  sharedCount,
  avgDiff,
  finalCompatibility
}) {
  const container = document.getElementById("score-breakdown");
  if (!container) return;

  const confidencePct = Math.round(confidence * 100);
  const weightedRaw = ratingSimilarity * 0.6 + sharedScore * 0.4;

  const rows = [
    {
      label: "Rating Similarity",
      value: ratingSimilarity,
      weight: "60%",
      detail: `Avg rating gap: ${avgDiff.toFixed(2)}★`
    },
    {
      label: "Shared Score",
      value: sharedScore,
      weight: "40%",
      detail: `${sharedCount} shared film${sharedCount === 1 ? "" : "s"} (caps at 300)`
    }
  ];

  container.innerHTML = `
    <div class="breakdown-rows">
      ${rows
        .map(
          r => `
        <div class="breakdown-row">
          <div class="breakdown-row-head">
            <span class="breakdown-label">${r.label} <small>(${r.weight})</small></span>
            <span class="breakdown-value">${Math.round(r.value)}%</span>
          </div>
          <div class="breakdown-bar-track">
            <div class="breakdown-bar-fill" style="width:${Math.min(100, Math.max(0, r.value))}%"></div>
          </div>
          <p class="breakdown-detail">${r.detail}</p>
        </div>
      `
        )
        .join("")}
    </div>

    <div class="breakdown-confidence">
      <div class="breakdown-row-head">
        <span class="breakdown-label">Confidence <small>(from shared films)</small></span>
        <span class="breakdown-value">${confidencePct}%</span>
      </div>
      <div class="breakdown-bar-track confidence-track">
        <div class="breakdown-bar-fill confidence-fill" style="width:${confidencePct}%"></div>
      </div>
      <p class="breakdown-detail">
        More shared films = more confidence the score reflects real taste overlap, not a small sample.
      </p>
    </div>

    <div class="breakdown-formula">
      <span>(${Math.round(ratingSimilarity)}% × 0.6 + ${Math.round(sharedScore)}% × 0.4) × ${confidencePct}% confidence</span>
      <span class="breakdown-equals">= ${finalCompatibility}%</span>
    </div>
  `;
}

function animateCompatibility(target) {
  const el = document.getElementById("compatibility-number");
  const circle = el.closest(".score-circle");

  let value = 0;

  if (circle) {
    circle.style.setProperty("--score", "0deg");
  }

  const interval = setInterval(() => {
    value++;

    el.textContent = `${value}%`;

    if (circle) {
      circle.style.setProperty("--score", `${(value / 100) * 360}deg`);
    }

    if (value >= target) {
      clearInterval(interval);
    }
  }, 15);
}

function updateLoading(percent) {
  const progress = document.getElementById("progress-bar");

  if (progress) {
    progress.style.width = `${percent}%`;
  }
}

function formatRating(rating) {
  if (rating == null) return watchedIcon();

  const full = Math.floor(rating);
  const half = rating % 1 !== 0;

  return "★".repeat(full) + (half ? "½" : "");
}

// ---------- Toggle Buttons ----------

document
  .getElementById("breakdown-btn")
  .addEventListener("click", () => {
    document.getElementById("score-breakdown").classList.toggle("open");
  });

// ---------- Shared Insight Modal ----------
// Biggest Agreements, Major Disagreements, Loved Across the Group,
// Pairwise Compatibility, and Incomplete Ratings all open this one
// modal — styled just like the Shared Movies grid — with whichever
// content matches the tab that was clicked.

const insightModal = document.getElementById("one-sided-modal");
const insightModalBody = document.getElementById("modal-movies");
const insightModalHeading = document.getElementById("insight-modal-heading");
let currentInsightType = null;

const INSIGHT_TABS = {
  incomplete: {
    heading: "Incomplete Ratings",
    render: () =>
      renderPosterGrid(insightModalBody, latestIncomplete, {
        emptyText: "No incomplete ratings — everyone's fully rated what they've watched."
      })
  },
  agreements: {
    heading: "Biggest Agreements",
    render: () =>
      renderPosterGrid(insightModalBody, latestAgreements, {
        showSpread: true,
        emptyText: "No unanimous ratings yet."
      })
  },
  disagreements: {
    heading: "Major Disagreements",
    render: () =>
      renderPosterGrid(insightModalBody, latestDisagreements, {
        showSpread: true,
        emptyText: "No major disagreements yet."
      })
  },
  loved: {
    heading: "Loved Across the Group",
    render: () =>
      renderPosterGrid(insightModalBody, latestLoved, {
        showSpread: true,
        emptyText: "Nothing loved by the whole group yet."
      })
  },
  pairwise: {
    heading: "Pairwise Compatibility",
    render: () => renderPairwiseInto(insightModalBody, latestPairwiseMatrix)
  }
};

function renderInsightModalContent() {
  const tab = INSIGHT_TABS[currentInsightType];
  if (!tab) return;

  insightModalHeading.textContent = tab.heading;
  insightModalBody.className = "insight-modal-grid";
  tab.render();
}

// Keeps the modal's content in sync if a recompute happens while it's
// still open (e.g. friends added/removed, shared mode toggled).
function refreshOpenInsightModal() {
  if (currentInsightType && insightModal.classList.contains("open")) {
    renderInsightModalContent();
  }
}

function openInsightModal(type) {
  currentInsightType = type;
  renderInsightModalContent();
  insightModal.classList.add("open");
}

document
  .getElementById("agreement-btn")
  .addEventListener("click", () => openInsightModal("agreements"));

document
  .getElementById("disagreement-btn")
  .addEventListener("click", () => openInsightModal("disagreements"));

document
  .getElementById("loved-btn")
  .addEventListener("click", () => openInsightModal("loved"));

document
  .getElementById("pairwise-btn")
  .addEventListener("click", () => openInsightModal("pairwise"));

const oneSidedBtn = document.getElementById("one-sided-btn");

if (oneSidedBtn) {
  oneSidedBtn.addEventListener("click", () => openInsightModal("incomplete"));
}

insightModal.addEventListener("click", e => {
  if (e.target.id === "one-sided-modal") {
    e.currentTarget.classList.remove("open");
  }
});

// ---------- Movie Detail Modal ----------

const movieDetailModal = document.getElementById("movie-detail-modal");
const movieDetailBody = document.getElementById("movie-detail-body");

movieDetailModal.addEventListener("click", e => {
  if (e.target.id === "movie-detail-modal") {
    e.currentTarget.classList.remove("open");
  }
});

function letterboxdFilmUrl(slug) {
  return `https://letterboxd.com/film/${slug}/`;
}

function bindCloseMovieDetail() {
  const btn = document.getElementById("close-movie-detail");

  if (btn) {
    btn.addEventListener("click", () => {
      movieDetailModal.classList.remove("open");
    });
  }
}

async function openMovieDetail(movie) {
  movieDetailModal.classList.add("open");

  movieDetailBody.innerHTML = `
    <button id="close-movie-detail">✕</button>
    <div class="movie-detail-loading">Loading film details...</div>
  `;

  bindCloseMovieDetail();

  const lbUrl = letterboxdFilmUrl(movie.slug);

  const yearMatch = movie.slug?.match(/-(\d{4})(?:-\d+)?$/);
  const slugYear = yearMatch ? yearMatch[1] : "";

  let tmdbMovie = null;

  try {
    tmdbMovie = await searchMovie(movie.title, slugYear);
  } catch (e) {
    tmdbMovie = null;
  }

  const backdropUrl = tmdbMovie?.backdrop_path
    ? getBackdrop(tmdbMovie.backdrop_path)
    : null;

  const year =
    tmdbMovie?.release_date?.slice(0, 4) || slugYear || "";

  movieDetailBody.innerHTML = `
    <button id="close-movie-detail">✕</button>

    <div
      class="movie-detail-header"
      style="${
        backdropUrl ? `background-image:url('${backdropUrl}')` : ""
      }"
    >
      <div class="movie-detail-title-wrap">
        <h2 class="movie-detail-title">${movie.title}</h2>
        ${year ? `<div class="movie-detail-year">${year}</div>` : ""}
      </div>
    </div>

    <div class="movie-detail-body-inner">
      <div class="watch-section-title">Ratings &amp; Reviews</div>
      <div class="detail-ratings-list">
        ${renderDetailRatings(movie)}
      </div>

      <div class="movie-detail-actions">
        <a
          href="${lbUrl}"
          target="_blank"
          rel="noopener"
          class="letterboxd-link-btn"
        >
          View on Letterboxd ↗
        </a>
      </div>
    </div>
  `;

  bindCloseMovieDetail();
  loadDetailReviews(movie);
}

// ---------- Shared Movies Mode Toggle ----------

document.getElementById("mode-all-btn").addEventListener("click", () => {
  sharedMode = "all";
  document.getElementById("mode-all-btn").classList.add("active");
  document.getElementById("mode-any-btn").classList.remove("active");
  recomputeAndRender();
});

document.getElementById("mode-any-btn").addEventListener("click", () => {
  sharedMode = "any";
  document.getElementById("mode-any-btn").classList.add("active");
  document.getElementById("mode-all-btn").classList.remove("active");
  recomputeAndRender();
});

// ---------- Choose Friends Modal ----------

const addFriendBtn = document.getElementById("add-friend-btn");
const chooseFriendsModal = document.getElementById("choose-friends-modal");
const closeChooseFriendsBtn = document.getElementById(
  "close-choose-friends"
);
const followingListEl = document.getElementById("following-list");
const manualFriendInput = document.getElementById("manual-friend-input");
const manualFriendAddBtn = document.getElementById("manual-friend-add");

let followingCache = null; // cached list of { username, displayName, avatar }

addFriendBtn.addEventListener("click", async () => {
  chooseFriendsModal.classList.add("open");

  if (followingCache === null) {
    followingCache = await getFollowing(ownerUsername);
  }

  renderFollowingList();
});

closeChooseFriendsBtn.addEventListener("click", () => {
  chooseFriendsModal.classList.remove("open");
});

chooseFriendsModal.addEventListener("click", e => {
  if (e.target.id === "choose-friends-modal") {
    e.currentTarget.classList.remove("open");
  }
});

function renderFollowingList() {
  if (!followingCache || followingCache.length === 0) {
    followingListEl.innerHTML =
      '<p class="following-loading-text">No following list found.</p>';
    return;
  }

  followingListEl.innerHTML = "";

  followingCache.forEach(person => {
    const isChecked = users.includes(person.username);

    const card = document.createElement("label");
    card.className =
      "following-item" + (isChecked ? " selected" : "");

    card.innerHTML = `
      <input
        type="checkbox"
        ${isChecked ? "checked" : ""}
      >

      <div class="following-avatar-wrap">

        <div
          class="following-avatar"
          ${
            person.avatar
              ? `style="background-image:url('${person.avatar}')"`
              : ""
          }>
        </div>

        <div class="following-check">
          ✓
        </div>

      </div>

      <div class="following-name">
        ${person.displayName}
      </div>
    `;

    const checkbox = card.querySelector("input");

    checkbox.addEventListener("change", async () => {

      checkbox.disabled = true;

      if (checkbox.checked) {

        card.classList.add("selected");
        await addFriend(person.username);

      } else {

        card.classList.remove("selected");
        await removeFriend(person.username);

      }

      checkbox.disabled = false;

    });

    followingListEl.appendChild(card);
  });
}

async function handleManualAdd() {
  const username = manualFriendInput.value.trim().toLowerCase();

  if (!username || users.includes(username)) {
    manualFriendInput.value = "";
    return;
  }

  manualFriendInput.value = "";

  await addFriend(username);
  renderFollowingList();
}

manualFriendAddBtn.addEventListener("click", handleManualAdd);

manualFriendInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleManualAdd();
  }
});

// ---------- Add / Remove Friend ----------

// Adding a friend just marks them as pending — no fetching happens
// until "Compare" is clicked, so checking boxes in the picker is
// instant and doesn't trigger any network activity per click.
async function addFriend(username) {
  if (users.includes(username)) return;

  users.push(username);
  pendingFriends.push(username);
  updateUrl();

  document.getElementById("users").innerHTML = renderUserChips();
  updateCompareButton();
}

// Removing a friend is always immediate:
// - if they were still pending (never fetched), just drop them, no
//   recompute needed since they were never part of the rendered comparison.
// - if they were already part of the comparison, recompute right away
//   so the user never has to press Compare just to remove someone.
// The owner (users[0]) can be removed too, so people can compare two
// of their friends against each other without themselves in the mix —
// as long as at least 2 people remain.
async function removeFriend(username) {
  const idx = users.indexOf(username);

  if (idx === -1) return; // unknown user
  if (users.length <= 2) return; // need at least 2 people to compare

  const wasPending = pendingFriends.includes(username);

  users.splice(idx, 1);
  pendingFriends = pendingFriends.filter(u => u !== username);
  delete userData[username];
  updateUrl();

  document.getElementById("users").innerHTML = renderUserChips();
  updateCompareButton();

  if (!wasPending) {
    recomputeAndRender();
  }
}

function updateCompareButton() {
  const btn = document.getElementById("compare-btn");
  const n = pendingFriends.length;

  btn.disabled = n === 0;
  btn.textContent = n > 0 ? `Compare (${n})` : "Compare";
}

// ---------- Avatar Fetch ----------

async function getAvatar(username) {
  try {
    const response = await fetch(`https://letterboxd-blend-backend-en2i.onrender.com/users/${encodeURIComponent(username)}/avatar`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.avatar || null;
  } catch {
    return null;
  }
}

document
  .getElementById("compare-btn")
  .addEventListener("click", async () => {
    if (pendingFriends.length === 0) return;

    const toFetch = [...pendingFriends];
    const btn = document.getElementById("compare-btn");
    btn.disabled = true;

    const loading = document.getElementById("loading-screen");
    document.getElementById("loading-text").textContent =
      toFetch.length === 1
        ? `Fetching ${toFetch[0]}'s films...`
        : "Fetching films...";

    loading.style.display = "flex";
    updateLoading(10);
    buildLoadingAvatars(toFetch);
    startLoadingFeedback();
    startProgressTrickle(10, 85);

    await fetchUsersWithProgress(toFetch);

    stopLoadingMessageRotation();
    stopProgressTrickle();
    updateLoading(95);

    pendingFriends = pendingFriends.filter(u => !toFetch.includes(u));

    document.getElementById("users").innerHTML = renderUserChips();

    recomputeAndRender();
    finishLoading();
    updateCompareButton();
  });