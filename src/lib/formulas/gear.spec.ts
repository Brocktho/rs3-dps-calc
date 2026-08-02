import { describe, expect, it } from 'vitest';
import {
	deriveGearContext,
	deriveHasMeleeWeaponEquipped,
	deriveSetPieceCounts,
	emptyLoadout,
	EQUIPMENT_SLOTS,
	type GearLoadout
} from './gear';

function loadoutWith(slots: Partial<GearLoadout['slots']>): GearLoadout {
	const loadout = emptyLoadout();
	Object.assign(loadout.slots, slots);
	return loadout;
}

describe('emptyLoadout', () => {
	it('has every slot present and null -- the "no missing-key vs unequipped" invariant', () => {
		const loadout = emptyLoadout();
		for (const slot of EQUIPMENT_SLOTS) {
			expect(loadout.slots[slot]).toBeNull();
		}
		expect(Object.keys(loadout.slots)).toHaveLength(EQUIPMENT_SLOTS.length);
	});
});

describe('deriveGearContext', () => {
	it('an empty loadout derives a valid unarmed context, not a throw', () => {
		expect(deriveGearContext(emptyLoadout())).toEqual({
			isTwoHanded: false,
			hasOffHandWeapon: false,
			equippedCapeName: null
		});
	});

	it('a two-handed main hand sets isTwoHanded', () => {
		const gear = deriveGearContext(loadoutWith({ mainHand: { name: 'Ek-ZekKil', setName: null } }));
		expect(gear.isTwoHanded).toBe(true);
		expect(gear.hasOffHandWeapon).toBe(false);
	});

	it('an off-hand WEAPON counts as hasOffHandWeapon; a shield in the same slot does not', () => {
		const dualWield = deriveGearContext(
			loadoutWith({
				mainHand: { name: "Corrupt Vesta's longsword", setName: null },
				offHand: { name: 'Off-hand chaotic claw', setName: null }
			})
		);
		expect(dualWield.isTwoHanded).toBe(false);
		expect(dualWield.hasOffHandWeapon).toBe(true);

		const withShield = deriveGearContext(
			loadoutWith({
				mainHand: { name: "Corrupt Vesta's longsword", setName: null },
				offHand: { name: 'Elder rune round shield', setName: 'Elder rune round shield' }
			})
		);
		expect(withShield.hasOffHandWeapon).toBe(false);
	});

	it('the cape slot name flows through as equippedCapeName', () => {
		const gear = deriveGearContext(
			loadoutWith({ cape: { name: 'Igneous Kal-Ket', setName: 'Igneous Kal-Ket' } })
		);
		expect(gear.equippedCapeName).toBe('Igneous Kal-Ket');
	});

	it('two equal loadouts derive equal contexts (design §2 invariant)', () => {
		const build = () =>
			loadoutWith({
				mainHand: { name: 'Ek-ZekKil', setName: null },
				cape: { name: 'Igneous Kal-Ket', setName: 'Igneous Kal-Ket' }
			});
		expect(deriveGearContext(build())).toEqual(deriveGearContext(build()));
	});
});

describe('deriveSetPieceCounts', () => {
	it('counts pieces per setName; slots with null setName (weapons/ammo/empty) never count', () => {
		const counts = deriveSetPieceCounts(
			loadoutWith({
				head: { name: 'Vestments of havoc hood', setName: 'Vestments of havoc armour' },
				body: { name: 'Vestments of havoc robe top', setName: 'Vestments of havoc armour' },
				legs: { name: 'Vestments of havoc robe bottom', setName: 'Vestments of havoc armour' },
				cape: { name: 'Igneous Kal-Ket', setName: 'Igneous Kal-Ket' },
				mainHand: { name: 'Ek-ZekKil', setName: null }
			})
		);
		expect(counts['Vestments of havoc armour']).toBe(3);
		expect(counts['Igneous Kal-Ket']).toBe(1);
		expect(Object.keys(counts)).toHaveLength(2);
	});
});

describe('deriveHasMeleeWeaponEquipped', () => {
	it('true for a melee main hand, false for ranged or unarmed', () => {
		expect(
			deriveHasMeleeWeaponEquipped(loadoutWith({ mainHand: { name: 'Ek-ZekKil', setName: null } }))
		).toBe(true);
		expect(
			deriveHasMeleeWeaponEquipped(loadoutWith({ mainHand: { name: 'Shortbow', setName: null } }))
		).toBe(false);
		expect(deriveHasMeleeWeaponEquipped(emptyLoadout())).toBe(false);
	});
});
