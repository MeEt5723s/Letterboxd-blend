// ---------- Setup & State ----------

const USER_COLORS = [
  "#00e054", "#40bcf4", "#ff8000", "#ff4081",
  "#b388ff", "#ffd740", "#ff5252", "#69f0ae"
];
import { getUserFilms } from "../scraper/userFilms.js";
import { getFollowing } from "../scraper/following.js";
import { searchMovie, getBackdrop } from "../api/tmdb.js";
import { buildPosterUrl, applyPosterFallback } from "../utils/posterUtils.js";

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
const userData = {}; // username -> { films, avatar }
let sharedMode = "all"; // "all" | "any"

// Loading-screen feedback timers (declared here, not near their
// functions below, since the main IIFE further down calls
// loadAllUsers() immediately and would otherwise hit these while
// still in their temporal dead zone).
let messageRotationTimer = null;
let progressTrickleTimer = null;

// Friends added via the "Add Friend" flow that haven't been fetched
// and folded into the comparison yet — they only become part of
// `userData` / the rendered comparison once "Compare" is clicked.
let pendingFriends = [];

document.getElementById("users").innerHTML = renderUserChips();

function renderUserChips() {
  return users
    .map(u => {
      const pending = pendingFriends.includes(u);

      return `<span class="user-chip${
        pending ? " pending-chip" : ""
      }" style="color:${colorFor(u)}">${u}${
        pending ? ' <small class="pending-label">(pending)</small>' : ""
      }</span>`;
    })
    .join('<span class="user-sep"> × </span>');
}

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

  await Promise.all([...avatarWork, ...filmWork]);
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

  el.textContent = `${count} film${count === 1 ? "" : "s"} found`;
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

function computePairwise(movieMap) {
  const matrix = [];

  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const a = users[i];
      const b = users[j];

      const diffs = [];

      movieMap.forEach(m => {
        if (m.ratings[a] != null && m.ratings[b] != null) {
          diffs.push(Math.abs(m.ratings[a] - m.ratings[b]));
        }
      });

      const avgDiff =
        diffs.length === 0
          ? null
          : diffs.reduce((s, d) => s + d, 0) / diffs.length;

      const compatibility =
  avgDiff == null
    ? null
    : computeCompatibility(avgDiff, diffs.length);

      matrix.push({ a, b, avgDiff, compatibility, count: diffs.length });
    }
  }

  return matrix;
}

function computeRatingSimilarity(avgDiff) {
  if (avgDiff == null) return 0;
  return Math.max(0, (1 - avgDiff / 4.5) * 100);
}

function computeSharedScore(sharedCount) {
  // Saturates around 300 shared films
  return Math.min(100, (sharedCount / 300) * 100);
}

function computeConfidence(sharedCount) {
  return sharedCount / (sharedCount + 100);
}

function computeCompatibility(avgDiff, sharedCount) {

  const ratingSimilarity = computeRatingSimilarity(avgDiff);

  const sharedScore = computeSharedScore(sharedCount);

  const confidence = computeConfidence(sharedCount);

  const score =
      ratingSimilarity * 0.60 +
      sharedScore * 0.40;

  return Math.round(score * confidence);
}
// ---------- Compute + Render ----------

function recomputeAndRender() {
  const movieMap = buildMovieMap();
  const pairwise = computePairwise(movieMap);

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

  renderMovies(sortedShared);

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

const biggestAgreements = [...withSpread]
  .sort((a, b) => {
    if (a.spread !== b.spread) {
      return a.spread - b.spread;
    }

    return ratedByEntries(b.movie).length - ratedByEntries(a.movie).length;
  })
  .slice(0, 5)
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

renderInsights(biggestAgreements, "agreements");
renderInsights(majorDisagreements, "disagreements");

  // Loved across the group: liked by 2+ people. For a two-person blend
  // that means both of them; for larger groups it's "at least two".
  const lovedMovies = [...movieMap.values()]
    .filter(m => likedBy(m).length >= 2)
    .sort((a, b) => likedBy(b).length - likedBy(a).length);

  renderInsights(lovedMovies, "loved");

  // Incomplete ratings: everyone watched, not everyone rated
  const incompleteRatings = [...movieMap.values()].filter(m => {
    const watched = watchedBy(m).length;
    const rated = ratedByEntries(m).length;
    return watched === users.length && rated > 0 && rated < users.length;
  });

  renderIncompleteRatings(incompleteRatings);

  renderPairwise(pairwise);
}

function ratingSpread(movie) {
  const ratings = ratedByEntries(movie).map(([, r]) => r);

  if (ratings.length < 2) return null;

  return Math.max(...ratings) - Math.min(...ratings);
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

function reviewIcon() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round">
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
  </svg>`;
}

// Preview rows used in card contexts (grid, insights). Shows up to
// `limit` users (watchers first), then a "+n more" line so the card
// doesn't grow unbounded for big groups — click the poster for the
// full breakdown.
function userRatingRows(movie, limit = 2) {
  const ordered = orderedUsersForMovie(movie);
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
        <span style="color:${colorFor(u)}">
          ${u}: ${valueHtml}
        </span>
      `;
    })
    .join("<br>");

  const more =
    remaining > 0
      ? `<br><span class="ratings-more">+${remaining} more</span>`
      : "";

  return rows + more;
}

