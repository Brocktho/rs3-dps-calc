"""
Converts cached {{Infobox Bonuses}} field dumps (.scrape-cache/infobox_bonuses/<slug>.json,
produced by fetch_infobox_bonuses.py) directly into Weapon or Armour objects matching
src/lib/data/weapons.schema.ts / armour.schema.ts, so adding a new item no longer means
hand-transcribing wiki fields into a TS object literal.

The wiki's own `slot` field tells us weapon vs. armour vs. ammo/jewelry:
  - 'weapon', '2h', 'off-hand weapon' -> Weapon (slot oneHanded/twoHanded/offHand respectively)
  - anything else (head, body, legs, hands, feet, off-hand, cape, neck, ring, ammo) -> Armour
    ('off-hand' without "weapon" means a shield, not a weapon)
  - 'ammo' is skipped entirely -- ammo.ts has its own separate schema/pipeline, not covered here.

Usage:
    python3 convert_item_stats.py <slug1> <slug2> ... > out.json

Then merge the 'weapons' and 'armour' halves of the output into
src/lib/data/json/weapons.json / armour.json respectively.

NOTE: iconPath always needs a manual follow-up -- this script guesses a path from the item's
slugified name (matching the existing convention), but the actual icon file must still be
sourced/added to static/weapon-icons or static/armour-icons separately.
"""
import json
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = PROJECT_ROOT / '.scrape-cache' / 'infobox_bonuses'

ATTACK_STYLE_MAP = {
    'arrow': 'Arrow', 'arrows': 'Arrow',
    'bolt': 'Bolt', 'bolts': 'Bolt',
    'thrown': 'Thrown',
    'slash': 'Slash', 'slashing': 'Slash',
    'stab': 'Stab', 'stabbing': 'Stab',
    'crush': 'Crush', 'crushing': 'Crush',
    'spell': 'Spell'
}

ARMOUR_SLOT_MAP = {
    'head': 'head',
    'body': 'torso',
    'torso': 'torso',
    'legs': 'legs',
    'hands': 'hands',
    'feet': 'feet',
    'off-hand': 'offHand',
    'cape': 'cape',
    'neck': 'neck',
    'ring': 'ring'
}


def slugify(name: str) -> str:
    return re.sub(r'[^a-zA-Z0-9]+', '-', name).strip('-').lower()


def strip_html_comments(value: str) -> str:
    """Some wiki field values embed an HTML comment right in the value, e.g.
    'Stab <!--Stab is the correct style-->' on Masuta's warspear -- strip it before parsing
    so the comment text doesn't leak into the parsed value."""
    return re.sub(r'<!--.*?-->', '', value).strip()


def parse_number(value: str | None) -> float | None:
    if value is None:
        return None
    cleaned = strip_html_comments(value).replace(',', '').strip()
    if not cleaned or cleaned.lower() == 'n/a':
        return None
    try:
        n = float(cleaned)
        return int(n) if n == int(n) else n
    except ValueError:
        return None


COMBAT_STYLE_SKILL_NAMES = {
    'melee': ('attack', 'strength'),
    'ranged': ('ranged',),
    'magic': ('magic',),
    'necromancy': ('necromancy',)
}


def parse_level(requirements: str | None, combat_style: str | None = None) -> int:
    """Extracts a level from '{{sc|skill|70}}'-style requirement text (some pages instead use
    '{{skill clickpic|skill|70}}' -- same shape, different template name, both handled). Some
    items list multiple skill requirements at once (e.g. Lunar staff:
    '{{sc|defence|40}}, {{sc|magic|65}}') -- when a combat_style is given, prefer that style's
    own skill requirement over an unrelated one (e.g. use the magic|65 for a magic weapon's
    level, not defence|40). Falls back to the highest level found if no style-matching
    requirement exists. 'None'/no match gets 0."""
    if not requirements:
        return 0
    pairs = re.findall(r'\{\{(?:sc|skill clickpic)\|([a-zA-Z]+)\|(\d+)', requirements)
    if not pairs:
        return 0
    if combat_style:
        for skill_name, level in pairs:
            if skill_name.lower() in COMBAT_STYLE_SKILL_NAMES.get(combat_style, ()):
                return int(level)
    return max(int(level) for _, level in pairs)


def parse_bool_yes_no(value: str | None) -> bool:
    return (value or '').strip().lower() == 'yes'


