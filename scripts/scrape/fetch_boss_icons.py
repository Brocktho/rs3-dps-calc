"""
Downloads boss icon images from runescape.wiki into static/boss-icons/<slug>.png, resolving
each boss's raw wikitext `image` field (e.g. "[[File:Aberrant spectre.png|200px]]") to its
direct file URL via the MediaWiki API, then downloading as-is (matching the existing convention
of full-size wiki images, not resized/cropped).

Usage:
    python3 fetch_boss_icons.py <slug1> <slug2> ...

Reads each slug's cached fields from .scrape-cache/boss_stats/<slug>.json (populated by
fetch_boss_stats.py) to find the image filename, and slugifies the boss's own `name` field
(not the input slug) for the output filename, matching convert_boss_stats.py's convention.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = PROJECT_ROOT / '.scrape-cache' / 'boss_stats'
ICONS_DIR = PROJECT_ROOT / 'static' / 'boss-icons'
REQUEST_DELAY_SECONDS = 0.5

opener = urllib.request.build_opener()
opener.addheaders = [('User-Agent', 'rs3-dps-calc-dev/0.1 (personal project data fetch)')]


def slugify(name: str) -> str:
    return re.sub(r'[^a-zA-Z0-9]+', '-', name).strip('-').lower()


def extract_file_title(image_field: str) -> str | None:
    """Extracts 'File:X.png' from a wikitext image field. Usually wrapped in wikilink markup
    (e.g. '[[File:X.png|200px]]', sometimes lowercase '[[file:...]]'), but a handful of pages
    store just the bare filename (e.g. 'Skeletal Wyvern.png', or 'File:Lava strykewyrm.png'
    without the [[ ]] wrapper, or even a filename inside [[ ]] with no File: prefix at all,
    e.g. '[[Salawa akh.png]]') -- handle all forms."""
    m = re.search(r'\[\[\s*[Ff]ile:([^|\]]+)', image_field)
    if m:
        return f'File:{m.group(1).strip()}'
    m = re.match(r'^\[\[\s*([^|\]]+\.(?:png|jpg|jpeg|gif))\s*(?:\|[^\]]*)?\]\]$', image_field.strip(), re.IGNORECASE)
    if m:
        return f'File:{m.group(1).strip()}'
    bare = image_field.strip()
    if bare.lower().startswith('file:'):
        return f'File:{bare[len("file:"):].strip()}'
    if re.match(r'^[^\[\]]+\.(png|jpg|jpeg|gif)$', bare, re.IGNORECASE):
        return f'File:{bare}'
    return None


def get_direct_url(file_title: str) -> str | None:
    url = (
        'https://runescape.wiki/api.php?action=query&titles='
        + urllib.parse.quote(file_title)
        + '&prop=imageinfo&iiprop=url&format=json'
    )
    with opener.open(url, timeout=15) as resp:
        data = json.load(resp)
    pages = data.get('query', {}).get('pages', {})
    for page in pages.values():
        imageinfo = page.get('imageinfo')
        if imageinfo:
            return imageinfo[0]['url']
    return None


def fetch_one(slug: str) -> tuple[str, str | None]:
    """Returns (status, error_or_none)."""
    cache_path = CACHE_DIR / f'{slug}.json'
    if not cache_path.exists():
        return ('error', f'no boss_stats cache for slug {slug}')

    with open(cache_path) as f:
        cached = json.load(f)
    fields = cached.get('fields') or {}
    name = cached.get('name', slug)
    out_slug = slugify(name)
    out_path = ICONS_DIR / f'{out_slug}.png'

    if out_path.exists():
        return ('exists', None)

    image_field = fields.get('image') or fields.get('image1')
    if not image_field:
        return ('error', 'no image field in cached fields')

    file_title = extract_file_title(image_field)
    if not file_title:
        return ('error', f'could not parse file title from {image_field!r}')

    try:
        direct_url = get_direct_url(file_title)
        if not direct_url:
            return ('error', f'no imageinfo for {file_title}')
        with opener.open(direct_url, timeout=20) as resp:
            content = resp.read()
        ICONS_DIR.mkdir(parents=True, exist_ok=True)
        with open(out_path, 'wb') as f:
            f.write(content)
        return ('downloaded', None)
    except Exception as e:
        return ('error', str(e))


def main():
    if len(sys.argv) < 2:
        print('Usage: fetch_boss_icons.py <slug1> <slug2> ...', file=sys.stderr)
        sys.exit(1)

    counts = {'downloaded': 0, 'exists': 0, 'error': 0}
    for i, slug in enumerate(sys.argv[1:]):
        status, error = fetch_one(slug)
        counts[status] += 1
        msg = f'[{i + 1}/{len(sys.argv) - 1}] {slug}: {status}'
        if error:
            msg += f' ({error})'
        print(msg)
        if status == 'downloaded':
            time.sleep(REQUEST_DELAY_SECONDS)

    print(f'\nDone. {counts["downloaded"]} downloaded, {counts["exists"]} already existed, '
          f'{counts["error"]} errors.')


if __name__ == '__main__':
    main()
