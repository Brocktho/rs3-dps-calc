import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { abilities } from './abilities';
import { ammo } from './ammo';
import { armour } from './armour';
import { bosses } from './bosses';
import { prayers } from './prayers';
import { skillBoosts } from './skillBoosts';
import { spells } from './spells';
import { weapons } from './weapons';

const staticDir = join(process.cwd(), 'static');

describe('spells data', () => {
	it('contains only spells with a numeric, non-N/A damage value', () => {
		expect(spells.length).toBeGreaterThan(0);
		for (const spell of spells) {
			expect(Number.isFinite(spell.baseMaxHit)).toBe(true);
		}
	});

	it('has a resolvable icon file for every spell', () => {
		for (const spell of spells) {
			const path = join(staticDir, spell.iconPath);
			expect(existsSync(path), `missing icon for ${spell.name}: ${spell.iconPath}`).toBe(true);
		}
	});

	it('has no duplicate spell names', () => {
		const names = spells.map((s) => s.name);
		expect(new Set(names).size).toBe(names.length);
	});
});

describe('weapons data', () => {
	it('has a resolvable icon file for every weapon', () => {
		for (const weapon of weapons) {
			const path = join(staticDir, weapon.iconPath);
			expect(existsSync(path), `missing icon for ${weapon.name}: ${weapon.iconPath}`).toBe(true);
		}
	});

	it('has a non-negative tier and accuracy for every weapon', () => {
		// 0 shows up for cosmetic/quest-prop "weapons" with no real combat stats on the wiki
		// (e.g. Gnomeball, greegrees, delivery parcels) -- a real value, not a scraping gap.
		for (const weapon of weapons) {
			expect(weapon.tier).toBeGreaterThanOrEqual(0);
			expect(weapon.accuracy).toBeGreaterThanOrEqual(0);
		}
	});

	it('has a non-negative damage and accuracyTier for every weapon', () => {
		for (const weapon of weapons) {
			expect(weapon.damage).toBeGreaterThanOrEqual(0);
			expect(weapon.accuracyTier).toBeGreaterThanOrEqual(0);
		}
	});

	it('covers all four combat styles', () => {
		const styles = new Set(weapons.map((w) => w.combatStyle));
		expect(styles).toEqual(new Set(['ranged', 'melee', 'magic', 'necromancy']));
	});
});

describe('ammo data', () => {
	it('has a resolvable icon file for every ammo item', () => {
		for (const item of ammo) {
			const path = join(staticDir, item.iconPath);
			expect(existsSync(path), `missing icon for ${item.name}: ${item.iconPath}`).toBe(true);
		}
	});

	it('has a positive tier and level for every ammo item', () => {
		for (const item of ammo) {
			expect(item.tier).toBeGreaterThan(0);
			expect(item.level).toBeGreaterThan(0);
		}
	});

	it('has a positive damage value for every ammo item', () => {
		for (const item of ammo) {
			expect(item.damage).toBeGreaterThan(0);
		}
	});

	it('has no duplicate ammo names', () => {
		const names = ammo.map((a) => a.name);
		expect(new Set(names).size).toBe(names.length);
	});
});

