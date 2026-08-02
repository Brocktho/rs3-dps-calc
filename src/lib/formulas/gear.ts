/**
 * Stage 1 of the resolution pipeline (docs/resolution-pipeline-design.md §2): the player's
 * equipment as an immutable GearLoadout value object, and the derivation functions that are the
 * ONLY way to get the views the engine consumes (GearContext, setPieceCounts,
 * hasMeleeWeaponEquipped). Invariant: two equal loadouts derive equal contexts.
 *
 * Today there is a single loadout for the whole timeline; under the gear buffer (design §5) a
 * mid-timeline swap produces a NEW loadout derived from this one -- loadouts are never mutated,
 * so they can be shared by reference across gear-buffer segments and compared cheaply.
 */
import { weapons } from '../data/weapons';
import type { GearContext } from './context';

export type EquipmentSlot =
	| 'head'
	| 'body'
	| 'legs'
	| 'hands'
	| 'feet'
	| 'cape'
	| 'neck'
	| 'ring'
	| 'ring2'
	| 'mainHand'
	| 'offHand'
	| 'ammo'
	| 'pocket'
	| 'aura';

export const EQUIPMENT_SLOTS: EquipmentSlot[] = [
	'head',
	'body',
	'legs',
	'hands',
	'feet',
	'cape',
	'neck',
	'ring',
	'ring2',
	'mainHand',
	'offHand',
	'ammo',
	'pocket',
	'aura'
];

export interface EquippedItem {
	name: string;
	/** Armour.setName when the item belongs to a set -- the ONLY key set-effect counting uses.
	 *  Null for weapons/ammo and for items whose record isn't in the data (yet). */
	setName: string | null;
	// Stats (accuracy, armour, damage, ...) come from the existing JSON loaders by name.
}

/** One complete equipment state. Every slot is always present; empty slots are null so "what
 *  changed" diffs never have to distinguish missing-key from unequipped. */
export interface GearLoadout {
	slots: Record<EquipmentSlot, EquippedItem | null>;
}

/** All slots empty -- the base every loadout builder starts from, so a builder only assigns the
 *  slots it actually has data for and the "every slot present" invariant holds by construction. */
export function emptyLoadout(): GearLoadout {
	return {
		slots: Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null])) as Record<
			EquipmentSlot,
			EquippedItem | null
		>
	};
}

const weaponByName = new Map(weapons.map((w) => [w.name, w]));

/**
 * The one derivation function for GearContext (design §2) -- GearContext is computed from a
 * loadout, never stored. Weapon facts (two-handedness, off-hand-ness) come from the weapons
 * loader by name; an off-hand item that isn't a known weapon is treated as a shield/armour piece.
 */
export function deriveGearContext(loadout: GearLoadout): GearContext {
	const mainHand = loadout.slots.mainHand;
	const offHand = loadout.slots.offHand;
	return {
		isTwoHanded: !!mainHand && weaponByName.get(mainHand.name)?.slot === 'twoHanded',
		hasOffHandWeapon: !!offHand && weaponByName.has(offHand.name),
		equippedCapeName: loadout.slots.cape?.name ?? null
	};
}

/** How many pieces of each armour set are equipped (keyed by Armour.setName) -- pure counting
 *  over the loadout's own setName fields; weapons/ammo carry setName null and never count. */
export function deriveSetPieceCounts(loadout: GearLoadout): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const slot of EQUIPMENT_SLOTS) {
		const setName = loadout.slots[slot]?.setName;
		if (setName) counts[setName] = (counts[setName] ?? 0) + 1;
	}
	return counts;
}

/** Whether the main-hand is a melee weapon -- gates e.g. Vestments of havoc's 4-piece bonus. */
export function deriveHasMeleeWeaponEquipped(loadout: GearLoadout): boolean {
	const mainHand = loadout.slots.mainHand;
	return !!mainHand && weaponByName.get(mainHand.name)?.combatStyle === 'melee';
}
