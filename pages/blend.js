const params = new URLSearchParams(window.location.search);

const user1 = params.get("u1");
const user2 = params.get("u2");

document.getElementById(
  "users"
).innerHTML =
  `<h2>${user1} × ${user2}</h2>`;

(async () => {
  updateLoading(10);
  
const [avatar1, avatar2] =
  await Promise.all([
    getAvatar(user1),
    getAvatar(user2)
  ]);

if (avatar1) {
  document.getElementById(
    "avatar1"
  ).style.backgroundImage =
    `url(${avatar1})`;

  document.getElementById(
    "avatar1"
  ).style.backgroundSize =
    "cover";
}

if (avatar2) {
  document.getElementById(
    "avatar2"
  ).style.backgroundImage =
    `url(${avatar2})`;

  document.getElementById(
    "avatar2"
  ).style.backgroundSize =
    "cover";
}
document.getElementById(
  "loading-user1"
).textContent =
  user1[0].toUpperCase();

document.getElementById(
  "loading-user2"
).textContent =
  user2[0].toUpperCase();
  const [films1, films2] =
    await Promise.all([
      getUserFilms(user1),
      getUserFilms(user2)
    ]);

  updateLoading(60);

  const films2Map = new Map(
    films2.map(f => [
      f.id || f.slug,
      f
    ])
  );

  const common = films1
    .filter(f =>
      films2Map.has(
        f.id || f.slug
      )
    )
    .map(f1 => {
      const f2 =
        films2Map.get(
          f1.id || f1.slug
        );

      return {
        ...f1,
        rating1: f1.rating,
        rating2: f2.rating
      };
    });

  updateLoading(80);

  const ratedCommon =
    common.filter(
      f =>
        f.rating1 != null &&
        f.rating2 != null
    );

  const avgDifference =
    ratedCommon.length === 0
      ? 0
      : ratedCommon.reduce(
          (sum, film) =>
            sum +
            Math.abs(
              film.rating1 -
                film.rating2
            ),
          0
        ) / ratedCommon.length;

  const compatibility =
    ratedCommon.length === 0
      ? 0
      : Math.round(
          (1 -
            avgDifference /
              4.5) *
            100
        );

  const ratedFilms =
    ratedCommon.map(f => ({
      ...f,
      difference:
        Math.abs(
          f.rating1 -
            f.rating2
        )
    }));

  const biggestAgreements =
    [...ratedFilms]
      .sort(
        (a, b) =>
          a.difference -
          b.difference
      )
      .slice(0, 5);

  const biggestDisagreements =
    [...ratedFilms]
      .sort(
        (a, b) =>
          b.difference -
          a.difference
      )
      .slice(0, 5);

  const oneSidedRatings =
    common.filter(
      f =>
        (f.rating1 != null &&
          f.rating2 == null) ||
        (f.rating1 == null &&
          f.rating2 != null)
    );

  common.sort((a, b) => {
    const diffA =
      a.rating1 == null ||
      a.rating2 == null
        ? 999
        : Math.abs(
            a.rating1 -
              a.rating2
          );

    const diffB =
      b.rating1 == null ||
      b.rating2 == null
        ? 999
        : Math.abs(
            b.rating1 -
              b.rating2
          );

    return diffA - diffB;
  });

  // ---------- Stats ----------

  document.getElementById(
    "shared-count"
  ).textContent =
    `${common.length} Shared Films`;

  animateCompatibility(
    compatibility
  );
  document.getElementById(
    "avg-difference"
  ).textContent =
    `Average rating difference: ${avgDifference.toFixed(
      2
    )} ★`;

  renderInsights(
    biggestAgreements,
    "agreements"
  );

  renderInsights(
    biggestDisagreements,
    "disagreements"
  );

  renderMovies(common);

  renderOneSidedRatings(
    oneSidedRatings
  );

  updateLoading(100);

  const loading =
    document.getElementById(
      "loading-screen"
    );

  if (loading) {
    setTimeout(() => {
      loading.style.display =
        "none";
    }, 500);
  }
})();



