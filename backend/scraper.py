import asyncio
import json
import logging
import random
import re
import time
from typing import List, Dict, Any, Optional, Callable
import httpx
from selectolax.parser import HTMLParser

logger = logging.getLogger(__name__)

PLACEHOLDER_PATTERNS = [
    re.compile(r"there is no review for this (diary )?entry", re.IGNORECASE),
    re.compile(r"^add a review\??$", re.IGNORECASE)
]

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://letterboxd.com/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Connection": "keep-alive",
}

# Caps how many requests are in flight AT ONCE across the whole process
# (not just within one scrape call). This is what lets us fetch many pages
# concurrently for speed, while still not hammering Letterboxd hard enough
# to get re-blocked. Tune this up/down if you see 403s return.
PAGE_FETCH_CONCURRENCY = 6
_GLOBAL_SEM = asyncio.Semaphore(PAGE_FETCH_CONCURRENCY)


class ScrapeBlockedError(Exception):
    """Raised when a URL is persistently blocked (403) after all retries.

    This is intentionally distinct from returning None, which means "page
    genuinely doesn't exist / no more pages" (e.g. a real 404). Callers
    should NOT treat a ScrapeBlockedError the same way they treat the end
    of pagination - it means we don't actually know the answer.
    """
    def __init__(self, url: str):
        self.url = url
        super().__init__(f"Blocked (403) after retries: {url}")


def get_closest(node, selector: str):
    current = node.parent
    while current is not None:
        if selector.startswith("."):
            cls = selector[1:]
            if cls in (current.attributes.get("class") or "").split():
                return current
        elif selector.startswith("#"):
            id_val = selector[1:]
            if current.attributes.get("id") == id_val:
                return current
        else:
            if current.tag == selector:
                return current
        current = current.parent
    return None


async def get_page_html(client: httpx.AsyncClient, url: str, retries: int = 4) -> Optional[str]:
    """
    Fetch a page's HTML.

    Returns:
        str: the page HTML
        None: the page genuinely doesn't exist (404)
    Raises:
        ScrapeBlockedError: we got 403'd on every retry attempt. Callers
            must NOT treat this like a 404 / end-of-pagination - propagate
            it or surface it, don't silently truncate results.
    """
    backoff = 1.5
    for attempt in range(retries):
        try:
            async with _GLOBAL_SEM:
                # Small jitter so concurrent requests don't all land in
                # perfect lockstep (which looks more like a bot than the
                # concurrency itself does).
                await asyncio.sleep(random.uniform(0.05, 0.2))
                response = await client.get(
                    url, headers=DEFAULT_HEADERS, follow_redirects=True, timeout=30
                )

            if response.status_code == 404:
                return None

            if response.status_code in (403, 429):
                retry_after = response.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else backoff
                logger.warning(
                    f"Got {response.status_code} on {url} "
                    f"(attempt {attempt + 1}/{retries}), waiting {wait:.1f}s"
                )
                if attempt < retries - 1:
                    await asyncio.sleep(wait)
                    backoff = min(backoff * 2, 20)
                    continue
                raise ScrapeBlockedError(url)

            if response.status_code != 200:
                logger.warning(f"Unexpected status code {response.status_code} for URL {url}")
                return None

            return response.text

        except httpx.RequestError as exc:
            logger.warning(f"HTTP Request error on {url}: {exc}")
            if attempt < retries - 1:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 20)
            else:
                return None
    return None


def _get_total_pages(html: str) -> int:
    """Read the highest page number out of Letterboxd's pagination widget."""
    tree = HTMLParser(html)
    page_links = tree.css(".pagination .paginate-page a, .paginate-pages a")
    pages = []
    for a in page_links:
        text = a.text().strip()
        if text.isdigit():
            pages.append(int(text))
    return max(pages) if pages else 1


