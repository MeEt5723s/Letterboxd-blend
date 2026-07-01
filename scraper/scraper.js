import { getUserFilms } from "./userFilms.js";
import { getFollowing } from "./following.js";
import { getWatchlist } from "./watchlist.js";

export async function scrapeUser(username) {

    const films = await getUserFilms(username);

    const following = await getFollowing(username);

    const watchlist = await getWatchlist(username);

    return {
        username,
        films,
        following,
        watchlist
    };
}