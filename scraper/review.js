// Fetches the full text of a user's review for a film so it can be read
// inline in the movie detail modal, instead of only linking out.
// NOTE: based on Letterboxd's typical review markup — if review text
// keeps coming back empty, open the review URL in question and inspect
// the review block to confirm/update the selectors below.

const reviewCache = new Map();

// Letterboxd shows this boilerplate on a logged entry that has no
// written review — without filtering it, it looks exactly like content.
const PLACEHOLDER_PATTERNS = [
  /there is no review for this (diary )?entry/i,
  /^add a review\??$/i
];

function isPlaceholder(text) {
  return PLACEHOLDER_PATTERNS.some(re => re.test(text));
}

// textContent silently drops <br> tags, which is how Letterboxd marks
// line breaks within a single review paragraph — without this, lines
// that should be separate run together with no space at all.
function textWithLineBreaks(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
  return clone.textContent;
}

export async function getUserReview(username, slug, reviewUrl) {
  const cacheKey = `${username}:${slug}`;

  if (reviewCache.has(cacheKey)) {
    return reviewCache.get(cacheKey);
  }

  // Prefer the exact log-entry URL passed in (points at the specific
  // entry that actually has the review — important for rewatches,
  // where the generic film page only reflects the latest entry).
  const url = reviewUrl || `https://letterboxd.com/${username}/film/${slug}/`;

  try {
    const response = await fetch(url, { credentials: "include" });

    if (!response.ok) {
      reviewCache.set(cacheKey, null);
      return null;
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    // A page can list more than one of this user's log entries for the
    // film (rewatches). Walk all candidates and use the first one that
    // has real text, skipping the "no review" placeholder.
    const candidates = [
      ...doc.querySelectorAll(".review .body-text"),
      ...doc.querySelectorAll(".js-review-body .body-text"),
      ...doc.querySelectorAll(".review-body .body-text"),
      ...doc.querySelectorAll(".body-text")
    ];

    let text = null;

    for (const el of candidates) {
      const paragraphs = [...el.querySelectorAll("p")]
        .map(p => textWithLineBreaks(p).trim())
        .filter(Boolean);

      const candidateText = paragraphs.length
        ? paragraphs.join("\n\n")
        : textWithLineBreaks(el).trim();

      if (candidateText && !isPlaceholder(candidateText)) {
        text = candidateText;
        break;
      }
    }

    reviewCache.set(cacheKey, text);
    return text;
  } catch (e) {
    console.error(e);
    reviewCache.set(cacheKey, null);
    return null;
  }
}