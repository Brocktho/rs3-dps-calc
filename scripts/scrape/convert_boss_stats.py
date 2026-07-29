"""
Converts cached {{Infobox Monster}} field dumps (.scrape-cache/boss_stats/<slug>.json, produced
by fetch_boss_stats.py) directly into Boss objects matching src/lib/data/bosses.schema.ts, so
adding a new boss no longer means hand-transcribing wiki fields into a TS object literal.

Usage:
    python3 convert_boss_stats.py <slug1> <slug2> ... > new_bosses.json

Then manually review new_bosses.json (icon paths won't exist yet -- see NOTE below) and merge
into src/lib/data/json/bosses.json.

NOTE: iconPath always needs a manual follow-up -- this script guesses
'/boss-icons/<slug>.png' from the name, matching the existing convention, but the actual icon
file must still be sourced/added to static/boss-icons separately.
"""
import json
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = PROJECT_ROOT / '.scrape-cache' / 'boss_stats'

# Bosses confirmed to have no traditional combat stats at all (skilling bosses using
# {{Infobox NPC}}) -- not a scraping gap, so callers should skip these rather than treat a
# missing lifepoints field as an error.
KNOWN_NO_COMBAT_STATS = {'Croesus', 'The Gate of Elidinis'}


def slugify(name: str) -> str:
    return re.sub(r'[^a-zA-Z0-9]+', '-', name).strip('-').lower()


def parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    cleaned = value.replace(',', '').strip()
    if not cleaned or cleaned.lower() == 'varies':
        return None
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def parse_weakness(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if cleaned.lower() in ('none', 'nothing', ''):
        return None
    return cleaned


def parse_bool_yes_no(value: str | None) -> bool:
    return (value or '').strip().lower() == 'yes'


def parse_attack_styles(value: str | None) -> list[str]:
    if value is None:
        return []
    # Normalize "Range" -> "ranged" (wiki inconsistency) and split on comma with flexible spacing.
    parts = re.split(r'\s*,\s*', value.strip())
    normalized = []
    for part in parts:
        p = part.strip().lower()
        if p == 'range':
            p = 'ranged'
        if p:
            normalized.append(p)
    return normalized


def convert_one(slug: str) -> dict:
    """Returns {'boss': dict|None, 'warnings': list[str], 'error': str|None}."""
    path = CACHE_DIR / f'{slug}.json'
    if not path.exists():
        return {'boss': None, 'warnings': [], 'error': f'no cache file for slug {slug}'}

    with open(path) as f:
        cached = json.load(f)

    if cached.get('error'):
        return {'boss': None, 'warnings': [], 'error': cached['error']}

    fields = cached.get('fields') or {}
    name = cached['name']
    warnings = []

    if name in KNOWN_NO_COMBAT_STATS:
        return {'boss': None, 'warnings': [], 'error': f'{name} is a known skilling boss (no combat stats), skipping'}

    life_points = parse_int(fields.get('lifepoints'))
    if life_points is None and 'lifepoints' in fields:
        # Present but non-numeric (e.g. "Varies") -- a real null, not a missing-field gap.
        warnings.append('lifepoints present but non-numeric; stored as null (variable health)')

    combat_level = parse_int(fields.get('level')) or 0
    armour = parse_int(fields.get('armour'))
    defence_level = parse_int(fields.get('defence'))

    if armour is None:
        warnings.append('missing armour field')
    if defence_level is None:
        warnings.append('missing defence field')

    boss = {
        'name': name,
        'combatLevel': combat_level,
        'lifePoints': life_points,
        'armour': armour if armour is not None else 0,
        'defenceLevel': defence_level if defence_level is not None else 0,
        'weakness': parse_weakness(fields.get('weakness')),
        'affinityWeakness': parse_int(fields.get('aff_weakness')) or 0,
        'affinityMelee': parse_int(fields.get('aff_melee')) or 0,
        'affinityRanged': parse_int(fields.get('aff_ranged')) or 0,
        'affinityMagic': parse_int(fields.get('aff_magic')) or 0,
        'maxHitMelee': parse_int(fields.get('max_melee')) or 0,
        'maxHitRanged': parse_int(fields.get('max_ranged')) or 0,
        'maxHitMagic': parse_int(fields.get('max_magic')) or 0,
        'maxHitNecromancy': parse_int(fields.get('max_necromancy')) or 0,
        'accuracyMelee': parse_int(fields.get('acc_melee')) or 0,
        'accuracyRanged': parse_int(fields.get('acc_ranged')) or 0,
        'accuracyMagic': parse_int(fields.get('acc_magic')) or 0,
        'accuracyNecromancy': parse_int(fields.get('acc_necromancy')) or 0,
        'attackStyles': parse_attack_styles(fields.get('style')),
        'immuneToPoison': parse_bool_yes_no(fields.get('immune_to_poison')),
        'immuneToStun': parse_bool_yes_no(fields.get('immune_to_stun')),
        'immuneToDeflect': parse_bool_yes_no(fields.get('immune_to_deflect')),
        'immuneToDrain': parse_bool_yes_no(fields.get('immune_to_drain')),
        'iconPath': f'/boss-icons/{slugify(name)}.png'
    }

    if not boss['attackStyles']:
        warnings.append('no attackStyles parsed from style field')

    return {'boss': boss, 'warnings': warnings, 'error': None}


def main():
    if len(sys.argv) < 2:
        print('Usage: convert_boss_stats.py <slug1> <slug2> ...', file=sys.stderr)
        sys.exit(1)

    results = []
    had_error = False
    for slug in sys.argv[1:]:
        result = convert_one(slug)
        if result['error']:
            print(f'SKIP {slug}: {result["error"]}', file=sys.stderr)
            had_error = True
            continue
        for w in result['warnings']:
            print(f'WARN {slug}: {w}', file=sys.stderr)
        results.append(result['boss'])

    print(json.dumps(results, indent='\t'))
    if had_error:
        sys.exit(1)


if __name__ == '__main__':
    main()
