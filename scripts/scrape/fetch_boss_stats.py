"""
Fetches {{Infobox Monster}} fields from runescape.wiki boss pages, with a persistent local
cache so re-running for new fields doesn't require re-hitting the wiki.

Cache: .scrape-cache/boss_stats/<slug>.json (one file per boss, raw field dict from the
first/primary version only -- see extract_infobox_monster).

Usage:
    python3 fetch_boss_stats.py names.json output.json
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
REQUEST_DELAY_SECONDS = 0.5  # ~2 requests/sec

opener = urllib.request.build_opener()
opener.addheaders = [('User-Agent', 'rs3-dps-calc-dev/0.1 (personal project data fetch)')]


def slugify(name: str) -> str:
    return re.sub(r'[^a-zA-Z0-9]+', '-', name).strip('-').lower()


def fetch_wikitext(page_title: str) -> str | None:
    url = f'https://runescape.wiki/api.php?action=parse&page={urllib.parse.quote(page_title)}&prop=wikitext&format=json'
    with opener.open(url, timeout=15) as resp:
        data = json.load(resp)
    if 'error' in data:
        return None
    return data['parse']['wikitext']['*']


def find_balanced_template(wikitext: str, marker: str) -> str | None:
    idx = wikitext.find(marker)
    if idx == -1:
        return None
    depth = 0
    i = idx
    start = idx
    while i < len(wikitext):
        if wikitext[i:i + 2] == '{{':
            depth += 1
            i += 2
            continue
        if wikitext[i:i + 2] == '}}':
            depth -= 1
            i += 2
            if depth == 0:
                break
            continue
        i += 1
    return wikitext[start:i]


def extract_infobox_monster(wikitext: str) -> dict | None:
    """
    Returns the FIRST version's fields for every versioned field (fieldN=... -> field),
    plus any unsuffixed fields as-is. Confirmed across a sample of ~10 bosses that version1
    is consistently the primary/normal combat form (unlike weapons, where version1 sometimes
    meant a degraded/broken state) -- but this is worth re-checking if a specific boss's
    numbers look wrong, per the project's established habit of sanity-checking scraped tiers.
    """
    block = find_balanced_template(wikitext, '{{Infobox Monster')
    if block is None:
        return None

    raw_fields: dict[str, str] = {}
    for line in block.split('\n'):
        m = re.match(r'\|\s*([a-zA-Z0-9_]+)\s*=\s*(.*)', line.strip())
        if m:
            raw_fields[m.group(1)] = m.group(2).strip()

    # Collapse versioned fields (fieldN) down to the field's version-1 value, preferring an
    # explicit "1"-suffixed field over the bare field name when both exist (some fields are
    # only versioned for a subset of bosses).
    fields: dict[str, str] = {}
    versioned_bases = set()
    for key in raw_fields:
        m = re.match(r'^(.*?)(\d+)$', key)
        if m and m.group(1):
            versioned_bases.add(m.group(1))

    for key, value in raw_fields.items():
        m = re.match(r'^(.*?)(\d+)$', key)
        if m and m.group(1) in versioned_bases:
            base, num = m.group(1), m.group(2)
            if num == '1':
                fields[base] = value
        else:
            if key not in versioned_bases:
                fields[key] = value

    return fields


def parse_number(value: str | None) -> float | None:
    """Strips commas/whitespace and parses a number; returns None if not parseable."""
    if value is None:
        return None
    cleaned = value.replace(',', '').strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def load_cached(name: str) -> dict | None:
    path = CACHE_DIR / f'{slugify(name)}.json'
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def save_cache(name: str, fields: dict | None, error: str | None = None):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f'{slugify(name)}.json'
    payload = {'name': name, 'fields': fields, 'error': error}
    with open(path, 'w') as f:
        json.dump(payload, f, indent=2)


def fetch_one(name: str) -> dict:
    cached = load_cached(name)
    if cached is not None:
        return {**cached, 'fromCache': True}

    try:
        wt = fetch_wikitext(name)
        if wt is None:
            save_cache(name, None, 'page not found')
            return {'name': name, 'fields': None, 'error': 'page not found', 'fromCache': False}
        fields = extract_infobox_monster(wt)
        if fields is None:
            save_cache(name, None, 'no Infobox Monster found')
            return {'name': name, 'fields': None, 'error': 'no Infobox Monster found', 'fromCache': False}
        save_cache(name, fields, None)
        return {'name': name, 'fields': fields, 'error': None, 'fromCache': False}
    except Exception as e:
        save_cache(name, None, str(e))
        return {'name': name, 'fields': None, 'error': str(e), 'fromCache': False}


def main():
    if len(sys.argv) != 3:
        print('Usage: fetch_boss_stats.py <names.json> <output.json>', file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1]) as f:
        names = json.load(f)

    results = []
    fetched_count = 0
    for i, name in enumerate(names):
        result = fetch_one(name)
        results.append(result)
        source = 'cache' if result['fromCache'] else 'wiki'
        status = 'OK' if result['error'] is None else f"ERROR: {result['error']}"
        print(f'[{i + 1}/{len(names)}] ({source}) {name}: {status}')
        if not result['fromCache']:
            fetched_count += 1
            time.sleep(REQUEST_DELAY_SECONDS)

    with open(sys.argv[2], 'w') as f:
        json.dump(results, f, indent=2)

    errors = [r for r in results if r['error'] is not None]
    print(f'\nDone. {len(results)} total, {fetched_count} freshly fetched, '
          f'{len(results) - fetched_count} from cache, {len(errors)} errors.')
    for r in errors:
        print(f"  ERROR: {r['name']}: {r['error']}")


if __name__ == '__main__':
    main()
