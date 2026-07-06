/**
 * Computes films that exist on every user's watchlist (the overlap).
 */
export function computeCommonWatchlist(users, userData) {
  const map = new Map();

  users.forEach(u => {
    const list = userData[u]?.watchlist || [];

    list.forEach(f => {
      const key = f.id || f.slug;

      if (!map.has(key)) {
        map.set(key, {
          id: f.id,
          slug: f.slug,
          title: f.title,
          ratings: {},
          liked: {},
          reviewUrl: {},
          watchlistedBy: new Set()
        });
      }

      map.get(key).watchlistedBy.add(u);
    });
  });

  return [...map.values()]
    .filter(m => m.watchlistedBy.size === users.length)
    .map(({ watchlistedBy, ...movie }) => movie);
}

/**
 * Computes pairwise compatibility for all user pairs.
 */
export function computePairwise(users, movieMap) {
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

/**
 * Computes rating similarity percentage.
 */
export function computeRatingSimilarity(avgDiff) {
  if (avgDiff == null) return 0;
  return Math.max(0, (1 - avgDiff / 4.5) * 100);
}

/**
 * Computes shared score percentage based on shared movie count.
 */
export function computeSharedScore(sharedCount) {
  // Saturates around 300 shared films
  return Math.min(100, (sharedCount / 300) * 100);
}

/**
 * Computes confidence score weighting factor based on shared movie count.
 */
export function computeConfidence(sharedCount) {
  return sharedCount / (sharedCount + 100);
}

/**
 * Computes the overall compatibility score.
 */
export function computeCompatibility(avgDiff, sharedCount) {
  const ratingSimilarity = computeRatingSimilarity(avgDiff);
  const sharedScore = computeSharedScore(sharedCount);
  const confidence = computeConfidence(sharedCount);

  const score =
      ratingSimilarity * 0.60 +
      sharedScore * 0.40;

  return Math.round(score * confidence);
}

/**
 * Calculates the difference between highest and lowest ratings for a movie.
 */
export function ratingSpread(movie) {
  const entries = Object.entries(movie.ratings).filter(
    ([, rating]) => rating != null
  );
  const ratings = entries.map(([, r]) => r);

  if (ratings.length < 2) return null;

  return Math.max(...ratings) - Math.min(...ratings);
}

/**
 * Extracts the movie release year from the title or slug.
 */
export function getMovieYear(movie) {
  const titleMatch = movie.title?.match(/\((\d{4})\)\s*$/);
  if (titleMatch) return parseInt(titleMatch[1], 10);

  const slugMatch = movie.slug?.match(/-(\d{4})(?:-\d+)?$/);
  return slugMatch ? parseInt(slugMatch[1], 10) : null;
}

/**
 * Comparator to sort movies by year, grouping missing years at the end.
 */
export function compareByYear(a, b, direction) {
  const ay = getMovieYear(a);
  const by = getMovieYear(b);

  if (ay == null && by == null) return 0;
  if (ay == null) return 1;
  if (by == null) return -1;

  return direction === "desc" ? by - ay : ay - by;
}