// Full per-user breakdown used in the movie detail modal: everyone
// (watchers first), with a heart for likes and a link icon for reviews.
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
        <div class="detail-rating-row" style="color:${colorFor(u)}">
          <span class="detail-rating-user">
            ${u}${liked ? ` ${heartIcon()}` : ""}
          </span>
          <span class="detail-rating-value">
            ${valueHtml}
            ${
              reviewUrl
                ? `<a href="${reviewUrl}" target="_blank" rel="noopener" class="review-link" title="Read review">${reviewIcon()}</a>`
                : ""
            }
          </span>
        </div>
      `;
    })
    .join("");
}

function renderInsights(movies, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  movies.forEach(movie => {
    const poster = buildPosterUrl(movie.id, movie.slug);
    const spread = ratingSpread(movie);
    const card = document.createElement("div");
    card.className = "insight-poster-card";

    card.innerHTML = `
      <img
        src="${poster}"
        alt="${movie.title}"
        class="insight-poster"
      >

      <div class="insight-movie-title">
    ${movie.title}
</div>

${
    spread != null
        ? `<div class="insight-spread">
            ${spread}★ difference
           </div>`
        : ""
}

      <div class="insight-ratings">
        ${userRatingRows(movie)}
      </div>
    `;

    const img = card.querySelector(".insight-poster");
    img.onerror = () =>
    applyPosterFallback(img, movie);

    card.addEventListener("click", () => openMovieDetail(movie));

    container.appendChild(card);
  });
}

function renderMovies(movies) {
  const grid = document.getElementById("movies-grid");
  grid.innerHTML = "";

  movies.forEach(movie => {
    const poster = buildPosterUrl(movie.id, movie.slug);

    const card = document.createElement("div");
    card.className = "movie-card";

    card.innerHTML = `
      <img
        src="${poster}"
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
    img.onerror = () =>
    applyPosterFallback(img, movie);

    card.addEventListener("click", () => openMovieDetail(movie));

    grid.appendChild(card);
  });
}

function renderIncompleteRatings(movies) {
  const modalMovies = document.getElementById("modal-movies");
  modalMovies.innerHTML = "";

  movies.forEach(movie => {
    const poster = buildPosterUrl(movie.id, movie.slug);

    const div = document.createElement("div");
    div.className = "one-sided-film";

    const limit = 2;
    const shown = users.slice(0, limit);
    const remaining = users.length - shown.length;

    const rows = shown
      .map(u => {
        const rating = movie.ratings[u];

        return `
          <div class="one-sided-rating-row">
            <span class="one-sided-name" style="color:${colorFor(
              u
            )}">${u}</span>
            <span class="one-sided-value">${formatRating(rating)}</span>
          </div>
        `;
      })
      .join("");

    const more =
      remaining > 0
        ? `<div class="one-sided-rating-row ratings-more">+${remaining} more</div>`
        : "";

    div.innerHTML = `
      <div class="one-sided-poster">
        <img src="${poster}">
        <div class="one-sided-title">
          ${movie.title}
        </div>
      </div>

      <div class="one-sided-ratings">
        ${rows}${more}
      </div>
    `;

    const img = div.querySelector("img");
    img.onerror = () =>
    applyPosterFallback(img, movie);

    div.addEventListener("click", () => openMovieDetail(movie));

    modalMovies.appendChild(div);
  });
}

function renderPairwise(matrix) {
  const container = document.getElementById("pairwise");
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
  .getElementById("agreement-btn")
  .addEventListener("click", () => {
    document.getElementById("agreements").classList.toggle("open");
  });

document
  .getElementById("disagreement-btn")
  .addEventListener("click", () => {
    document.getElementById("disagreements").classList.toggle("open");
  });

document
  .getElementById("loved-btn")
  .addEventListener("click", () => {
    document.getElementById("loved").classList.toggle("open");
  });

document
  .getElementById("pairwise-btn")
  .addEventListener("click", () => {
    document.getElementById("pairwise").classList.toggle("open");
  });

const oneSidedBtn = document.getElementById("one-sided-btn");

if (oneSidedBtn) {
  oneSidedBtn.addEventListener("click", () => {
    document.getElementById("one-sided-modal").classList.add("open");
  });
}

document.getElementById("close-modal").addEventListener("click", () => {
  document.getElementById("one-sided-modal").classList.remove("open");
});

document
  .getElementById("one-sided-modal")
  .addEventListener("click", e => {
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
    followingCache = await getFollowing(users[0]);
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
async function removeFriend(username) {
  const idx = users.indexOf(username);

  if (idx <= 0) return; // can't remove the owner (users[0]) or unknown user

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
    const response = await fetch(`https://letterboxd.com/${username}/`);
    const html = await response.text();

    const doc = new DOMParser().parseFromString(html, "text/html");
    const img = doc.querySelector(".profile-avatar img");

    return img?.src || null;
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