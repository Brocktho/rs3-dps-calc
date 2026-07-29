"""
Downloads weapon/armour icon images from runescape.wiki into static/weapon-icons/<slug>.png or
static/armour-icons/<slug>.png, resolving each item's raw wikitext `image` field (from its
cached {{Infobox Bonuses}} fields) to its direct file URL via the MediaWiki API, then downloading
as-is. Same approach as fetch_boss_icons.py, generalized to take a target icons dir.

Usage:
    python3 fetch_item_icons.py <weapon-icons|armour-icons> <slug1> <slug2> ...

Reads each slug's cached fields from .scrape-cache/infobox_bonuses/<slug>.json (populated by
fetch_infobox_bonuses.py).
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
CACHE_DIR = PROJECT_ROOT / '.scrape-cache' / 'infobox_bonuses'
REQUEST_DELAY_SECONDS = 0.5

opener = urllib.request.build_opener()
opener.addheaders = [('User-Agent', 'rs3-dps-calc-dev/0.1 (personal project data fetch)')]


def slugify(name: str) -> str:
    return re.sub(r'[^a-zA-Z0-9]+', '-', name).strip('-').lower()


def extract_file_title(image_field: str) -> str | None:
    """Extracts 'File:X.png' from a wikitext image field. Item pages' Infobox Bonuses usually
    store just the bare filename, often with a trailing '{{!}}150px'-style size suffix --
    {{!}} is a wiki template that renders as a literal '|' (used to escape a pipe inside a
    template argument), e.g. 'Black sword equipped.png{{!}}150px' -- strip that suffix first.
    Also handle the [[File:...]] wikilink forms, matching fetch_boss_icons.py's more defensive
    parsing."""
    image_field = re.sub(r'\{\{!\}\}.*$', '', image_field).strip()
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


def fetch_one(slug: str, icons_dir: Path) -> tuple[str, str | None]:
    """Returns (status, error_or_none)."""
    cache_path = CACHE_DIR / f'{slug}.json'
    if not cache_path.exists():
        return ('error', f'no infobox_bonuses cache for slug {slug}')

    with open(cache_path) as f:
        cached = json.load(f)
    fields = cached.get('fields') or {}
    name = cached.get('name', slug)
    out_slug = slugify(name)
    out_path = icons_dir / f'{out_slug}.png'

    if out_path.exists():
        return ('exists', None)

    # Prefer the real inventory icon (from {{Infobox Item}}) over {{Infobox Bonuses}}'s own
    # `image` field, which is a full character-model "equipped" render, not an inventory icon
    # -- see fetch_infobox_bonuses.py's extract_infobox_bonuses for how these are captured.
    image_field = fields.get('inventory_image') or fields.get('image')
    if not image_field:
        return ('error', 'no image field in cached fields')

    file_title = extract_file_title(image_field)
    if not file_title:
        return ('error', f'could not parse file title from {image_field!r}')

    try:
        direct_url = get_direct_url(file_title)
        if not direct_url and file_title.startswith('File:Retro '):
            # Some "retro" skill-cape variants (e.g. "Retro ranged cape (t).png") have no
            # inventory icon file on the wiki at all -- only the non-retro trimmed/base cape
            # does. Fall back to the plain (non-retro) title in that case.
            fallback_title = 'File:' + file_title[len('File:Retro '):]
            direct_url = get_direct_url(fallback_title)
        if not direct_url:
            return ('error', f'no imageinfo for {file_title}')
        with opener.open(direct_url, timeout=20) as resp:
            content = resp.read()
        icons_dir.mkdir(parents=True, exist_ok=True)
        with open(out_path, 'wb') as f:
            f.write(content)
        return ('downloaded', None)
    except Exception as e:
        return ('error', str(e))


def main():
    if len(sys.argv) < 3:
        print('Usage: fetch_item_icons.py <weapon-icons|armour-icons> <slug1> <slug2> ...', file=sys.stderr)
        sys.exit(1)

    icons_dir = PROJECT_ROOT / 'static' / sys.argv[1]
    slugs = sys.argv[2:]

    counts = {'downloaded': 0, 'exists': 0, 'error': 0}
    for i, slug in enumerate(slugs):
        status, error = fetch_one(slug, icons_dir)
        counts[status] += 1
        msg = f'[{i + 1}/{len(slugs)}] {slug}: {status}'
        if error:
            msg += f' ({error})'
        print(msg)
        if status == 'downloaded':
            time.sleep(REQUEST_DELAY_SECONDS)

    print(f'\nDone. {counts["downloaded"]} downloaded, {counts["exists"]} already existed, '
          f'{counts["error"]} errors.')


if __name__ == '__main__':
    main()