def convert_one(slug: str) -> dict:
    """Returns {'kind': 'weapon'|'armour'|None, 'item': dict|None, 'warnings': list[str],
    'error': str|None}."""
    path = CACHE_DIR / f'{slug}.json'
    if not path.exists():
        return {'kind': None, 'item': None, 'warnings': [], 'error': f'no cache file for slug {slug}'}

    with open(path) as f:
        cached = json.load(f)

    if cached.get('error'):
        return {'kind': None, 'item': None, 'warnings': [], 'error': cached['error']}

    fields = cached.get('fields') or {}
    name = cached['name']
    warnings = []

    if name.lower().startswith('augmented '):
        # Augmented items (Invention) are the exact same combat item with a gizmo slotted in --
        # not a distinct weapon/armour piece. Augmenting is planned as its own separate config
        # tab rather than doubling the roster with an "Augmented X" duplicate of every entry.
        return {'kind': None, 'item': None, 'warnings': [], 'error': 'augmented item, handled separately (not a distinct combat item)'}

    if strip_html_comments(fields.get('isrecolour') or '').lower() in ('y', 'yes'):
        # Cosmetic dye/recolor variants (e.g. "Ek-ZekKil (blood)", "Abyssal whip (yellow)",
        # "Gilded dragon pickaxe") are the identical combat item to the base version, just a
        # different color -- not a distinct weapon/armour piece worth doubling the roster over.
        # The wiki's own `isrecolour` field is the authoritative signal here (name-suffix
        # pattern matching like "(blood)"/"(Barrows)" was tried and found unreliable in both
        # directions -- some recolors don't use a bracketed suffix at all, e.g. "Gilded dragon
        # pickaxe", and some bracketed names aren't recolors).
        return {'kind': None, 'item': None, 'warnings': [], 'error': 'cosmetic recolor/dye variant, not a distinct combat item'}

    raw_slot = strip_html_comments(fields.get('slot') or '').lower()
    if not raw_slot:
        return {'kind': None, 'item': None, 'warnings': [], 'error': 'no slot field'}

    if raw_slot == 'ammo':
        return {'kind': None, 'item': None, 'warnings': [], 'error': 'ammo item, not covered by this converter'}

    class_raw = strip_html_comments(fields.get('class') or '').lower()
    combat_style_map = {'melee': 'melee', 'ranged': 'ranged', 'magic': 'magic', 'necromancy': 'necromancy'}

    if raw_slot in ('weapon', '2h', 'off-hand weapon'):
        combat_style = combat_style_map.get(class_raw)
        if combat_style is None:
            warnings.append(f'unrecognized weapon class {class_raw!r}, defaulting to melee')
            combat_style = 'melee'

        style_raw = strip_html_comments(fields.get('style') or '').lower()
        attack_style = ATTACK_STYLE_MAP.get(style_raw)
        if attack_style is None:
            warnings.append(f'unrecognized attack style {style_raw!r}, defaulting to Crush')
            attack_style = 'Crush'

        slot = {'weapon': 'oneHanded', '2h': 'twoHanded', 'off-hand weapon': 'offHand'}[raw_slot]

        tier = parse_number(fields.get('tier'))
        damage_tier = parse_number(fields.get('damageTier'))
        accuracy_tier = parse_number(fields.get('accuracyTier'))
        # Weapon.damage/.accuracy are "the raw stat shown in-game" (Weapon.damage's own doc
        # comment), and the in-game tooltip always shows a whole number -- round the wiki's
        # more-precise decimal value to match, rather than storing e.g. 1147.5 verbatim.
        damage = parse_number(fields.get('damage'))
        damage = round(damage) if damage is not None else None
        accuracy = parse_number(fields.get('accuracy'))
        accuracy = round(accuracy) if accuracy is not None else None

        if tier is None:
            warnings.append('missing tier field')
        if damage is None:
            warnings.append('missing damage field')
        if accuracy is None:
            warnings.append('missing accuracy field')

        final_damage = damage if damage is not None else 0
        final_accuracy = accuracy if accuracy is not None else 1

        if final_damage == 0 and final_accuracy == 0:
            # Cosmetic/quest-prop "weapons" (greegrees, delivery parcels, novelty surfboards)
            # with no real combat stat at all -- not equipment worth showing in a DPS calculator.
            return {'kind': None, 'item': None, 'warnings': [],
                    'error': 'no non-zero combat stat (damage and accuracy both 0), excluded as not real equipment'}

        weapon = {
            'name': name,
            'combatStyle': combat_style,
            'attackStyle': attack_style,
            'slot': slot,
            'level': parse_level(fields.get('requirements'), combat_style),
            'tier': damage_tier if damage_tier is not None else (tier if tier is not None else 1),
            'damage': final_damage,
            'accuracy': final_accuracy,
            'accuracyTier': accuracy_tier if accuracy_tier is not None else (tier if tier is not None else 1),
            'membersOnly': parse_bool_yes_no(fields.get('members')),
            'iconPath': f'/weapon-icons/{slugify(name)}.png'
        }
        return {'kind': 'weapon', 'item': weapon, 'warnings': warnings, 'error': None}

    # Anything else is armour (including jewelry/capes, which have slot values like
    # 'neck'/'ring'/'cape' directly, and shields, which are slot='off-hand' with type='shield').
    armour_slot = ARMOUR_SLOT_MAP.get(raw_slot)
    if armour_slot is None:
        return {'kind': None, 'item': None, 'warnings': [], 'error': f'unrecognized armour slot {raw_slot!r}'}

    armour_class = combat_style_map.get(class_raw)  # None for 'none'/hybrid jewelry, matching Armour.armourClass

    tier = parse_number(fields.get('tier'))
    armour_tier = parse_number(fields.get('armourTier'))
    armour_damage_tier = parse_number(fields.get('armourDamageTier'))
    armour_value = parse_number(fields.get('armour'))
    life = parse_number(fields.get('life'))
    prayer = parse_number(fields.get('prayer'))
    strength = parse_number(fields.get('strength'))
    ranged = parse_number(fields.get('ranged'))
    magic = parse_number(fields.get('magic'))
    necromancy = parse_number(fields.get('necromancy'))

    item_type_raw = strip_html_comments(fields.get('type') or '').lower()
    has_damage_bonus = any(v is not None for v in (strength, ranged, magic, necromancy))
    if item_type_raw == 'shield':
        item_type = 'shield'
    elif 'power' in item_type_raw or has_damage_bonus:
        # Jewelry/hybrid capes (e.g. Amulet of glory, Igneous Kal-Zuk) have no explicit `type`
        # field at all, but grant a per-style damage bonus just like Power armour -- treat that
        # as the signal, rather than defaulting silently to Tank. Some hybrid items (Igneous
        # Kal-Zuk) use a compound value like "power hybrid" -- substring match, not equality.
        # Also covers `type = pvp` (Barbarian Assault fighter/healer/runner hats, Statius's
        # armour, etc.) -- "pvp" describes the item's game context, not its armour-mechanics
        # category, and these items always carry a real damage bonus alongside their armour
        # value just like Power armour, so has_damage_bonus wins even when a non-power/shield
        # `type` label is present.
        item_type = 'power'
    else:
        item_type = 'tank'

    # Jewelry has no armour value and no armourTier at all (armourTier is literally 'n/a') --
    # its `tier` field is really the item's armourDamageTier, which drives its damage bonus, so
    # prefer armourDamageTier over the bare `tier` in that specific case (see Armour.tier doc
    # comment). Otherwise prefer armourTier, then bare tier, then armourDamageTier.
    if armour_tier is None and armour_value is None and armour_damage_tier is not None:
        resolved_tier = armour_damage_tier
    else:
        resolved_tier = armour_tier if armour_tier is not None else (
            tier if tier is not None else (armour_damage_tier if armour_damage_tier is not None else 1)
        )
    if tier is None and armour_tier is None and armour_damage_tier is None:
        warnings.append('missing tier/armourTier/armourDamageTier field')

    final_armour_value = armour_value if armour_value is not None else 0
    final_life = int(life) if life is not None else 0
    final_prayer = int(prayer) if prayer is not None else 0
    final_strength = strength if strength is not None else 0
    final_ranged = ranged if ranged is not None else 0
    final_magic = magic if magic is not None else 0
    final_necromancy = necromancy if necromancy is not None else 0

    if not any((final_armour_value, final_life, final_prayer, final_strength,
                final_ranged, final_magic, final_necromancy)):
        # Utility jewelry/cosmetics (teleport rings, partyhats, plain gem jewelry) with no
        # combat-relevant stat at all -- not equipment worth showing in a DPS calculator, even
        # though they're genuinely equippable items in-game.
        return {'kind': None, 'item': None, 'warnings': [],
                'error': 'no non-zero combat stat, excluded as not real equipment'}

    armour = {
        'name': name,
        'setName': name,  # caller may override with a real set name when merging a known set
        'armourClass': armour_class,
        'slot': armour_slot,
        'type': item_type,
        'level': parse_level(fields.get('requirements')),
        'tier': resolved_tier,
        'armour': final_armour_value,
        'lifeBonus': final_life,
        'prayerBonus': final_prayer,
        'strengthBonus': final_strength,
        'rangedBonus': final_ranged,
        'magicBonus': final_magic,
        'necromancyBonus': final_necromancy,
        'membersOnly': parse_bool_yes_no(fields.get('members')),
        'iconPath': f'/armour-icons/{slugify(name)}.png'
    }
    return {'kind': 'armour', 'item': armour, 'warnings': warnings, 'error': None}


def main():
    if len(sys.argv) < 2:
        print('Usage: convert_item_stats.py <slug1> <slug2> ...', file=sys.stderr)
        sys.exit(1)

    weapons = []
    armour = []
    skipped = []
    warn_count = 0
    for slug in sys.argv[1:]:
        result = convert_one(slug)
        if result['error']:
            skipped.append((slug, result['error']))
            continue
        if result['warnings']:
            warn_count += 1
            for w in result['warnings']:
                print(f'WARN {slug}: {w}', file=sys.stderr)
        if result['kind'] == 'weapon':
            weapons.append(result['item'])
        elif result['kind'] == 'armour':
            armour.append(result['item'])

    print(f'{len(weapons)} weapons, {len(armour)} armour, {len(skipped)} skipped, {warn_count} with warnings', file=sys.stderr)
    for slug, err in skipped:
        print(f'SKIP {slug}: {err}', file=sys.stderr)

    print(json.dumps({'weapons': weapons, 'armour': armour}, indent='\t'))


if __name__ == '__main__':
    main()