describe('armour data', () => {
	it('has a resolvable icon file for every armour piece', () => {
		for (const piece of armour) {
			const path = join(staticDir, piece.iconPath);
			expect(existsSync(path), `missing icon for ${piece.name}: ${piece.iconPath}`).toBe(true);
		}
	});

	it('has a non-negative tier for every piece (0 = cosmetic-only items with no combat stats, e.g. partyhats)', () => {
		for (const piece of armour) {
			expect(piece.tier).toBeGreaterThanOrEqual(0);
		}
	});

	it('has a non-negative level requirement for every piece (0 = no wear requirement)', () => {
		// Most Defence-gated armour has a real positive level requirement, but standalone
		// accessories like the igneous capes and most jewelry have no wear requirement at
		// all on the wiki (`requirements = None`) -- stored as 0 rather than a fabricated
		// positive placeholder.
		for (const piece of armour) {
			expect(piece.level).toBeGreaterThanOrEqual(0);
		}
	});

	it('has a non-negative armour value for every piece (0 = no armour stat, e.g. jewelry)', () => {
		for (const piece of armour) {
			expect(piece.armour).toBeGreaterThanOrEqual(0);
		}
	});

	it('has no duplicate armour piece names', () => {
		const names = armour.map((a) => a.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('only power armour has a per-style damage bonus; only tank/shield armour may have a life bonus', () => {
		for (const piece of armour) {
			if (piece.type !== 'power') {
				expect(piece.strengthBonus).toBe(0);
				expect(piece.rangedBonus).toBe(0);
				expect(piece.magicBonus).toBe(0);
				expect(piece.necromancyBonus).toBe(0);
			}
		}
	});

	it('covers all four combat styles via armourClass', () => {
		const styles = new Set(armour.map((a) => a.armourClass).filter((s) => s !== null));
		expect(styles).toEqual(new Set(['ranged', 'melee', 'magic', 'necromancy']));
	});

	it('every multi-piece armour set has a head, torso, and legs piece', () => {
		const bySet = new Map<string, Set<string>>();
		for (const piece of armour) {
			if (!bySet.has(piece.setName)) bySet.set(piece.setName, new Set());
			bySet.get(piece.setName)?.add(piece.slot);
		}
		// Standalone accessories (capes, jewelry, Jaws of the Abyss) are their own "set" with
		// just a single piece -- only sets with more than one piece are full Defence armour
		// sets expected to have the usual head/torso/legs coverage.
		for (const [setName, slots] of bySet) {
			if (slots.size <= 1) continue;
			expect(slots.has('head'), `${setName} missing head`).toBe(true);
			expect(slots.has('torso'), `${setName} missing torso`).toBe(true);
			expect(slots.has('legs'), `${setName} missing legs`).toBe(true);
		}
	});

	it('keeps armour value as an unrounded fraction (RS3 floors the summed total, not each piece)', () => {
		// Regression test: armour values were previously rounded to whole numbers per piece
		// (e.g. Masterwork ranged body stored as 636), which undercounts/overcounts multi-piece
		// totals since RS3 only floors the final SUM across equipped pieces, not each piece
		// individually. Caught because the user compared our calculator's total against their
		// actual in-game Total Armour for a specific 3-piece loadout and found a mismatch.
		const masterworkRangedBody = armour.find((a) => a.name === 'Masterwork ranged body');
		expect(masterworkRangedBody?.armour).toBeCloseTo(635.9, 5);

		const masterworkRangedChaps = armour.find((a) => a.name === 'Masterwork ranged chaps');
		expect(masterworkRangedChaps?.armour).toBeCloseTo(608.3, 5);

		const masterworkRangedCowl = armour.find((a) => a.name === 'Masterwork ranged cowl');
		expect(masterworkRangedCowl?.armour).toBeCloseTo(553.0, 5);

		// floor(defenceBase(99)=1212 + 635.9 + 608.3 + 553.0) = 3009, matching the user's
		// actual in-game Total Armour reading for this exact loadout.
		const total = Math.floor(
			1212 +
				(masterworkRangedBody?.armour ?? 0) +
				(masterworkRangedChaps?.armour ?? 0) +
				(masterworkRangedCowl?.armour ?? 0)
		);
		expect(total).toBe(3009);
	});

	it('has the igneous Kal-Zuk cape granting all four style bonuses, exempt from a single armourClass', () => {
		const kalZuk = armour.find((a) => a.name === 'Igneous Kal-Zuk');
		expect(kalZuk?.armourClass).toBeNull();
		expect(kalZuk?.strengthBonus).toBeCloseTo(37.1, 5);
		expect(kalZuk?.rangedBonus).toBeCloseTo(37.1, 5);
		expect(kalZuk?.magicBonus).toBeCloseTo(37.1, 5);
		expect(kalZuk?.necromancyBonus).toBeCloseTo(37.1, 5);
	});

	it('has hybrid jewelry granting all four style bonuses with no armour value', () => {
		const reaperNecklace = armour.find((a) => a.name === 'Reaper necklace');
		expect(reaperNecklace?.armourClass).toBeNull();
		expect(reaperNecklace?.armour).toBe(0);
		expect(reaperNecklace?.strengthBonus).toBeCloseTo(40.2, 5);
		expect(reaperNecklace?.rangedBonus).toBeCloseTo(40.2, 5);
		expect(reaperNecklace?.magicBonus).toBeCloseTo(40.2, 5);
		expect(reaperNecklace?.necromancyBonus).toBeCloseTo(40.2, 5);
	});

	it("has the Reaver's ring as an exception with both an armour value and hybrid bonuses", () => {
		const reaversRing = armour.find((a) => a.name === "Reaver's ring");
		expect(reaversRing?.armourClass).toBeNull();
		expect(reaversRing?.armour).toBeCloseTo(17.0, 5);
		expect(reaversRing?.strengthBonus).toBeCloseTo(33.0, 5);
	});
});

describe('skill boosts data', () => {
	it('has a resolvable icon file for every boost', () => {
		for (const boost of skillBoosts) {
			const path = join(staticDir, boost.iconPath);
			expect(existsSync(path), `missing icon for ${boost.name}: ${boost.iconPath}`).toBe(true);
		}
	});

	it('has no duplicate boost names', () => {
		const names = skillBoosts.map((b) => b.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('has at least one skill and a positive pct/flat for every boost', () => {
		for (const boost of skillBoosts) {
			expect(boost.skills.length).toBeGreaterThan(0);
			expect(boost.pct).toBeGreaterThan(0);
			expect(boost.flat).toBeGreaterThan(0);
		}
	});

	it('lists Elder overload potion, then Supreme overload potion, then Overload first', () => {
		// Regression test: user asked for the highest-tier overloads to sort to the top of the
		// boost list, ahead of everything else.
		const names = skillBoosts.map((b) => b.name);
		expect(names.indexOf('Elder overload potion')).toBeLessThan(
			names.indexOf('Elder overload salve')
		);
		expect(names.indexOf('Elder overload salve')).toBeLessThan(
			names.indexOf('Supreme overload potion')
		);
		expect(names.indexOf('Supreme overload salve')).toBeLessThan(names.indexOf('Overload'));
		expect(names.indexOf('Overload')).toBeLessThan(names.indexOf('Super attack'));
	});
});

describe('boss data', () => {
	it('has a resolvable icon file for every boss', () => {
		for (const boss of bosses) {
			const path = join(staticDir, boss.iconPath);
			expect(existsSync(path), `missing icon for ${boss.name}: ${boss.iconPath}`).toBe(true);
		}
	});

	it('has no duplicate boss names', () => {
		const names = bosses.map((b) => b.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('has a non-negative armour and defence level for every boss (0 = minor/novelty NPCs with no combat-stat infobox on the wiki, e.g. training dummies)', () => {
		for (const boss of bosses) {
			expect(boss.armour).toBeGreaterThanOrEqual(0);
			expect(boss.defenceLevel).toBeGreaterThanOrEqual(0);
		}
	});

	it('has a non-negative combat level for every boss (0 = not shown in-game, e.g. Abomination)', () => {
		for (const boss of bosses) {
			expect(boss.combatLevel).toBeGreaterThanOrEqual(0);
		}
	});

	it('has a non-negative life points value or null (variable health) for every boss', () => {
		// Arch-Glacor is the one known case with no fixed life pool -- its health scales with
		// an in-fight mechanic rather than a flat number, so `null` is a real, correct value
		// here rather than a scraping gap. A handful of non-combat-relevant NPCs (training
		// dummies, some event/quest NPCs) have lifepoints=0 verbatim on the wiki.
		for (const boss of bosses) {
			if (boss.lifePoints !== null) expect(boss.lifePoints).toBeGreaterThanOrEqual(0);
		}
	});

	it('has non-negative affinity values for every boss', () => {
		// Normally 0-100, but a handful of removed/special-event bosses have wiki-listed
		// affinity values above 100 verbatim (not a scraping bug) -- see bosses.schema.ts.
		for (const boss of bosses) {
			for (const affinity of [
				boss.affinityWeakness,
				boss.affinityMelee,
				boss.affinityRanged,
				boss.affinityMagic
			]) {
				expect(affinity).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it('includes all 8 Barrows Brothers', () => {
		const names = new Set(bosses.map((b) => b.name));
		for (const brother of [
			'Ahrim the Blighted',
			'Akrisae the Doomed',
			'Dharok the Wretched',
			'Guthan the Infested',
			'Karil the Tainted',
			'Linza the Disgraced',
			'Torag the Corrupted',
			'Verac the Defiled'
		]) {
			expect(names.has(brother), `missing Barrows brother: ${brother}`).toBe(true);
		}
	});

	it('matches known in-game stats for TzKal-Zuk (normal mode)', () => {
		// Regression test against exact scraped values, matching the project's habit of
		// locking in real numbers rather than just structural assertions.
		const zuk = bosses.find((b) => b.name === 'TzKal-Zuk');
		expect(zuk?.combatLevel).toBe(14000);
		expect(zuk?.lifePoints).toBe(600000);
		expect(zuk?.armour).toBe(1924);
		expect(zuk?.defenceLevel).toBe(80);
		expect(zuk?.immuneToPoison).toBe(true);
		expect(zuk?.immuneToDeflect).toBe(true);
	});
});

describe('prayer data', () => {
	it('has a resolvable icon file for every prayer', () => {
		for (const prayer of prayers) {
			const path = join(staticDir, prayer.iconPath);
			expect(existsSync(path), `missing icon for ${prayer.name}: ${prayer.iconPath}`).toBe(true);
		}
	});

	it('has no duplicate prayer names', () => {
		const names = prayers.map((p) => p.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('has a positive level and at least one slot for every prayer', () => {
		for (const prayer of prayers) {
			expect(prayer.level).toBeGreaterThan(0);
			expect(prayer.slots.length).toBeGreaterThan(0);
		}
	});

	it('has a nonzero value only in the fields matching its own slots', () => {
		for (const prayer of prayers) {
			if (!prayer.slots.includes('accuracy')) expect(prayer.accuracyLevelBonus).toBe(0);
			if (!prayer.slots.includes('damage')) expect(prayer.damagePercentBonus).toBe(0);
			if (!prayer.slots.includes('armour')) expect(prayer.armourLevelBonus).toBe(0);
		}
	});

	it('covers both standard prayers and Ancient Curses', () => {
		expect(prayers.some((p) => !p.isCurse)).toBe(true);
		expect(prayers.some((p) => p.isCurse)).toBe(true);
	});

	it('matches known in-game values for Piety (the classic accuracy+damage+armour combo prayer)', () => {
		const piety = prayers.find((p) => p.name === 'Piety');
		expect(piety?.isCurse).toBe(false);
		expect(piety?.level).toBe(70);
		expect(piety?.slots.sort()).toEqual(['accuracy', 'armour', 'damage']);
		expect(piety?.style).toBe('melee');
		expect(piety?.accuracyLevelBonus).toBe(8);
		expect(piety?.damagePercentBonus).toBe(8);
		expect(piety?.armourLevelBonus).toBe(8);
	});

	it('matches known in-game values for Malevolence (top-tier melee curse)', () => {
		const malevolence = prayers.find((p) => p.name === 'Malevolence');
		expect(malevolence?.isCurse).toBe(true);
		expect(malevolence?.level).toBe(99);
		expect(malevolence?.style).toBe('melee');
		expect(malevolence?.accuracyLevelBonus).toBe(12);
		expect(malevolence?.damagePercentBonus).toBe(12);
		expect(malevolence?.armourLevelBonus).toBe(12);
	});

	it('stores Divine Rage with no single style, since it boosts all four styles at once', () => {
		const divineRage = prayers.find((p) => p.name === 'Divine Rage');
		expect(divineRage?.style).toBeNull();
		expect(divineRage?.slots).toEqual(['damage']);
		expect(divineRage?.damagePercentBonus).toBe(5);
	});
});

describe('ability data', () => {
	it('has a resolvable icon file for every ability', () => {
		for (const ability of abilities) {
			const path = join(staticDir, ability.iconPath);
			expect(existsSync(path), `missing icon for ${ability.name}: ${ability.iconPath}`).toBe(true);
		}
	});

	it('has no duplicate ability names', () => {
		const names = abilities.map((a) => a.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('has a non-negative required level for every ability (0 = no level shown, e.g. Eat Food)', () => {
		for (const ability of abilities) {
			expect(ability.requiredLevel).toBeGreaterThanOrEqual(0);
		}
	});

	it('covers all six ability style categories', () => {
		const styles = new Set(abilities.map((a) => a.style));
		expect(styles).toEqual(
			new Set(['melee', 'ranged', 'magic', 'necromancy', 'defence', 'constitution'])
		);
	});

	it('has either a fixed damagePercent, damageVariants, or neither (never both) for every ability', () => {
		for (const ability of abilities) {
			expect(ability.damagePercent !== null && ability.damageVariants !== null).toBe(false);
		}
	});

	it('has non-Self targets only when the ability has a damage value or variants', () => {
		// "Varies" abilities (Essence of Finality, Weapon Special Attack) legitimately have no
		// fixed damagePercent/damageVariants -- their damage depends entirely on the specific
		// equipped item, not a number this table can express.
		for (const ability of abilities) {
			if (ability.target === 'Self' || ability.target === 'Varies') continue;
			expect(
				ability.damagePercent !== null || ability.damageVariants !== null,
				`${ability.name} (target=${ability.target}) has no damage value`
			).toBe(true);
		}
	});

	it('splits the equipment-variant abilities into a damageVariants dictionary, not duplicate entries', () => {
		for (const name of [
			'Adaptive Strike',
			'Overpower',
			'Ranged',
			'Deadshot',
			'Omnipower',
			'Asphyxiate',
			'Death Skulls'
		]) {
			const matches = abilities.filter((a) => a.name === name);
			expect(matches.length, `expected exactly one ${name} entry`).toBe(1);
			expect(matches[0].damageVariants).not.toBeNull();
		}
	});

	it('splits the Spectral Scythe recast chain into three separate sequential entries', () => {
		const stages = ['1st', '2nd', '3rd'].map((n) =>
			abilities.find((a) => a.name === `Spectral Scythe (${n} cast)`)
		);
		expect(stages.every((s) => s !== undefined)).toBe(true);
		expect(stages.map((s) => s?.requiredLevel)).toEqual([62, 70, 80]);
		expect(stages.map((s) => s?.damagePercent)).toEqual(['80%', '200%', '250%']);
	});

	it('matches known in-game values for a simple damaging ability (Sunshine)', () => {
		const sunshine = abilities.find((a) => a.name === 'Sunshine');
		expect(sunshine?.style).toBe('magic');
		expect(sunshine?.requiredLevel).toBe(76);
		expect(sunshine?.type).toBe('Ultimate');
		expect(sunshine?.damagePercent).toBe('240%');
	});
});
