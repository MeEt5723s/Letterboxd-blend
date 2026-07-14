import os
import re
import logging
from contextlib import asynccontextmanager
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx

from cache import cache
from scraper import (
    scrape_user_films,
    scrape_watchlist,
    scrape_following,
    scrape_avatar,
    scrape_review,
    ScrapeBlockedError,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def pick_best_match(results: List[Dict[str, Any]], title: str, year: str = "") -> Optional[Dict[str, Any]]:
    def normalize(s):
        return re.sub(r"[^a-z0-9]", "", (s or "").lower())

    target = normalize(title)
    if year:
        for r in results:
            release_year = (r.get("release_date") or "")[:4]
            if release_year == year and normalize(r.get("title")) == target:
                return r

        for r in results:
            release_year = (r.get("release_date") or "")[:4]
            if release_year == year:
                return r

    for r in results:
        if normalize(r.get("title")) == target:
            return r

    return results[0] if results else None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to Redis cache
    await cache.connect()
    yield
    # Shutdown: any cleanup if needed

app = FastAPI(title="Letterboxd Blend Provider API", lifespan=lifespan)

# Enable CORS for Chrome Extension support
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows extension contexts and letterboxd.com
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/users/{username}/films")
async def get_user_films(username: str):
    cache_key = f"user:films:{username.lower()}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return {"films": cached}

    try:
        films = await scrape_user_films(username)
        await cache.set(cache_key, films, 300)
        return {"films": films}
    except ScrapeBlockedError as e:
        logger.error(f"Blocked scraping films for {username}: {e}")
        raise HTTPException(status_code=503, detail="Temporarily blocked by Letterboxd, please retry shortly")
    except Exception as e:
        logger.error(f"Failed scraping films for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Scraping films failed: {e}")

@app.get("/users/{username}/watchlist")
async def get_user_watchlist(username: str):
    cache_key = f"user:watchlist:{username.lower()}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return {"watchlist": cached}

    try:
        watchlist = await scrape_watchlist(username)
        await cache.set(cache_key, watchlist, 300)
        return {"watchlist": watchlist}
    except ScrapeBlockedError as e:
        logger.error(f"Blocked scraping watchlist for {username}: {e}")
        raise HTTPException(status_code=503, detail="Temporarily blocked by Letterboxd, please retry shortly")
    except Exception as e:
        logger.error(f"Failed scraping watchlist for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Scraping watchlist failed: {e}")

@app.get("/users/{username}/following")
async def get_user_following(username: str):
    cache_key = f"user:following:{username.lower()}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return {"following": cached}

    try:
        following = await scrape_following(username)
        await cache.set(cache_key, following, 300)
        return {"following": following}
    except ScrapeBlockedError as e:
        logger.error(f"Blocked scraping following for {username}: {e}")
        raise HTTPException(status_code=503, detail="Temporarily blocked by Letterboxd, please retry shortly")
    except Exception as e:
        logger.error(f"Failed scraping following for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Scraping following failed: {e}")

@app.get("/users/{username}/avatar")
async def get_user_avatar(username: str):
    cache_key = f"user:avatar:{username.lower()}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return {"avatar": cached}

    try:
        avatar = await scrape_avatar(username)
        await cache.set(cache_key, avatar, 300)
        return {"avatar": avatar}
    except ScrapeBlockedError as e:
        logger.error(f"Blocked scraping avatar for {username}: {e}")
        raise HTTPException(status_code=503, detail="Temporarily blocked by Letterboxd, please retry shortly")
    except Exception as e:
        logger.error(f"Failed scraping avatar for {username}: {e}")
        raise HTTPException(status_code=500, detail=f"Scraping avatar failed: {e}")

@app.get("/users/{username}/review")
async def get_user_review(username: str, slug: str, url: Optional[str] = None):
    cache_key = f"user:review:{username.lower()}:{slug.lower()}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return {"review": cached}

    try:
        text = await scrape_review(username, slug, url)
        await cache.set(cache_key, text, 300)
        return {"review": text}
    except ScrapeBlockedError as e:
        logger.error(f"Blocked scraping review for {username} - {slug}: {e}")
        raise HTTPException(status_code=503, detail="Temporarily blocked by Letterboxd, please retry shortly")
    except Exception as e:
        logger.error(f"Failed scraping review for {username} - {slug}: {e}")
        raise HTTPException(status_code=500, detail=f"Scraping review failed: {e}")

@app.get("/tmdb/search")
async def tmdb_search(title: str, year: str = ""):
    cache_key = f"tmdb:search:{title.lower()}:{year}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return cached

    clean_title = re.sub(r"\s*\(\d{4}\)$", "", title)
    tmdb_key = os.environ.get("TMDB_API_KEY", "caaba2a8686cdefda89210da60097d41")
    url = "https://api.themoviedb.org/3/search/movie"
    params = {
        "api_key": tmdb_key,
        "query": clean_title
    }
    if year:
        params["year"] = year

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url, params=params)
    except httpx.RequestError as exc:
        logger.error(f"TMDB network error for '{clean_title}' ({year}): {exc!r}")
        raise HTTPException(status_code=502, detail=f"TMDB request failed (network error): {exc}")

    if response.status_code != 200:
        body_snippet = response.text[:300]
        logger.error(
            f"TMDB API request failed with status {response.status_code} "
            f"for '{clean_title}' ({year}): {body_snippet}"
        )
        raise HTTPException(
            status_code=502,
            detail=f"TMDB search failed with status {response.status_code}: {body_snippet}"
        )

    try:
        data = response.json()
    except Exception as exc:
        logger.error(f"TMDB response was not valid JSON: {exc!r}")
        raise HTTPException(status_code=502, detail="TMDB returned an unreadable response")

    results = data.get("results", [])
    movie = pick_best_match(results, clean_title, year)

    # Cache search matches for 24 hours
    if movie:
        await cache.set(cache_key, movie, 86400)
    return movie

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)