async def _fetch_all_pages(
    client: httpx.AsyncClient,
    url_for_page: Callable[[int], str],
) -> List[str]:
    """
    Fetch page 1 to learn the total page count, then fetch every remaining
    page concurrently (bounded by _GLOBAL_SEM). Returns the raw HTML for
    each page IN ORDER. Raises ScrapeBlockedError if any page is blocked.
    """
    first_html = await get_page_html(client, url_for_page(1))
    if not first_html:
        return []

    total_pages = _get_total_pages(first_html)
    if total_pages <= 1:
        return [first_html]

    remaining = range(2, total_pages + 1)
    results = await asyncio.gather(
        *[get_page_html(client, url_for_page(p)) for p in remaining]
    )
    return [first_html] + list(results)


def _parse_films_page(html: str) -> List[Dict[str, Any]]:
    movies = []
    tree = HTMLParser(html)
    posters = tree.css(".react-component[data-item-slug]")

    for poster in posters:
        slug = poster.attributes.get("data-item-slug")
        title = poster.attributes.get("data-item-name") or slug

        img = poster.css_first(".poster img")
        poster_url = ""
        if img:
            poster_url = img.attributes.get("src") or (img.attributes.get("srcset") or "").split(" ")[0] or ""

        movie_id = None
        postered_identifier_str = poster.attributes.get("data-postered-identifier")
        if postered_identifier_str:
            try:
                identifier = json.loads(postered_identifier_str)
                movie_id = identifier.get("uid", "").replace("film:", "")
            except Exception:
                pass

        rating = None
        liked = False
        reviewed = False
        review_url = None

        grid_item = get_closest(poster, ".griditem")
        if grid_item:
            rating_el = grid_item.css_first(".poster-viewingdata .rating")
            if rating_el:
                classes = (rating_el.attributes.get("class") or "").split()
                for c in classes:
                    if c.startswith("rated-"):
                        try:
                            rating = int(c.replace("rated-", "")) / 2.0
                        except ValueError:
                            pass

            liked_el = grid_item.css_first(".poster-viewingdata .icon-liked, .poster-viewingdata .like")
            liked = liked_el is not None

            review_el = grid_item.css_first(".poster-viewingdata .icon-review, .poster-viewingdata [class*='review']")
            reviewed = review_el is not None
            if review_el:
                review_anchor = review_el if review_el.tag == "a" else (get_closest(review_el, "a") or review_el.css_first("a"))
                review_href = review_anchor.attributes.get("href") if review_anchor else None
                review_url_local = None
                if review_href:
                    if review_href.startswith("/"):
                        review_url_local = f"https://letterboxd.com{review_href}"
                    else:
                        review_url_local = review_href
                review_url = review_url_local

        movies.append({
            "id": movie_id,
            "slug": slug,
            "title": title,
            "poster": poster_url,
            "rating": rating,
            "liked": liked,
            "reviewed": reviewed,
            "reviewUrl": review_url
        })
    return movies


def _fill_missing_review_urls(username: str, movies: List[Dict[str, Any]]) -> None:
    for m in movies:
        if m["reviewed"] and not m["reviewUrl"]:
            m["reviewUrl"] = f"https://letterboxd.com/{username}/film/{m['slug']}/"


def _parse_watchlist_page(html: str) -> List[Dict[str, Any]]:
    movies = []
    tree = HTMLParser(html)
    posters = tree.css(".react-component[data-item-slug]")

    for poster in posters:
        slug = poster.attributes.get("data-item-slug")
        title = poster.attributes.get("data-item-name") or slug

        img = poster.css_first(".poster img")
        poster_url = ""
        if img:
            poster_url = img.attributes.get("src") or (img.attributes.get("srcset") or "").split(" ")[0] or ""

        movie_id = None
        postered_identifier_str = poster.attributes.get("data-postered-identifier")
        if postered_identifier_str:
            try:
                identifier = json.loads(postered_identifier_str)
                movie_id = identifier.get("uid", "").replace("film:", "")
            except Exception:
                pass

        movies.append({
            "id": movie_id,
            "slug": slug,
            "title": title,
            "poster": poster_url
        })
    return movies