function renderInsights(
  films,
  containerId
) {
  const container =
    document.getElementById(
      containerId
    );

  container.innerHTML = "";

  films.forEach(film => {
    const div =
      document.createElement(
        "div"
      );

    div.className =
      "insight-item";

    div.innerHTML = `
      <div class="insight-title">
        ${film.title}
      </div>

      <div class="rating-row">
        <span>${user1}</span>
        <span>${formatRating(
          film.rating1
        )}</span>
      </div>

      <div class="rating-bar">
        <div
          class="rating-fill user1"
          style="
            width:
            ${
              (film.rating1 /
                5) *
              100
            }%;
          "
        ></div>
      </div>

      <div class="rating-row">
        <span>${user2}</span>
        <span>${formatRating(
          film.rating2
        )}</span>
      </div>

      <div class="rating-bar">
        <div
          class="rating-fill user2"
          style="
            width:
            ${
              (film.rating2 /
                5) *
              100
            }%;
          "
        ></div>
      </div>
    `;

    container.appendChild(
      div
    );
  });
}

function renderMovies(
  movies
) {
  const grid =
    document.getElementById(
      "movies-grid"
    );

  grid.innerHTML = "";

  movies.forEach(film => {
    const poster =
      buildPosterUrl(
        film.id,
        film.slug
      );

    const card =
      document.createElement(
        "div"
      );

    card.className =
      "movie-card";

    card.innerHTML = `
      <img
        src="${poster}"
        alt="${film.title}"
        loading="lazy"
      >

      <p class="title">
        ${film.title}
      </p>

      <p class="ratings">
        <span class="rating-user1">
          ${user1}:
          ${formatRating(
            film.rating1
          )}
        </span>
        <br>
        <span class="rating-user2">
          ${user2}:
          ${formatRating(
            film.rating2
          )}
        </span>
      </p>
    `;

    const img =
      card.querySelector("img");

    img.onerror = () => {
      img.src =
        "https://s.ltrbxd.com/static/img/empty-poster-230.png";
    };

    grid.appendChild(card);
  });
}

function renderOneSidedRatings(
  movies
) {
  const container =
  document.getElementById(
    "one-sided-section"
  );
  if (!container) return;

  container.innerHTML = "";

  movies.forEach(film => {
    const p =
      document.createElement("p");

    const ratedBy =
      film.rating1 != null
        ? `${user1}: ${formatRating(
            film.rating1
          )}`
        : `${user2}: ${formatRating(
            film.rating2
          )}`;

    p.textContent =
      `${film.title} (${ratedBy})`;

    container.appendChild(p);
  });
}

function animateCompatibility(
  target
) {
  const el =
    document.getElementById(
      "compatibility-number"
    );

  let value = 0;

  const interval =
    setInterval(() => {
      value++;

      el.textContent =
        `${value}%`;

      if (value >= target) {
        clearInterval(
          interval
        );
      }
    }, 15);
}

function updateLoading(percent) {
  const progress =
    document.getElementById(
      "progress-bar"
    );

  if (progress) {
    progress.style.width =
      `${percent}%`;
  }
}

function formatRating(
  rating
) {
  if (rating == null)
    return "—";

  const full =
    Math.floor(rating);

  const half =
    rating % 1 !== 0;

  return (
    "★".repeat(full) +
    (half ? "½" : "")
  );
}

// ---------- Toggle Buttons ----------

document
  .getElementById(
    "agreement-btn"
  )
  .addEventListener(
    "click",
    () => {
      document
        .getElementById(
          "agreements"
        )
        .classList.toggle(
          "open"
        );
    }
  );

document
  .getElementById(
    "disagreement-btn"
  )
  .addEventListener(
    "click",
    () => {
      document
        .getElementById(
          "disagreements"
        )
        .classList.toggle(
          "open"
        );
    }
  );

const oneSidedBtn =
  document.getElementById(
    "one-sided-btn"
  );

if (oneSidedBtn) {
  oneSidedBtn.addEventListener(
    "click",
    () => {
      document
  .getElementById(
    "one-sided-section"
  )
  .classList.toggle(
    "open"
  );
    }
  );
}

async function getAvatar(username) {
  try {
    const response = await fetch(
      `https://letterboxd.com/${username}/`
    );

    const html =
      await response.text();

    const doc =
      new DOMParser()
        .parseFromString(
          html,
          "text/html"
        );

    const img =
      doc.querySelector(
        ".profile-avatar img"
      );

    return img?.src || null;
  }
  catch {
    return null;
  }
}

