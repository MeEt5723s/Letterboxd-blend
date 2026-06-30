// ---------- Setup & State ----------

const USER_COLORS = [
  "#00e054", "#40bcf4", "#ff8000", "#ff4081",
  "#b388ff", "#ffd740", "#ff5252", "#69f0ae"
];

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

document.getElementById("users").innerHTML = renderUserChips();

function renderUserChips() {
  return users
    .map(
      u =>
        `<span class="user-chip" style="color:${colorFor(
          u
        )}">${u}</span>`
    )
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

  await Promise.all(
    usernames.map(async (u, i) => {
      const [films, avatar] = await Promise.all([
        getUserFilms(u),
        getAvatar(u)
      ]);

      userData[u] = { films, avatar };
      setLoadingAvatar(i, avatar);
    })
  );

  updateLoading(70);
}

function buildLoadingAvatars(usernames) {
  const container = document.getElementById("loading-users-list");
  container.innerHTML = "";

  usernames.forEach((u, i) => {
    const div = document.createElement("div");
    div.className = "loading-user";

    div.innerHTML = `
      <div class="avatar-placeholder" id="avatar-${i}"></div>
      <p>${u}</p>
    `;

    container.appendChild(div);
  });
}

function setLoadingAvatar(index, avatarUrl) {
  if (!avatarUrl) return;

  const el = document.getElementById(`avatar-${index}`);
  if (!el) return;

  el.style.backgroundImage = `url(${avatarUrl})`;
  el.style.backgroundSize = "cover";
  el.style.backgroundPosition = "center";
}

function finishLoading() {
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
          ratings: {}
        });
      }

      map.get(key).ratings[u] = f.rating;
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
          : Math.round((1 - avgDiff / 4.5) * 100);

      matrix.push({ a, b, avgDiff, compatibility, count: diffs.length });
    }
  }

  return matrix;
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

  document.getElementById("shared-count").textContent =
    `${sharedMovies.length} Shared Films`;

  document.getElementById("avg-difference").textContent =
    `Average rating difference: ${overallAvgDiff.toFixed(2)} ★`;

  animateCompatibility(overallCompatibility);

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

  const withSpread = ratedMovies.map(m => ({
    movie: m,
    spread: ratingSpread(m)
  }));

  const biggestAgreements = [...withSpread]
    .sort((a, b) => a.spread - b.spread)
    .slice(0, 5)
    .map(x => x.movie);

  const biggestDisagreements = [...withSpread]
    .sort((a, b) => b.spread - a.spread)
    .slice(0, 5)
    .map(x => x.movie);

  renderInsights(biggestAgreements, "agreements");
  renderInsights(biggestDisagreements, "disagreements");

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

function userRatingRows(movie) {
  return watchedBy(movie)
    .map(u => {
      const rating = movie.ratings[u];

      return `<span style="color:${colorFor(u)}">
        ${u}: ${formatRating(rating)}
      </span>`;
    })
    .join("<br>");
}

function renderInsights(movies, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  movies.forEach(movie => {
    const poster = buildPosterUrl(movie.id, movie.slug);

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

      <div class="insight-ratings">
        ${userRatingRows(movie)}
      </div>
    `;

    const img = card.querySelector(".insight-poster");
    img.onerror = () => {
      img.src = "https://s.ltrbxd.com/static/img/empty-poster-230.png";
    };

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
    img.onerror = () => {
      img.src = "https://s.ltrbxd.com/static/img/empty-poster-230.png";
    };

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

    const rows = users
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

    div.innerHTML = `
      <div class="one-sided-poster">
        <img src="${poster}">
        <div class="one-sided-title">
          ${movie.title}
        </div>
      </div>

      <div class="one-sided-ratings">
        ${rows}
      </div>
    `;

    const img = div.querySelector("img");
    img.onerror = () => {
      img.src = "https://s.ltrbxd.com/static/img/empty-poster-230.png";
    };

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
  if (rating == null) return "—";

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

    const row = document.createElement("label");
    row.className = "following-item";

    row.innerHTML = `
      <input
        type="checkbox"
        ${isChecked ? "checked" : ""}
      >
      <div
        class="following-avatar"
        ${
          person.avatar
            ? `style="background-image:url(${person.avatar})"`
            : ""
        }
      ></div>
      <span class="following-name">${person.displayName}</span>
    `;

    const checkbox = row.querySelector("input");

    checkbox.addEventListener("change", async () => {
      checkbox.disabled = true;

      if (checkbox.checked) {
        await addFriend(person.username);
      } else {
        await removeFriend(person.username);
      }

      checkbox.disabled = false;
    });

    followingListEl.appendChild(row);
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

async function addFriend(username) {
  if (users.includes(username)) return;

  const loading = document.getElementById("loading-screen");
  document.getElementById("loading-text").textContent =
    `Fetching ${username}'s films...`;

  loading.style.display = "flex";
  updateLoading(10);
  buildLoadingAvatars([username]);

  const [films, avatar] = await Promise.all([
    getUserFilms(username),
    getAvatar(username)
  ]);

  userData[username] = { films, avatar };
  setLoadingAvatar(0, avatar);

  users.push(username);
  updateUrl();

  document.getElementById("users").innerHTML = renderUserChips();

  updateLoading(90);
  recomputeAndRender();
  finishLoading();
}

async function removeFriend(username) {
  const idx = users.indexOf(username);

  if (idx <= 0) return; // can't remove the owner (users[0]) or unknown user

  users.splice(idx, 1);
  delete userData[username];
  updateUrl();

  document.getElementById("users").innerHTML = renderUserChips();
  recomputeAndRender();
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