const metadataCache = new Map();

export async function getFilmMetadata(slug) {

    if (metadataCache.has(slug))
        return metadataCache.get(slug);

    const response = await fetch(
        `https://letterboxd.com/film/${slug}/`
    );

    if (!response.ok)
        return null;

    const html = await response.text();

    const parser = new DOMParser();

    const doc =
        parser.parseFromString(html,"text/html");

    const metadata =
        parseMetadata(doc);

    metadataCache.set(slug,metadata);

    return metadata;
}