def _parse_following_page(html: str) -> List[Dict[str, Any]]:
    people = []
    tree = HTMLParser(html)
    rows = tree.css(".person-table .table-person, .person-summary")

    for row in rows:
        if row.css_first(".deactivated, .private") is not None:
            continue

        link = row.css_first("a.avatar[href], a.name[href], a[href]")
        if not link:
            continue

        href = link.attributes.get("href") or ""
        match = re.match(r"^\/([^\/]+)\/$", href)
        if not match:
            continue

        handle = match.group(1)

        name_el = row.css_first(".name")
        display_name = name_el.text().strip() if name_el else handle

        avatar_img = row.css_first("img")
        avatar = None
        if avatar_img:
            avatar = avatar_img.attributes.get("src") or avatar_img.attributes.get("data-src")

        people.append({
            "username": handle,
            "displayName": display_name,
            "avatar": avatar
        })
    return people


async def scrape_user_films(username: str) -> List[Dict[str, Any]]:
    async with httpx.AsyncClient() as client:
        pages_html = await _fetch_all_pages(
            client, lambda p: f"https://letterboxd.com/{username}/films/page/{p}/"
        )
        movies: List[Dict[str, Any]] = []
        for html in pages_html:
            movies.extend(_parse_films_page(html))
        _fill_missing_review_urls(username, movies)
        return movies


async def scrape_watchlist(username: str) -> List[Dict[str, Any]]:
    async with httpx.AsyncClient() as client:
        pages_html = await _fetch_all_pages(
            client, lambda p: f"https://letterboxd.com/{username}/watchlist/page/{p}/"
        )
        movies: List[Dict[str, Any]] = []
        for html in pages_html:
            movies.extend(_parse_watchlist_page(html))
        return movies


async def scrape_following(username: str) -> List[Dict[str, Any]]:
    async with httpx.AsyncClient() as client:
        pages_html = await _fetch_all_pages(
            client, lambda p: f"https://letterboxd.com/{username}/following/page/{p}/"
        )
        people: List[Dict[str, Any]] = []
        seen = set()
        for html in pages_html:
            for person in _parse_following_page(html):
                if person["username"] in seen:
                    continue
                seen.add(person["username"])
                people.append(person)
        return people


async def scrape_avatar(username: str) -> Optional[str]:
    async with httpx.AsyncClient() as client:
        url = f"https://letterboxd.com/{username}/"
        html = await get_page_html(client, url)
        if not html:
            return None

        tree = HTMLParser(html)
        img_el = tree.css_first(".profile-avatar img")
        if img_el:
            return img_el.attributes.get("src")
    return None


async def scrape_review(username: str, slug: str, review_url: Optional[str] = None) -> Optional[str]:
    url = review_url or f"https://letterboxd.com/{username}/film/{slug}/"
    async with httpx.AsyncClient() as client:
        html = await get_page_html(client, url)
        if not html:
            return None

        tree = HTMLParser(html)
        candidates = [
            ".review .body-text",
            ".js-review-body .body-text",
            ".review-body .body-text",
            ".body-text"
        ]

        for selector in candidates:
            elements = tree.css(selector)
            for el in elements:
                el_html = el.html or ""
                el_html = re.sub(r"<br\s*/?>", "\n", el_html, flags=re.IGNORECASE)

                temp_tree = HTMLParser(el_html)
                p_elements = temp_tree.css("p")
                if p_elements:
                    paragraphs = []
                    for p in p_elements:
                        p_html = p.html or ""
                        p_html = re.sub(r"<br\s*/?>", "\n", p_html, flags=re.IGNORECASE)
                        paragraphs.append(HTMLParser(p_html).text().strip())
                    candidate_text = "\n\n".join([p for p in paragraphs if p])
                else:
                    candidate_text = temp_tree.text().strip()

                if candidate_text and not any(pat.search(candidate_text) for pat in PLACEHOLDER_PATTERNS):
                    return candidate_text
    return None