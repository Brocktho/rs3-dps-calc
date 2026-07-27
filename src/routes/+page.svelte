<script lang="ts">
	import {
		abilities,
		accuracySkillBonus,
		ammo,
		armour,
		baseArmourRating,
		bosses,
		boostedLevel,
		calculateAbilityDamage,
		hitChance,
		hybridNerf,
		NECROMANCY_AFFINITY,
		prayers,
		skillBoosts,
		spells,
		targetArmourRating,
		weapons,
		type Ammo,
		type Armour,
		type BoostableSkill,
		type CombatStyle,
		type GearContext,
		type Prayer,
		type SkillBoost,
		type Spell,
		type TimelinePlacement,
		type Weapon,
		type WeaponConfig
	} from '$lib';
	import { onMount } from 'svelte';
	import MonsterPanel from '$lib/components/MonsterPanel.svelte';
	import Combobox from '$lib/components/Combobox.svelte';
	import ItemStatPopover from '$lib/components/ItemStatPopover.svelte';
	import Timeline from '$lib/components/Timeline.svelte';

	type TabId = 'stats' | 'gear' | 'prayers' | 'config';
	type GearSlotId =
		| 'head'
		| 'torso'
		| 'legs'
		| 'hands'
		| 'feet'
		| 'ring'
		| 'cape'
		| 'necklace'
		| 'mainHand'
		| 'offHand'
		| 'ammo'
		| 'pocket';

	// Grid position mirrors the in-game Worn Equipment interface layout:
	//   .     Head   Pocket
	//   Cape  Neck   Ammo
	//   MH    Torso  OH
	//   .     Legs   .
	//   Hands Feet   Ring
	const GEAR_SLOTS: { id: GearSlotId; label: string; area: string }[] = [
		{ id: 'head', label: 'Head', area: 'head' },
		{ id: 'pocket', label: 'Pocket', area: 'pocket' },
		{ id: 'cape', label: 'Cape', area: 'cape' },
		{ id: 'necklace', label: 'Necklace', area: 'necklace' },
		{ id: 'ammo', label: 'Ammo', area: 'ammo' },
		{ id: 'mainHand', label: 'Main Hand', area: 'main-hand' },
		{ id: 'torso', label: 'Torso', area: 'torso' },
		{ id: 'offHand', label: 'Off Hand', area: 'off-hand' },
		{ id: 'legs', label: 'Legs', area: 'legs' },
		{ id: 'hands', label: 'Hands', area: 'hands' },
		{ id: 'feet', label: 'Feet', area: 'feet' },
		{ id: 'ring', label: 'Ring', area: 'ring' }
	];

	const WEAPON_POISON_OPTIONS = ['N/A', 'base', '+', '++', '+++'] as const;

	// A single combobox lets the user look up any equippable item -- weapon, ammo, or armour
	// -- by name. Each entry knows which gear slot it belongs in and carries the underlying
	// item so we can route the pick without a second lookup.
	type EquipItem =
		| { kind: 'weapon'; item: Weapon }
		| { kind: 'ammo'; item: Ammo }
		| { kind: 'armour'; item: Armour };

	const equipItems: EquipItem[] = [
		...weapons.map((item) => ({ kind: 'weapon', item }) as const),
		...ammo.map((item) => ({ kind: 'ammo', item }) as const),
		...armour.map((item) => ({ kind: 'armour', item }) as const)
	].sort((a, b) => a.item.name.localeCompare(b.item.name));

	const ARMOUR_SLOT_LABELS: Record<Armour['slot'], string> = {
		head: 'Head',
		torso: 'Torso',
		legs: 'Legs',
		hands: 'Hands',
		feet: 'Feet',
		offHand: 'Off Hand (Shield)',
		cape: 'Cape',
		neck: 'Necklace',
		ring: 'Ring'
	};

	function equipSlotLabel(e: EquipItem): string {
		if (e.kind === 'ammo') return 'Ammo';
		if (e.kind === 'armour') return ARMOUR_SLOT_LABELS[e.item.slot];
		if (e.item.slot === 'offHand') return 'Off Hand';
		if (e.item.slot === 'twoHanded') return 'Main Hand (2H)';
		return 'Main Hand';
	}

	// Matches the in-game stat popover format, e.g. "960 (Tier 100)". Floors the value --
	// some stats (e.g. armour) are stored as unrounded fractions since RS3 only floors the
	// final summed total across multiple pieces, but a single piece's own display value is
	// just its own floored value.
	function withTier(value: number, tier: number): string {
		return `${Math.floor(value).toLocaleString()} (Tier ${tier})`;
	}

	const STYLE_BONUS_LABELS = {
		strengthBonus: 'Strength Bonus',
		rangedBonus: 'Ranged Bonus',
		magicBonus: 'Magic Bonus',
		necromancyBonus: 'Necromancy Bonus'
	} as const;

	function armourStatRows(piece: Armour): { label: string; value: string | number }[] {
		const rows: { label: string; value: string | number }[] = [];
		if (piece.armour > 0) rows.push({ label: 'Armour', value: withTier(piece.armour, piece.tier) });
		if (piece.level > 0) rows.push({ label: 'Level req.', value: piece.level });
		if (piece.lifeBonus > 0) rows.splice(1, 0, { label: 'Life Bonus', value: piece.lifeBonus });
		if (piece.prayerBonus > 0) {
			rows.splice(1, 0, { label: 'Prayer Bonus', value: piece.prayerBonus });
		}
		for (const [field, label] of Object.entries(STYLE_BONUS_LABELS) as [
			keyof typeof STYLE_BONUS_LABELS,
			string
		][]) {
			if (piece[field] > 0) rows.splice(1, 0, { label, value: piece[field] });
		}
		return rows;
	}

	let activeTab: TabId = $state('stats');

	// --- Stats tab ---
	let mageLevel: number = $state(99);
	let rangedLevel: number = $state(99);
	let attackLevel: number = $state(99);
	let strengthLevel: number = $state(99);
	let defenceLevel: number = $state(99);
	let necromancyLevel: number = $state(99);

	// HiScores lookup: fetches a player's combat levels from the official RS3 HiScores (via
	// a server-side proxy at /api/hiscores, since the upstream endpoint has no CORS headers)
	// and overwrites the fields above so the user doesn't have to enter them by hand.
	let hiscoresPlayerName: string = $state('');
	let hiscoresStatus: 'idle' | 'loading' | 'error' = $state('idle');
	let hiscoresError: string = $state('');

	async function fetchHiscores() {
		const player = hiscoresPlayerName.trim();
		if (!player) return;
		hiscoresStatus = 'loading';
		hiscoresError = '';
		try {
			const res = await fetch(`/api/hiscores?player=${encodeURIComponent(player)}`);
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Lookup failed (${res.status})`);
			}
			const levels = await res.json();
			attackLevel = levels.attack;
			defenceLevel = levels.defence;
			strengthLevel = levels.strength;
			rangedLevel = levels.ranged;
			mageLevel = levels.magic;
			necromancyLevel = levels.necromancy;
			hiscoresStatus = 'idle';
		} catch (e) {
			hiscoresStatus = 'error';
			hiscoresError = e instanceof Error ? e.message : String(e);
		}
	}

	// Active temporary skill boosts (Overload family, Super/Extreme/Supreme potions). Multiple
	// can be toggled on at once -- boostedLevel() picks the single highest result among
	// whichever active boosts apply to each skill, matching how boosts don't stack in-game.
	let selectedBoostNames: string[] = $state([]);
	const activeBoosts = $derived(skillBoosts.filter((b) => selectedBoostNames.includes(b.name)));

	function toggleBoost(boost: SkillBoost) {
		selectedBoostNames = selectedBoostNames.includes(boost.name)
			? selectedBoostNames.filter((n) => n !== boost.name)
			: [...selectedBoostNames, boost.name];
	}

	const SKILL_ROWS: {
		skill: BoostableSkill;
		label: string;
		icon: string;
		max: number;
	}[] = [
		{ skill: 'attack', label: 'Attack', icon: '/boost-icons/skill-attack.png', max: 120 },
		{ skill: 'strength', label: 'Strength', icon: '/boost-icons/skill-strength.png', max: 120 },
		{ skill: 'defence', label: 'Defence', icon: '/boost-icons/skill-defence.png', max: 99 },
		{ skill: 'ranged', label: 'Ranged', icon: '/boost-icons/skill-ranged.png', max: 120 },
		{ skill: 'magic', label: 'Magic', icon: '/boost-icons/skill-magic.png', max: 120 },
		{
			skill: 'necromancy',
			label: 'Necromancy',
			icon: '/boost-icons/skill-necromancy.png',
			max: 120
		}
	];

	function baseLevelFor(skill: BoostableSkill): number {
		switch (skill) {
			case 'attack':
				return attackLevel;
			case 'strength':
				return strengthLevel;
			case 'defence':
				return defenceLevel;
			case 'ranged':
				return rangedLevel;
			case 'magic':
				return mageLevel;
			case 'necromancy':
				return necromancyLevel;
		}
	}

	function setBaseLevelFor(skill: BoostableSkill, value: number) {
		switch (skill) {
			case 'attack':
				attackLevel = value;
				break;
			case 'strength':
				strengthLevel = value;
				break;
			case 'defence':
				defenceLevel = value;
				break;
			case 'ranged':
				rangedLevel = value;
				break;
			case 'magic':
				mageLevel = value;
				break;
			case 'necromancy':
				necromancyLevel = value;
				break;
		}
	}

	function calculatedLevelFor(skill: BoostableSkill): number {
		return boostedLevel(baseLevelFor(skill), skill, activeBoosts);
	}

	// --- Gear tab ---
	let mainHandWeaponName: string = $state('');
	let offHandWeaponName: string = $state('');
	let ammoName: string = $state('');
	let headArmourName: string = $state('');
	let torsoArmourName: string = $state('');
	let legsArmourName: string = $state('');
	let handsArmourName: string = $state('');
	let feetArmourName: string = $state('');
	let shieldName: string = $state('');
	let capeArmourName: string = $state('');
	let neckArmourName: string = $state('');
	let ringArmourName: string = $state('');
	let pendingItemPick: string = $state('');

	const mainHandWeapon = $derived(weapons.find((w) => w.name === mainHandWeaponName) ?? null);
	const offHandWeapon = $derived(weapons.find((w) => w.name === offHandWeaponName) ?? null);
	const equippedAmmo = $derived(ammo.find((a) => a.name === ammoName) ?? null);
	const headArmour = $derived(armour.find((a) => a.name === headArmourName) ?? null);
	const torsoArmour = $derived(armour.find((a) => a.name === torsoArmourName) ?? null);
	const legsArmour = $derived(armour.find((a) => a.name === legsArmourName) ?? null);
	const handsArmour = $derived(armour.find((a) => a.name === handsArmourName) ?? null);
	const feetArmour = $derived(armour.find((a) => a.name === feetArmourName) ?? null);
	const shield = $derived(armour.find((a) => a.name === shieldName) ?? null);
	const capeArmour = $derived(armour.find((a) => a.name === capeArmourName) ?? null);
	const neckArmour = $derived(armour.find((a) => a.name === neckArmourName) ?? null);
	const ringArmour = $derived(armour.find((a) => a.name === ringArmourName) ?? null);
	const mainHandIsTwoHanded = $derived(mainHandWeapon?.slot === 'twoHanded');

	// The in-game Combat Stats interface shows a "Main-hand Damage" stat (Weapon + Skill
	// Bonus + Damage Bonus, per runescape.wiki/w/Combat_Stats). Only the "Weapon" component
	// is implemented here so far -- confirmed exact match against a user-reported in-game
	// value (Masterwork bow damage 1275 + Bik arrow damage 960 = 2235). For ranged weapons,
	// ammo damage adds to the weapon's own damage stat; for melee/magic it's the weapon's
	// damage stat alone (no separate ammo). Skill Bonus and Damage Bonus formulas aren't
	// verified yet -- see project memory -- so they're intentionally left out rather than
	// shown as an unverified guess.
	const mainHandWeaponDamage = $derived.by(() => {
		if (!mainHandWeapon) return null;
		const ammoDamage = mainHandWeapon.combatStyle === 'ranged' ? (equippedAmmo?.damage ?? 0) : 0;
		return mainHandWeapon.damage + ammoDamage;
	});
	const offHandWeaponDamage = $derived.by(() => {
		if (!offHandWeapon) return null;
		const ammoDamage = offHandWeapon.combatStyle === 'ranged' ? (equippedAmmo?.damage ?? 0) : 0;
		return offHandWeapon.damage + ammoDamage;
	});

	// RS3 keeps each piece's armour value as an unrounded fraction and only floors the final
	// summed total -- flooring each piece before adding them up would undercount (see the
	// doc comment on Armour.armour).
	const totalArmour = $derived(
		Math.floor(
			baseArmourRating(defenceLevel) +
				(headArmour?.armour ?? 0) +
				(torsoArmour?.armour ?? 0) +
				(legsArmour?.armour ?? 0) +
				(handsArmour?.armour ?? 0) +
				(feetArmour?.armour ?? 0) +
				(shield?.armour ?? 0) +
				(capeArmour?.armour ?? 0) +
				(neckArmour?.armour ?? 0) +
				(ringArmour?.armour ?? 0)
		)
	);

	const totalPrayerBonus = $derived(
		(headArmour?.prayerBonus ?? 0) +
			(torsoArmour?.prayerBonus ?? 0) +
			(legsArmour?.prayerBonus ?? 0) +
			(handsArmour?.prayerBonus ?? 0) +
			(feetArmour?.prayerBonus ?? 0) +
			(shield?.prayerBonus ?? 0) +
			(capeArmour?.prayerBonus ?? 0) +
			(neckArmour?.prayerBonus ?? 0) +
			(ringArmour?.prayerBonus ?? 0)
	);

	// Hover state for the stat popovers on filled gear slots.
	let hoveredSlot:
		| 'mainHand'
		| 'offHand'
		| 'ammo'
		| 'head'
		| 'torso'
		| 'legs'
		| 'hands'
		| 'feet'
		| 'cape'
		| 'necklace'
		| 'ring'
		| null = $state(null);

	$effect(() => {
		if (mainHandIsTwoHanded) offHandWeaponName = '';
	});

	// A shield and an off-hand weapon can't be worn at once -- equipping either clears the other.
	$effect(() => {
		if (offHandWeaponName) shieldName = '';
	});
	$effect(() => {
		if (shieldName) offHandWeaponName = '';
	});

	// Single shared "Equip an item" combobox: routes the picked item into whichever slot
	// it belongs in, based on its own type/slot -- not fill order. Ammo goes to the Ammo
	// slot. 'offHand' weapons (e.g. Off-hand chaotic claw) are distinct items from
	// main-hand weapons and always go to Off Hand; 'oneHanded'/'twoHanded' weapons always
	// go to Main Hand (two-handed also clears Off Hand, since it occupies both slots).
	// Armour routes by its own slot; a shield (armour type, Off Hand slot) clears any
	// equipped off-hand weapon via the $effect above, and vice versa.
	$effect(() => {
		const picked = equipItems.find((e) => e.item.name === pendingItemPick);
		if (!picked) return;

		if (picked.kind === 'ammo') {
			ammoName = picked.item.name;
		} else if (picked.kind === 'armour') {
			switch (picked.item.slot) {
				case 'head':
					headArmourName = picked.item.name;
					break;
				case 'torso':
					torsoArmourName = picked.item.name;
					break;
				case 'legs':
					legsArmourName = picked.item.name;
					break;
				case 'hands':
					handsArmourName = picked.item.name;
					break;
				case 'feet':
					feetArmourName = picked.item.name;
					break;
				case 'offHand':
					shieldName = picked.item.name;
					break;
				case 'cape':
					capeArmourName = picked.item.name;
					break;
				case 'neck':
					neckArmourName = picked.item.name;
					break;
				case 'ring':
					ringArmourName = picked.item.name;
					break;
			}
		} else if (picked.item.slot === 'offHand') {
			offHandWeaponName = picked.item.name;
		} else {
			mainHandWeaponName = picked.item.name;
			if (picked.item.slot === 'twoHanded') offHandWeaponName = '';
		}
	});

	// --- Prayers tab ---
	// Players only ever have access to standard Prayers OR Ancient Curses at once, never
	// both -- switching modes clears the other mode's selections, since they can't be active
	// simultaneously in-game.
	let prayerMode: 'prayers' | 'curses' = $state('prayers');
	let selectedPrayerNames: {
		accuracy: string | null;
		damage: string | null;
		armour: string | null;
	} = $state({ accuracy: null, damage: null, armour: null });

	function setPrayerMode(mode: 'prayers' | 'curses') {
		if (prayerMode === mode) return;
		prayerMode = mode;
		selectedPrayerNames = { accuracy: null, damage: null, armour: null };
	}

	// Selecting a prayer fills every slot it covers (e.g. Piety fills accuracy+damage+armour
	// at once, replacing whatever was in each of those slots -- matches how equipping Piety
	// in-game deactivates any single-purpose prayer that was active). Clicking an
	// already-active prayer deactivates it (clears only the slots it was occupying).
	function togglePrayer(prayer: Prayer) {
		const isActive = prayer.slots.every((slot) => selectedPrayerNames[slot] === prayer.name);
		const next = { ...selectedPrayerNames };
		for (const slot of prayer.slots) {
			next[slot] = isActive ? null : prayer.name;
		}
		selectedPrayerNames = next;
	}

	const activePrayers = $derived(
		[selectedPrayerNames.accuracy, selectedPrayerNames.damage, selectedPrayerNames.armour]
			.filter((name, index, all) => name !== null && all.indexOf(name) === index)
			.map((name) => prayers.find((p) => p.name === name))
			.filter((p) => p !== undefined)
	);

	// --- Config tab ---
	let selectedSpellName: string = $state('');
	let hasStatiusWarhammer: boolean = $state(false);
	let hasVulnBomb: boolean = $state(false);
	let hasSmokeCloud: boolean = $state(false);
	let weaponPoison: (typeof WEAPON_POISON_OPTIONS)[number] = $state('N/A');
	// 0-100 for now -- some setups can push this to 120%, deferred until that's actually modeled.
	let startingAdrenaline: number = $state(0);
	let hasRingOfVigour: boolean = $state(false);
	let hasFuryOfTheSmall: boolean = $state(false);

	// --- Monster panel: selected boss for hit chance calculation ---
	let selectedBossName: string = $state('');

	// --- Persistence: restore whatever the user manually entered on their last visit ---
	// Covers Stats/Gear/Config values only -- not transient UI state like pendingItemPick
	// (mid-pick combobox selection) or hiscoresStatus/hiscoresError (in-flight lookup state),
	// which don't make sense to resurrect on reload.
	interface PersistedState {
		mageLevel: number;
		rangedLevel: number;
		attackLevel: number;
		strengthLevel: number;
		defenceLevel: number;
		necromancyLevel: number;
		hiscoresPlayerName: string;
		selectedBoostNames: string[];
		selectedBossName: string;
		prayerMode: 'prayers' | 'curses';
		selectedPrayerNames: { accuracy: string | null; damage: string | null; armour: string | null };
		mainHandWeaponName: string;
		offHandWeaponName: string;
		ammoName: string;
		headArmourName: string;
		torsoArmourName: string;
		legsArmourName: string;
		handsArmourName: string;
		feetArmourName: string;
		shieldName: string;
		capeArmourName: string;
		neckArmourName: string;
		ringArmourName: string;
		selectedSpellName: string;
		hasStatiusWarhammer: boolean;
		hasVulnBomb: boolean;
		hasSmokeCloud: boolean;
		weaponPoison: (typeof WEAPON_POISON_OPTIONS)[number];
		startingAdrenaline: number;
		hasRingOfVigour: boolean;
		hasFuryOfTheSmall: boolean;
		timelinePlacements: TimelinePlacement[];
		timelineStyleFilterEnabled: boolean;
		timelineLength: number;
	}

	const PERSISTENCE_KEY = 'rs3-dps-calc:sheet';

	let hasRestored = $state(false);

	onMount(() => {
		try {
			const raw = localStorage.getItem(PERSISTENCE_KEY);
			if (!raw) return;
			const saved: Partial<PersistedState> = JSON.parse(raw);

			if (typeof saved.mageLevel === 'number') mageLevel = saved.mageLevel;
			if (typeof saved.rangedLevel === 'number') rangedLevel = saved.rangedLevel;
			if (typeof saved.attackLevel === 'number') attackLevel = saved.attackLevel;
			if (typeof saved.strengthLevel === 'number') strengthLevel = saved.strengthLevel;
			if (typeof saved.defenceLevel === 'number') defenceLevel = saved.defenceLevel;
			if (typeof saved.necromancyLevel === 'number') necromancyLevel = saved.necromancyLevel;
			if (typeof saved.hiscoresPlayerName === 'string') {
				hiscoresPlayerName = saved.hiscoresPlayerName;
			}
			if (
				Array.isArray(saved.selectedBoostNames) &&
				saved.selectedBoostNames.every((n) => typeof n === 'string')
			) {
				selectedBoostNames = saved.selectedBoostNames;
			}
			if (typeof saved.selectedBossName === 'string') selectedBossName = saved.selectedBossName;
			if (saved.prayerMode === 'prayers' || saved.prayerMode === 'curses') {
				prayerMode = saved.prayerMode;
			}
			if (
				saved.selectedPrayerNames &&
				typeof saved.selectedPrayerNames === 'object' &&
				['accuracy', 'damage', 'armour'].every(
					(slot) =>
						saved.selectedPrayerNames![slot as keyof typeof saved.selectedPrayerNames] === null ||
						typeof saved.selectedPrayerNames![slot as keyof typeof saved.selectedPrayerNames] ===
							'string'
				)
			) {
				selectedPrayerNames = saved.selectedPrayerNames;
			}

			if (typeof saved.mainHandWeaponName === 'string') {
				mainHandWeaponName = saved.mainHandWeaponName;
			}
			if (typeof saved.offHandWeaponName === 'string') offHandWeaponName = saved.offHandWeaponName;
			if (typeof saved.ammoName === 'string') ammoName = saved.ammoName;
			if (typeof saved.headArmourName === 'string') headArmourName = saved.headArmourName;
			if (typeof saved.torsoArmourName === 'string') torsoArmourName = saved.torsoArmourName;
			if (typeof saved.legsArmourName === 'string') legsArmourName = saved.legsArmourName;
			if (typeof saved.handsArmourName === 'string') handsArmourName = saved.handsArmourName;
			if (typeof saved.feetArmourName === 'string') feetArmourName = saved.feetArmourName;
			if (typeof saved.shieldName === 'string') shieldName = saved.shieldName;
			if (typeof saved.capeArmourName === 'string') capeArmourName = saved.capeArmourName;
			if (typeof saved.neckArmourName === 'string') neckArmourName = saved.neckArmourName;
			if (typeof saved.ringArmourName === 'string') ringArmourName = saved.ringArmourName;

			if (typeof saved.selectedSpellName === 'string') selectedSpellName = saved.selectedSpellName;
			if (typeof saved.hasStatiusWarhammer === 'boolean') {
				hasStatiusWarhammer = saved.hasStatiusWarhammer;
			}
			if (typeof saved.hasVulnBomb === 'boolean') hasVulnBomb = saved.hasVulnBomb;
			if (typeof saved.hasSmokeCloud === 'boolean') hasSmokeCloud = saved.hasSmokeCloud;
			if (
				typeof saved.weaponPoison === 'string' &&
				(WEAPON_POISON_OPTIONS as readonly string[]).includes(saved.weaponPoison)
			) {
				weaponPoison = saved.weaponPoison;
			}
			if (typeof saved.startingAdrenaline === 'number') {
				startingAdrenaline = saved.startingAdrenaline;
			}
			if (typeof saved.hasRingOfVigour === 'boolean') hasRingOfVigour = saved.hasRingOfVigour;
			if (typeof saved.hasFuryOfTheSmall === 'boolean') {
				hasFuryOfTheSmall = saved.hasFuryOfTheSmall;
			}

			if (
				Array.isArray(saved.timelinePlacements) &&
				saved.timelinePlacements.every(
					(p) =>
						p &&
						typeof p.id === 'string' &&
						typeof p.abilityName === 'string' &&
						typeof p.startTick === 'number'
				)
			) {
				timelinePlacements = saved.timelinePlacements;
			}
			if (typeof saved.timelineStyleFilterEnabled === 'boolean') {
				timelineStyleFilterEnabled = saved.timelineStyleFilterEnabled;
			}
			if (typeof saved.timelineLength === 'number') timelineLength = saved.timelineLength;
		} catch {
			// Corrupt or pre-format localStorage entry -- ignore and start fresh rather than
			// throwing on load.
		} finally {
			hasRestored = true;
		}
	});

	// Saves on every change, but only once restore has run -- otherwise the initial default
	// values would overwrite a real saved snapshot before onMount gets a chance to apply it.
	$effect(() => {
		const snapshot: PersistedState = {
			mageLevel,
			rangedLevel,
			attackLevel,
			strengthLevel,
			defenceLevel,
			necromancyLevel,
			hiscoresPlayerName,
			selectedBoostNames,
			selectedBossName,
			prayerMode,
			selectedPrayerNames,
			mainHandWeaponName,
			offHandWeaponName,
			ammoName,
			headArmourName,
			torsoArmourName,
			legsArmourName,
			handsArmourName,
			feetArmourName,
			shieldName,
			capeArmourName,
			neckArmourName,
			ringArmourName,
			selectedSpellName,
			hasStatiusWarhammer,
			hasVulnBomb,
			hasSmokeCloud,
			weaponPoison,
			startingAdrenaline,
			hasRingOfVigour,
			hasFuryOfTheSmall,
			timelinePlacements,
			timelineStyleFilterEnabled,
			timelineLength
		};
		if (!hasRestored) return;
		localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(snapshot));
	});

	const spellsForLevel = $derived(
		spells.filter((s) => s.level <= mageLevel).sort((a, b) => a.name.localeCompare(b.name))
	);
	const selectedSpell = $derived(spells.find((s) => s.name === selectedSpellName) ?? null);

	// --- Ability damage calculation, derived from equipped Main Hand weapon's combat style ---
	const combatStyle = $derived<CombatStyle | null>(mainHandWeapon?.combatStyle ?? null);

	const STYLE_BONUS_FIELD = {
		melee: 'strengthBonus',
		ranged: 'rangedBonus',
		magic: 'magicBonus',
		necromancy: 'necromancyBonus'
	} as const satisfies Record<CombatStyle, keyof Armour>;

	// A piece's damage bonus for the active combat style comes from its own per-style field
	// (e.g. Masterwork ranged armour's rangedBonus doesn't apply while wielding a melee
	// weapon; hybrid items like jewelry or the igneous Kal-Zuk cape set several fields at
	// once and contribute whichever one matches). Per-piece bonuses are floored individually
	// before summing, then fed into the ability damage formula's `b` term as a whole number --
	// confirmed against an exact in-game reading (Masterwork ranged body/legs/cowl:
	// 1870 -> 2009 AD), which only matches when each piece's fractional bonus (e.g. 37.5) is
	// floored before summing, not after.
	const equippedArmourPieces = $derived(
		[
			headArmour,
			torsoArmour,
			legsArmour,
			handsArmour,
			feetArmour,
			shield,
			capeArmour,
			neckArmour,
			ringArmour
		].filter((piece) => piece !== null)
	);
	const totalDamageBonus = $derived.by(() => {
		if (!combatStyle) return 0;
		const field = STYLE_BONUS_FIELD[combatStyle];
		return equippedArmourPieces.reduce((sum, piece) => sum + Math.floor(piece[field]), 0);
	});

	// A prayer/curse applies to the active combat style if it names that style directly, or
	// if it has no style at all (Divine Rage boosts all four styles' damage simultaneously).
	// Only an accuracy- or damage-slot prayer contributes to the respective bonus below --
	// an armour-slot-only prayer (Thick Skin, Leech Defence) has 0 in both fields already.
	const activePrayerAccuracyLevelBonus = $derived(
		combatStyle
			? activePrayers
					.filter((p) => p.style === combatStyle || p.style === null)
					.reduce((sum, p) => sum + p.accuracyLevelBonus, 0)
			: 0
	);
	const activePrayerDamagePercentBonus = $derived(
		combatStyle
			? activePrayers
					.filter((p) => p.style === combatStyle || p.style === null)
					.reduce((sum, p) => sum + p.damagePercentBonus, 0)
			: 0
	);

	// Uses each skill's boosted (calculated) level, not the raw entered level, so active
	// temporary skill boosts actually affect Ability Damage output -- matches the in-game
	// behavior where a boosted Strength/Ranged/Magic level raises ability damage output.
	// This is the DAMAGE formula's level input, so prayer/curse ACCURACY level bonuses don't
	// apply here -- see accuracySkillLevel below for where those apply instead. Prayer/curse
	// damage % bonuses are applied separately, as a multiplier on the final result (see
	// abilityDamageWithPrayerBonus), not folded into this level.
	const skillLevelForStyle = $derived.by(() => {
		switch (combatStyle) {
			case 'magic':
				return calculatedLevelFor('magic');
			case 'ranged':
				return calculatedLevelFor('ranged');
			case 'melee':
				return calculatedLevelFor('strength');
			default:
				return 0;
		}
	});

	// Accuracy's Skill Bonus uses Attack (not Strength) for melee -- Damage and Accuracy
	// draw from different skills for melee, per the wiki's "Attack/Ranged/Magic" accuracy
	// formula vs. "Strength/Ranged/Magic" damage formula. Also uses the boosted level plus
	// any active prayer/curse accuracy bonus.
	const accuracySkillLevel = $derived.by(() => {
		switch (combatStyle) {
			case 'magic':
				return calculatedLevelFor('magic') + activePrayerAccuracyLevelBonus;
			case 'ranged':
				return calculatedLevelFor('ranged') + activePrayerAccuracyLevelBonus;
			case 'melee':
				return calculatedLevelFor('attack') + activePrayerAccuracyLevelBonus;
			default:
				return 0;
		}
	});

	const weaponConfig = $derived<WeaponConfig | null>(
		mainHandWeapon
			? mainHandIsTwoHanded
				? { kind: 'twoHanded', tier: mainHandWeapon.tier }
				: {
						kind: 'dualWield',
						mainHandTier: mainHandWeapon.tier,
						offHandTier: offHandWeapon?.tier ?? 0
					}
			: null
	);

	const result = $derived.by(() => {
		if (!combatStyle || !weaponConfig) {
			return {
				value: null,
				error: 'Equip a Main Hand weapon in the Gear tab to see ability damage.'
			};
		}
		try {
			let styleTier: number | undefined;
			if (combatStyle === 'magic') {
				styleTier = selectedSpell?.level ?? 0;
			} else if (combatStyle === 'ranged') {
				styleTier = equippedAmmo?.tier ?? 0;
			}
			const raw = calculateAbilityDamage({
				style: combatStyle,
				weapon: weaponConfig,
				level: skillLevelForStyle,
				bonus: totalDamageBonus,
				styleTier
			});
			// Prayer/curse damage bonuses are MULTIPLICATIVE on the final ability damage total,
			// per runescape.wiki/w/Ability_damage's "Multiplicative damage buffs" list (which
			// names "Prayer" explicitly) -- distinct from equipment's damage bonus, which is
			// additive inside the formula above via the `bonus` parameter.
			const multiplier = 1 + activePrayerDamagePercentBonus / 100;
			const value =
				multiplier === 1
					? raw
					: {
							mainHand: Math.floor(raw.mainHand * multiplier),
							offHand: Math.floor(raw.offHand * multiplier),
							total: Math.floor(raw.total * multiplier)
						};
			return { value, error: null as string | null };
		} catch (e) {
			return { value: null, error: e instanceof Error ? e.message : String(e) };
		}
	});

	// --- Rotation timeline ---
	let timelinePlacements: TimelinePlacement[] = $state([]);
	let timelineStyleFilterEnabled: boolean = $state(true);
	let timelineLength: number = $state(100);

	const adTotal = $derived(result.value?.total ?? 0);
	const timelineGearContext = $derived<GearContext>({
		isTwoHanded: mainHandIsTwoHanded,
		hasOffHandWeapon: !!offHandWeapon,
		equippedCapeName: capeArmour?.name ?? null
	});

	// --- Accuracy, per https://runescape.wiki/w/Combat_Stats ---
	// Weapon accuracy is main-hand only -- off-hand weapons don't contribute a separate
	// accuracy stat in the Combat Stats interface.
	const weaponAccuracy = $derived(mainHandWeapon?.accuracy ?? 0);
	const accuracySkillBonusValue = $derived(
		combatStyle ? Math.floor(accuracySkillBonus(accuracySkillLevel)) : 0
	);
	// Armour worn off the wielded weapon's combat class penalises accuracy (Hybrid Nerf):
	// confirmed exact against in-game readings (Malevolent cuirass alone: -400; cuirass +
	// greaves: -783).
	const hybridNerfValue = $derived(combatStyle ? hybridNerf(combatStyle, equippedArmourPieces) : 0);
	const totalAccuracy = $derived(
		combatStyle ? weaponAccuracy + accuracySkillBonusValue + hybridNerfValue : null
	);

	// --- Hit chance, per https://runescape.wiki/w/Hit_chance ---
	const selectedBoss = $derived(bosses.find((b) => b.name === selectedBossName) ?? null);

	const hitChanceValue = $derived.by(() => {
		if (!combatStyle || totalAccuracy === null || !selectedBoss) return null;
		const armourRating = targetArmourRating(selectedBoss.armour, selectedBoss.defenceLevel);
		// Necromancy always uses a flat 60 affinity against any target (the wiki's "middle"
		// default value) -- never a per-boss scraped field, since none exists for it.
		const affinity =
			combatStyle === 'necromancy'
				? NECROMANCY_AFFINITY
				: combatStyle === 'melee'
					? selectedBoss.affinityMelee
					: combatStyle === 'ranged'
						? selectedBoss.affinityRanged
						: selectedBoss.affinityMagic;
		return hitChance(affinity, totalAccuracy, armourRating);
	});
</script>

<header class="hud-title">
	<h1>RS3 Ability Damage Calculator</h1>
	<p>
		Formulas from <a href="https://runescape.wiki/w/Ability_damage" target="_blank" rel="noreferrer"
			>runescape.wiki</a
		>.
	</p>
</header>

<div class="hud-columns">
	<div class="hud-column">
		<div class="hud-window">
			<nav class="hud-tabs">
				<button
					type="button"
					class="hud-tab"
					class:active={activeTab === 'stats'}
					onclick={() => (activeTab = 'stats')}
				>
					Stats
				</button>
				<button
					type="button"
					class="hud-tab"
					class:active={activeTab === 'gear'}
					onclick={() => (activeTab = 'gear')}
				>
					Gear
				</button>
				<button
					type="button"
					class="hud-tab"
					class:active={activeTab === 'prayers'}
					onclick={() => (activeTab = 'prayers')}
				>
					Prayers
				</button>
				<button
					type="button"
					class="hud-tab"
					class:active={activeTab === 'config'}
					onclick={() => (activeTab = 'config')}
				>
					Config
				</button>
			</nav>

			<div class="hud-panel">
				{#if activeTab === 'stats'}
					<form
						class="hiscores-lookup"
						onsubmit={(e) => {
							e.preventDefault();
							fetchHiscores();
						}}
					>
						<label class="config-field">
							RSN
							<input
								type="text"
								placeholder="Player name"
								bind:value={hiscoresPlayerName}
								disabled={hiscoresStatus === 'loading'}
							/>
						</label>
						<button
							type="submit"
							disabled={hiscoresStatus === 'loading' || !hiscoresPlayerName.trim()}
						>
							{hiscoresStatus === 'loading' ? 'Loading…' : 'Fetch from HiScores'}
						</button>
					</form>
					{#if hiscoresStatus === 'error'}
						<p class="error">{hiscoresError}</p>
					{/if}

					<div class="stat-rows">
						{#each SKILL_ROWS as row (row.skill)}
							<div class="stat-row">
								<img class="stat-row-icon" src={row.icon} alt={row.label} width="20" height="20" />
								<span class="stat-row-label">{row.label}</span>
								<span class="stat-row-calculated">{calculatedLevelFor(row.skill)}</span>
								<span class="stat-row-slash">/</span>
								<input
									class="stat-row-input"
									type="number"
									min="1"
									max={row.max}
									value={baseLevelFor(row.skill)}
									oninput={(e) =>
										setBaseLevelFor(row.skill, Number((e.target as HTMLInputElement).value))}
								/>
							</div>
						{/each}
					</div>

					<h3 class="boost-list-heading">Boosts</h3>
					<ul class="boost-list">
						{#each skillBoosts as boost (boost.name)}
							{@const active = selectedBoostNames.includes(boost.name)}
							<li>
								<button
									type="button"
									class="boost-row"
									class:active
									onclick={() => toggleBoost(boost)}
									aria-pressed={active}
								>
									<img class="boost-row-icon" src={boost.iconPath} alt="" />
									<span class="boost-row-name">{boost.name}</span>
									{#if active}
										<span class="boost-row-check" aria-hidden="true">✓</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				{:else if activeTab === 'gear'}
					<div class="worn-equipment">
						{#each GEAR_SLOTS as slot (slot.id)}
							<div class="gear-slot" style:grid-area={slot.area} title={slot.label}>
								<span class="gear-slot-label">{slot.label}</span>
								{#if slot.id === 'mainHand'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!mainHandWeapon}
										disabled={!mainHandWeapon}
										style:anchor-name="--mainHand-anchor"
										title={mainHandWeapon ? '' : slot.label}
										onclick={() => {
											mainHandWeaponName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'mainHand')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if mainHandWeapon}
											<img
												src={mainHandWeapon.iconPath}
												alt={mainHandWeapon.name}
												width="32"
												height="32"
											/>
										{/if}
									</button>
								{:else if slot.id === 'offHand'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!offHandWeapon || !!shield}
										disabled={!offHandWeapon && !shield}
										style:anchor-name="--offHand-anchor"
										title={offHandWeapon || shield ? '' : slot.label}
										onclick={() => {
											offHandWeaponName = '';
											shieldName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'offHand')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if offHandWeapon}
											<img
												src={offHandWeapon.iconPath}
												alt={offHandWeapon.name}
												width="32"
												height="32"
											/>
										{:else if shield}
											<img src={shield.iconPath} alt={shield.name} width="32" height="32" />
										{/if}
									</button>
									{#if mainHandIsTwoHanded}
										<small class="gear-slot-note">2H</small>
									{/if}
								{:else if slot.id === 'ammo'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!equippedAmmo}
										disabled={!equippedAmmo}
										style:anchor-name="--ammo-anchor"
										title={equippedAmmo ? '' : slot.label}
										onclick={() => {
											ammoName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'ammo')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if equippedAmmo}
											<img
												src={equippedAmmo.iconPath}
												alt={equippedAmmo.name}
												width="32"
												height="32"
											/>
										{/if}
									</button>
								{:else if slot.id === 'head'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!headArmour}
										disabled={!headArmour}
										style:anchor-name="--head-anchor"
										title={headArmour ? '' : slot.label}
										onclick={() => {
											headArmourName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'head')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if headArmour}
											<img src={headArmour.iconPath} alt={headArmour.name} width="32" height="32" />
										{/if}
									</button>
								{:else if slot.id === 'torso'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!torsoArmour}
										disabled={!torsoArmour}
										style:anchor-name="--torso-anchor"
										title={torsoArmour ? '' : slot.label}
										onclick={() => {
											torsoArmourName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'torso')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if torsoArmour}
											<img
												src={torsoArmour.iconPath}
												alt={torsoArmour.name}
												width="32"
												height="32"
											/>
										{/if}
									</button>
								{:else if slot.id === 'legs'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!legsArmour}
										disabled={!legsArmour}
										style:anchor-name="--legs-anchor"
										title={legsArmour ? '' : slot.label}
										onclick={() => {
											legsArmourName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'legs')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if legsArmour}
											<img src={legsArmour.iconPath} alt={legsArmour.name} width="32" height="32" />
										{/if}
									</button>
								{:else if slot.id === 'hands'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!handsArmour}
										disabled={!handsArmour}
										style:anchor-name="--hands-anchor"
										title={handsArmour ? '' : slot.label}
										onclick={() => {
											handsArmourName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'hands')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if handsArmour}
											<img
												src={handsArmour.iconPath}
												alt={handsArmour.name}
												width="32"
												height="32"
											/>
										{/if}
									</button>
								{:else if slot.id === 'feet'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!feetArmour}
										disabled={!feetArmour}
										style:anchor-name="--feet-anchor"
										title={feetArmour ? '' : slot.label}
										onclick={() => {
											feetArmourName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'feet')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if feetArmour}
											<img src={feetArmour.iconPath} alt={feetArmour.name} width="32" height="32" />
										{/if}
									</button>
								{:else if slot.id === 'cape'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!capeArmour}
										disabled={!capeArmour}
										style:anchor-name="--cape-anchor"
										title={capeArmour ? '' : slot.label}
										onclick={() => {
											capeArmourName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'cape')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if capeArmour}
											<img src={capeArmour.iconPath} alt={capeArmour.name} width="32" height="32" />
										{/if}
									</button>
								{:else if slot.id === 'necklace'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!neckArmour}
										disabled={!neckArmour}
										style:anchor-name="--necklace-anchor"
										title={neckArmour ? '' : slot.label}
										onclick={() => {
											neckArmourName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'necklace')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if neckArmour}
											<img src={neckArmour.iconPath} alt={neckArmour.name} width="32" height="32" />
										{/if}
									</button>
								{:else if slot.id === 'ring'}
									<button
										type="button"
										class="gear-slot-icon"
										class:filled={!!ringArmour}
										disabled={!ringArmour}
										style:anchor-name="--ring-anchor"
										title={ringArmour ? '' : slot.label}
										onclick={() => {
											ringArmourName = '';
											pendingItemPick = '';
										}}
										onmouseenter={() => (hoveredSlot = 'ring')}
										onmouseleave={() => (hoveredSlot = null)}
									>
										{#if ringArmour}
											<img src={ringArmour.iconPath} alt={ringArmour.name} width="32" height="32" />
										{/if}
									</button>
								{:else}
									<div class="gear-slot-icon" aria-hidden="true"></div>
								{/if}
							</div>
						{/each}
					</div>

					{#if mainHandWeapon}
						<ItemStatPopover
							anchorId="mainHand-anchor"
							title={mainHandWeapon.name}
							visible={hoveredSlot === 'mainHand'}
							stats={[
								{ label: 'Damage', value: withTier(mainHandWeapon.damage, mainHandWeapon.tier) },
								{
									label: 'Accuracy',
									value: withTier(mainHandWeapon.accuracy, mainHandWeapon.accuracyTier)
								},
								{ label: 'Level req.', value: mainHandWeapon.level }
							]}
						/>
					{/if}
					{#if offHandWeapon}
						<ItemStatPopover
							anchorId="offHand-anchor"
							title={offHandWeapon.name}
							visible={hoveredSlot === 'offHand'}
							stats={[
								{ label: 'Damage', value: withTier(offHandWeapon.damage, offHandWeapon.tier) },
								{
									label: 'Accuracy',
									value: withTier(offHandWeapon.accuracy, offHandWeapon.accuracyTier)
								},
								{ label: 'Level req.', value: offHandWeapon.level }
							]}
						/>
					{/if}
					{#if equippedAmmo}
						<ItemStatPopover
							anchorId="ammo-anchor"
							title={equippedAmmo.name}
							visible={hoveredSlot === 'ammo'}
							stats={[
								{ label: 'Damage', value: withTier(equippedAmmo.damage, equippedAmmo.tier) },
								{ label: 'Level req.', value: equippedAmmo.level }
							]}
						/>
					{/if}
					{#if shield}
						<ItemStatPopover
							anchorId="offHand-anchor"
							title={shield.name}
							visible={hoveredSlot === 'offHand'}
							stats={armourStatRows(shield)}
						/>
					{/if}
					{#if headArmour}
						<ItemStatPopover
							anchorId="head-anchor"
							title={headArmour.name}
							visible={hoveredSlot === 'head'}
							stats={armourStatRows(headArmour)}
						/>
					{/if}
					{#if torsoArmour}
						<ItemStatPopover
							anchorId="torso-anchor"
							title={torsoArmour.name}
							visible={hoveredSlot === 'torso'}
							stats={armourStatRows(torsoArmour)}
						/>
					{/if}
					{#if legsArmour}
						<ItemStatPopover
							anchorId="legs-anchor"
							title={legsArmour.name}
							visible={hoveredSlot === 'legs'}
							stats={armourStatRows(legsArmour)}
						/>
					{/if}
					{#if handsArmour}
						<ItemStatPopover
							anchorId="hands-anchor"
							title={handsArmour.name}
							visible={hoveredSlot === 'hands'}
							stats={armourStatRows(handsArmour)}
						/>
					{/if}
					{#if feetArmour}
						<ItemStatPopover
							anchorId="feet-anchor"
							title={feetArmour.name}
							visible={hoveredSlot === 'feet'}
							stats={armourStatRows(feetArmour)}
						/>
					{/if}
					{#if capeArmour}
						<ItemStatPopover
							anchorId="cape-anchor"
							title={capeArmour.name}
							visible={hoveredSlot === 'cape'}
							stats={armourStatRows(capeArmour)}
						/>
					{/if}
					{#if neckArmour}
						<ItemStatPopover
							anchorId="necklace-anchor"
							title={neckArmour.name}
							visible={hoveredSlot === 'necklace'}
							stats={armourStatRows(neckArmour)}
						/>
					{/if}
					{#if ringArmour}
						<ItemStatPopover
							anchorId="ring-anchor"
							title={ringArmour.name}
							visible={hoveredSlot === 'ring'}
							stats={armourStatRows(ringArmour)}
						/>
					{/if}

					<div class="gear-picker">
						<label class="config-field">
							Equip an item
							<Combobox
								id="gear-item-combobox"
								options={equipItems}
								bind:value={pendingItemPick}
								getValue={(e) => e.item.name}
								getLabel={(e) => `${e.item.name} (tier ${e.item.tier})`}
								placeholder="Type to search gear..."
							>
								{#snippet option(e: EquipItem)}
									<img src={e.item.iconPath} alt="" width="24" height="24" />
									<span class="option-text">
										<span class="option-label">{e.item.name}</span>
										<small class="option-sub">
											Tier {e.item.tier} &middot; lvl {e.item.level} &middot; {equipSlotLabel(e)}
										</small>
									</span>
								{/snippet}
							</Combobox>
						</label>
					</div>

					<div class="gear-bonuses">
						<h3>Bonuses</h3>
						<div class="stat-rows">
							<div class="stat-row">
								<span class="stat-row-label">Prayer Bonus</span>
								<span class="stat-row-value">{totalPrayerBonus}</span>
							</div>
							<div class="stat-row">
								<span class="stat-row-label">Total Armour</span>
								<span class="stat-row-value">{totalArmour.toLocaleString()}</span>
							</div>
						</div>

						<table class="stat-table">
							<thead>
								<tr>
									<th>Style Bonus</th>
									<th>Melee</th>
									<th>Ranged</th>
									<th>Magic</th>
									<th>Necro</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td></td>
									<td>-</td>
									<td>-</td>
									<td>-</td>
									<td>-</td>
								</tr>
							</tbody>
						</table>

						<div class="stat-rows">
							<div class="stat-row">
								<span class="stat-row-label">Damage reduction (PvE)</span>
								<span class="stat-row-value">-</span>
							</div>
							<div class="stat-row">
								<span class="stat-row-label">Damage reduction (PvP)</span>
								<span class="stat-row-value">-</span>
							</div>
						</div>
					</div>
				{:else if activeTab === 'prayers'}
					<div class="prayer-mode-toggle">
						<button
							type="button"
							class="prayer-mode-button"
							class:active={prayerMode === 'prayers'}
							onclick={() => setPrayerMode('prayers')}
						>
							Prayers
						</button>
						<button
							type="button"
							class="prayer-mode-button"
							class:active={prayerMode === 'curses'}
							onclick={() => setPrayerMode('curses')}
						>
							Ancient Curses
						</button>
					</div>
					<div class="prayer-grid">
						{#each prayers.filter((p) => p.isCurse === (prayerMode === 'curses')) as prayer (prayer.name)}
							{@const isActive = prayer.slots.every(
								(slot) => selectedPrayerNames[slot] === prayer.name
							)}
							<button
								type="button"
								class="prayer-icon-button"
								class:active={isActive}
								title="{prayer.name} (level {prayer.level})"
								onclick={() => togglePrayer(prayer)}
							>
								<img src={prayer.iconPath} alt={prayer.name} width="32" height="32" />
								<span class="prayer-icon-label">{prayer.name}</span>
							</button>
						{/each}
					</div>
				{:else if activeTab === 'config'}
					<div class="config-sections">
						<section class="config-section">
							<h3>Spell</h3>
							<label class="config-field">
								Pick a spell (level ≤ {mageLevel})
								<Combobox
									id="spell-combobox"
									options={spellsForLevel}
									bind:value={selectedSpellName}
									getValue={(s) => s.name}
									getLabel={(s) => `${s.name} (lvl ${s.level})`}
									placeholder="Type to search spells..."
									emptyOptionLabel="-- none --"
								>
									{#snippet option(spell: Spell)}
										<img src={spell.iconPath} alt="" width="24" height="24" />
										<span class="option-text">
											<span class="option-label">{spell.name} (lvl {spell.level})</span>
											<small class="option-sub">Base max hit: {spell.baseMaxHit}</small>
										</span>
									{/snippet}
								</Combobox>
							</label>
						</section>

						<section class="config-section">
							<h3>Effects</h3>
							<label class="config-checkbox">
								<input type="checkbox" bind:checked={hasStatiusWarhammer} />
								Statius Warhammer
							</label>
							<label class="config-checkbox">
								<input type="checkbox" bind:checked={hasVulnBomb} />
								Vuln Bomb
							</label>
							<label class="config-checkbox">
								<input type="checkbox" bind:checked={hasSmokeCloud} />
								Smoke Cloud
							</label>
						</section>

						<section class="config-section">
							<h3>Weapon Poison</h3>
							<label class="config-field">
								Potency
								<select bind:value={weaponPoison}>
									{#each WEAPON_POISON_OPTIONS as option (option)}
										<option value={option}>{option}</option>
									{/each}
								</select>
							</label>
						</section>

						<section class="config-section">
							<h3>Global Unlocks</h3>
							<label class="config-checkbox">
								<input type="checkbox" bind:checked={hasRingOfVigour} />
								Ring of Vigour
							</label>
							<label class="config-checkbox">
								<input type="checkbox" bind:checked={hasFuryOfTheSmall} />
								Fury of the Small
							</label>
						</section>

						<section class="config-section">
							<h3>Rotation</h3>
							<label class="config-field">
								Starting adrenaline (%)
								<input
									type="number"
									min="0"
									max="100"
									value={startingAdrenaline}
									oninput={(e) =>
										(startingAdrenaline = Number((e.target as HTMLInputElement).value))}
								/>
							</label>
						</section>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<div class="hud-column">
		<MonsterPanel bind:selectedBossName hitChance={hitChanceValue} />
	</div>

	<div class="hud-column">
		<div class="hud-window result-window">
			<h2>Ability damage</h2>
			{#if result.error}
				<p class="error">{result.error}</p>
			{:else if result.value}
				<dl>
					<dt>Main hand</dt>
					<dd>{result.value.mainHand}</dd>
					{#if weaponConfig?.kind === 'dualWield'}
						<dt>Off hand</dt>
						<dd>{result.value.offHand}</dd>
					{/if}
					<dt>Total AD</dt>
					<dd class="total">{result.value.total}</dd>
				</dl>
				<dl>
					<dt>Weapon</dt>
					<dd>{weaponAccuracy}</dd>
					<dt>Skill Bonus</dt>
					<dd>{accuracySkillBonusValue}</dd>
					{#if hybridNerfValue !== 0}
						<dt>Hybrid Nerf</dt>
						<dd>{hybridNerfValue}</dd>
					{/if}
					<dt>Accuracy</dt>
					<dd class="total">{totalAccuracy}</dd>
				</dl>
			{/if}
		</div>

		<div class="hud-window result-window">
			<h2>Weapon damage</h2>
			{#if mainHandWeaponDamage === null}
				<p class="error">Equip a Main Hand weapon in the Gear tab to see this.</p>
			{:else}
				<dl>
					<dt>Main hand</dt>
					<dd>{mainHandWeaponDamage}</dd>
					{#if offHandWeaponDamage !== null}
						<dt>Off hand</dt>
						<dd>{offHandWeaponDamage}</dd>
					{/if}
				</dl>
				<p class="stat-note">
					Only the Weapon component is shown. The in-game Main-hand/Off-hand Damage stat also adds a
					Skill Bonus and a Damage Bonus from equipment -- those formulas aren't verified yet, so
					they're left out rather than shown as a guess.
				</p>
			{/if}
		</div>
	</div>
</div>

<div class="timeline-section">
	<Timeline
		{abilities}
		{combatStyle}
		{adTotal}
		{startingAdrenaline}
		{hasRingOfVigour}
		{hasFuryOfTheSmall}
		gearContext={timelineGearContext}
		bind:placements={timelinePlacements}
		bind:styleFilterEnabled={timelineStyleFilterEnabled}
		bind:timelineLength
	/>
</div>

<!-- Guarantees scroll room below the page content so an open combobox popover anchored to an
     input near the bottom of the viewport always has space to render below it, rather than
     the browser flipping/clamping the popup on top of the input it belongs to. -->
<div class="scroll-spacer" aria-hidden="true"></div>

<style>
	:global(body) {
		/* The page is unconditionally dark-themed (not following OS light/dark preference),
		   so tell the browser to render native form controls -- including <select> dropdown
		   popups, which are otherwise OS-chrome and can default to black-on-white -- with
		   dark-appropriate colors regardless of the user's system setting. */
		color-scheme: dark;
		background: #14100c;
		background-image:
			radial-gradient(circle at 20% 10%, rgba(120, 90, 40, 0.15), transparent 40%),
			radial-gradient(circle at 80% 90%, rgba(60, 90, 60, 0.12), transparent 45%);
		color: #e8dcc4;
		font-family: 'Trebuchet MS', system-ui, sans-serif;
	}

	.scroll-spacer {
		height: 100vh;
	}

	.hud-title {
		max-width: 90rem;
		margin: 0 auto;
		padding: 1.5rem 1.5rem 0;
	}

	.hud-title h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		color: #f4d78c;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
	}

	.hud-title p {
		margin: 0;
		font-size: 0.85rem;
		color: #b8a888;
	}

	.hud-title a {
		color: #d8b566;
	}

	/* 3 columns on laptop-sized screens and up, with the calculator column ~1/3 width.
	   Below 1024px, drop to 2 columns at 50/50 (placeholder column moves to a 2nd row). */
	.hud-columns {
		max-width: 90rem;
		margin: 0 auto;
		padding: 1.5rem;
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.25rem;
		align-items: start;
	}

	@media (min-width: 640px) {
		.hud-columns {
			grid-template-columns: 1fr 1fr;
		}
	}

	@media (min-width: 1024px) {
		.hud-columns {
			grid-template-columns: 1fr 1fr 1fr;
		}
	}

	.hud-column {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}

	.timeline-section {
		max-width: 90rem;
		margin: 0 auto;
		padding: 0 1.5rem 1.5rem;
	}

	.hud-window {
		border: 2px solid #5a4a2c;
		border-radius: 6px;
		background: linear-gradient(180deg, #241d14 0%, #1a140d 100%);
		box-shadow:
			0 0 0 1px #0a0704 inset,
			0 4px 12px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}

	.hud-tabs {
		display: flex;
		background: #0f0b07;
		border-bottom: 2px solid #5a4a2c;
	}

	.hud-tab {
		flex: 1;
		padding: 0.6rem 1rem;
		background: transparent;
		border: none;
		border-right: 1px solid #3a2f1c;
		color: #a89468;
		font: inherit;
		font-weight: 600;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.hud-tab:last-child {
		border-right: none;
	}

	.hud-tab:hover {
		background: #241d14;
		color: #e8dcc4;
	}

	.hud-tab.active {
		background: #2e2517;
		color: #f4d78c;
		box-shadow: inset 0 -2px 0 #f4d78c;
	}

	.hud-panel {
		padding: 1.25rem;
	}

	.hiscores-lookup {
		display: flex;
		align-items: flex-end;
		gap: 0.6rem;
		margin-bottom: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid #3a2f1c;
	}

	.hiscores-lookup .config-field {
		flex: 1;
		max-width: none;
	}

	.hiscores-lookup input {
		font-size: 1rem;
		padding: 0.4rem 0.5rem;
		background: #100c08;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		color: #e8dcc4;
	}

	.hiscores-lookup button {
		font: inherit;
		font-weight: 600;
		padding: 0.45rem 0.9rem;
		background: #2e2517;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		color: #f4d78c;
		cursor: pointer;
		white-space: nowrap;
	}

	.hiscores-lookup button:hover:not(:disabled) {
		background: #3a2f1c;
	}

	.hiscores-lookup button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* Mirrors the OSRS wiki DPS calculator's stats layout: skill icon, then the boost-adjusted
	   "calculated" level, then a small entry box for the player's real level. Numbers here
	   never exceed 3 digits, so the input is sized just wide enough for that. */
	.stat-rows {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}

	.stat-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: #cbb98e;
	}

	.stat-row-icon {
		flex-shrink: 0;
	}

	.stat-row-label {
		flex: 1;
	}

	.stat-row-calculated {
		font-weight: 600;
		color: #f4d78c;
		min-width: 2rem;
		text-align: right;
	}

	.stat-row-slash {
		color: #6b5d42;
	}

	.stat-row-input {
		width: 3.2rem;
		font-size: 0.9rem;
		padding: 0.3rem 0.35rem;
		background: #100c08;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		color: #e8dcc4;
		text-align: center;
	}

	.config-field select {
		font-size: 1rem;
		padding: 0.4rem 0.5rem;
		background: #100c08;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		color: #e8dcc4;
	}

	/* color-scheme: dark (set globally) handles most browsers' native dropdown popup
	   chrome, but some UAs still need option-level colors set directly to avoid
	   low-contrast black-on-dark text in the open list. */
	.config-field select option {
		background-color: #100c08;
		color: #e8dcc4;
	}

	.stat-row-input:focus,
	.config-field select:focus {
		outline: 2px solid #f4d78c;
		outline-offset: 1px;
	}

	.boost-list-heading {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #a89468;
	}

	.boost-list {
		list-style: none;
		margin: 0;
		padding: 0.25rem;
		max-height: 14rem;
		overflow-y: auto;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		background: #100c08;
	}

	.boost-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.35rem 0.5rem;
		background: transparent;
		border: none;
		border-radius: 3px;
		color: #e8dcc4;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	/* Potion bottle icons are naturally tall/narrow (~19x31), not square -- constrain only
	   height and let width scale to match so the art isn't stretched into a square. */
	.boost-row-icon {
		height: 24px;
		width: auto;
		flex-shrink: 0;
	}

	.boost-row:hover {
		background: #241d14;
	}

	.boost-row.active {
		background: #2e2517;
	}

	.boost-row-name {
		flex: 1;
	}

	.boost-row-check {
		color: #6fbf6f;
		font-weight: 700;
	}

	/* Mirrors the in-game Worn Equipment interface silhouette: head at top-center, cape/neck/ammo
	   below it, weapons flanking the torso, legs below that, and hands/feet/ring along the bottom. */
	.worn-equipment {
		display: grid;
		grid-template-columns: repeat(3, minmax(4.5rem, 1fr));
		grid-template-areas:
			'.         head      pocket'
			'cape      necklace  ammo'
			'main-hand torso     off-hand'
			'.         legs      .'
			'hands     feet      ring';
		gap: 0.6rem;
		justify-items: center;
	}

	.gear-slot {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		width: 100%;
	}

	.gear-slot-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #a89468;
		text-align: center;
	}

	.gear-slot-icon {
		width: 3rem;
		height: 3rem;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid #3a2f1c;
		border-radius: 4px;
		background: radial-gradient(circle at 50% 40%, #241d14 0%, #150f0a 100%);
		box-shadow: inset 0 0 0 1px #0a0704;
		cursor: default;
	}

	.gear-slot-icon.filled {
		border-color: #7a6534;
		box-shadow:
			inset 0 0 0 1px #0a0704,
			0 0 6px rgba(244, 215, 140, 0.25);
		cursor: pointer;
	}

	.gear-slot-icon.filled:hover {
		border-color: #d97757;
		box-shadow:
			inset 0 0 0 1px #0a0704,
			0 0 8px rgba(217, 119, 87, 0.5);
	}

	.gear-slot-icon:disabled {
		opacity: 1;
	}

	.gear-slot-note {
		color: #8a7a5c;
		font-size: 0.65rem;
	}

	.gear-picker {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid #3a2f1c;
	}

	.gear-bonuses {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid #3a2f1c;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.gear-bonuses h3 {
		margin: 0;
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #d8b566;
	}

	.stat-rows {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
	}

	.stat-row-label {
		color: #cbb98e;
	}

	.stat-row-value {
		color: #e8dcc4;
		font-weight: 600;
	}

	.stat-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	.stat-table th,
	.stat-table td {
		padding: 0.4rem 0.5rem;
		text-align: center;
		border: 1px solid #3a2f1c;
	}

	.stat-table th {
		color: #d8b566;
		background: #1a140d;
		font-weight: 600;
		text-transform: uppercase;
		font-size: 0.7rem;
		letter-spacing: 0.03em;
	}

	.stat-table td {
		color: #a89468;
	}

	.stat-table th:first-child {
		text-align: left;
	}

	.prayer-mode-toggle {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.prayer-mode-button {
		flex: 1;
		padding: 0.5rem;
		font: inherit;
		font-weight: 600;
		background: #100c08;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		color: #a89468;
		cursor: pointer;
	}

	.prayer-mode-button:hover {
		background: #241d14;
		color: #e8dcc4;
	}

	.prayer-mode-button.active {
		background: #2e2517;
		color: #f4d78c;
		border-color: #f4d78c;
	}

	.prayer-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
		gap: 0.5rem;
	}

	.prayer-icon-button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 0.5rem 0.3rem;
		background: #100c08;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		color: #a89468;
		cursor: pointer;
		text-align: center;
	}

	.prayer-icon-button:hover {
		background: #241d14;
	}

	.prayer-icon-button.active {
		background: #2e2517;
		border-color: #f4d78c;
		box-shadow: 0 0 0 1px #f4d78c;
	}

	.prayer-icon-label {
		font-size: 0.65rem;
		line-height: 1.2;
		color: #cbb98e;
	}

	.config-sections {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.config-section h3 {
		margin: 0 0 0.6rem;
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #d8b566;
		border-bottom: 1px solid #3a2f1c;
		padding-bottom: 0.3rem;
	}

	.config-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: #cbb98e;
		max-width: 22rem;
	}

	.config-checkbox {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: #e8dcc4;
		margin-bottom: 0.4rem;
	}

	.result-window {
		padding: 1.25rem;
	}

	.result-window h2 {
		margin: 0 0 0.75rem;
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #d8b566;
	}

	.option-text {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}

	.option-sub {
		color: #a89468;
		font-size: 0.75em;
	}

	dl {
		display: grid;
		grid-template-columns: auto auto;
		gap: 0.35rem 1.25rem;
		margin: 0;
	}

	dt {
		font-weight: 600;
		color: #cbb98e;
	}

	dd {
		margin: 0;
		color: #e8dcc4;
	}

	.total {
		font-size: 1.25rem;
		color: #f4d78c;
	}

	.error {
		color: #d97757;
		margin: 0;
	}

	.stat-note {
		font-size: 0.8rem;
		color: #8a7a5c;
		margin: 0.6rem 0 0;
	}
</style>
