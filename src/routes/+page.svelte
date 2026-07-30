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
		computeDamageSeries,
		resolveAdrenaline,
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
	import { encodeShareState, decodeShareState } from '$lib/shareState';

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

	// const WEAPON_POISON_OPTIONS = ['N/A', 'base', '+', '++', '+++'] as const; // unused while the Weapon Poison config section is disabled

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
		ring: 'Ring',
		pocket: 'Pocket'
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

	// --- Setups: independent gear/stats/prayers/config + timeline configurations the user can
	// switch between and compare. Everything a user can configure in the Stats/Gear/Prayers/Config
	// tabs, plus the rotation timeline itself, lives inside one Setup object -- switching the active
	// tab swaps out the whole configuration. A newly-created setup starts as a deep copy of the
	// currently active one, so iterating on a variant doesn't mean starting from scratch.
	interface Setup {
		id: string;
		label: string;
		mageLevel: number;
		rangedLevel: number;
		attackLevel: number;
		strengthLevel: number;
		defenceLevel: number;
		necromancyLevel: number;
		selectedBoostNames: string[];
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
		prayerMode: 'prayers' | 'curses';
		selectedPrayerNames: { accuracy: string | null; damage: string | null; armour: string | null };
		selectedSpellName: string;
		// hasStatiusWarhammer: boolean; // not yet implemented in the damage/formula engine
		// hasVulnBomb: boolean; // not yet implemented in the damage/formula engine
		// hasSmokeCloud: boolean; // not yet implemented in the damage/formula engine
		// weaponPoison: (typeof WEAPON_POISON_OPTIONS)[number]; // not yet implemented in the damage/formula engine
		startingAdrenaline: number;
		hasRingOfVigour: boolean;
		hasFuryOfTheSmall: boolean;
		timelinePlacements: TimelinePlacement[];
		timelineStyleFilterEnabled: boolean;
		timelineLength: number;
	}

	function createSetup(label: string): Setup {
		return {
			id: crypto.randomUUID(),
			label,
			mageLevel: 99,
			rangedLevel: 99,
			attackLevel: 99,
			strengthLevel: 99,
			defenceLevel: 99,
			necromancyLevel: 99,
			selectedBoostNames: [],
			mainHandWeaponName: '',
			offHandWeaponName: '',
			ammoName: '',
			headArmourName: '',
			torsoArmourName: '',
			legsArmourName: '',
			handsArmourName: '',
			feetArmourName: '',
			shieldName: '',
			capeArmourName: '',
			neckArmourName: '',
			ringArmourName: '',
			prayerMode: 'prayers',
			selectedPrayerNames: { accuracy: null, damage: null, armour: null },
			selectedSpellName: '',
			// hasStatiusWarhammer: false,
			// hasVulnBomb: false,
			// hasSmokeCloud: false,
			// weaponPoison: 'N/A',
			startingAdrenaline: 0,
			hasRingOfVigour: false,
			hasFuryOfTheSmall: false,
			timelinePlacements: [],
			timelineStyleFilterEnabled: true,
			timelineLength: 100
		};
	}

	let setups: Setup[] = $state([createSetup('Loadout 1')]);
	let activeSetupIndex: number = $state(0);
	const activeSetup = $derived(setups[activeSetupIndex]);

	function addSetup() {
		const copy: Setup = {
			...structuredClone($state.snapshot(activeSetup)),
			id: crypto.randomUUID(),
			label: `Loadout ${setups.length + 1}`
		};
		setups.push(copy);
		activeSetupIndex = setups.length - 1;
	}

	// --- Setup tab renaming: double-click a tab to edit its name inline ---
	let renamingSetupId: string | null = $state(null);
	let renameDraft: string = $state('');

	function startRenamingSetup(setup: Setup) {
		renamingSetupId = setup.id;
		renameDraft = setup.label;
	}

	function commitRenameSetup(setup: Setup) {
		const trimmed = renameDraft.trim();
		if (trimmed) setup.label = trimmed;
		renamingSetupId = null;
	}

	function cancelRenamingSetup() {
		renamingSetupId = null;
	}

	// Focuses (and selects) an input as soon as it's mounted -- used for the rename input, which
	// needs to grab focus immediately when it replaces the tab button, without the a11y-linted
	// `autofocus` attribute (which fires on page load too, not just element creation).
	function focusOnMount(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

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
			activeSetup.attackLevel = levels.attack;
			activeSetup.defenceLevel = levels.defence;
			activeSetup.strengthLevel = levels.strength;
			activeSetup.rangedLevel = levels.ranged;
			activeSetup.mageLevel = levels.magic;
			activeSetup.necromancyLevel = levels.necromancy;
			hiscoresStatus = 'idle';
		} catch (e) {
			hiscoresStatus = 'error';
			hiscoresError = e instanceof Error ? e.message : String(e);
		}
	}

	// Active temporary skill boosts (Overload family, Super/Extreme/Supreme potions). Multiple
	// can be toggled on at once -- boostedLevel() picks the single highest result among
	// whichever active boosts apply to each skill, matching how boosts don't stack in-game.
	const activeBoosts = $derived(
		skillBoosts.filter((b) => activeSetup.selectedBoostNames.includes(b.name))
	);

	function toggleBoost(boost: SkillBoost) {
		activeSetup.selectedBoostNames = activeSetup.selectedBoostNames.includes(boost.name)
			? activeSetup.selectedBoostNames.filter((n) => n !== boost.name)
			: [...activeSetup.selectedBoostNames, boost.name];
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
				return activeSetup.attackLevel;
			case 'strength':
				return activeSetup.strengthLevel;
			case 'defence':
				return activeSetup.defenceLevel;
			case 'ranged':
				return activeSetup.rangedLevel;
			case 'magic':
				return activeSetup.mageLevel;
			case 'necromancy':
				return activeSetup.necromancyLevel;
		}
	}

	function setBaseLevelFor(skill: BoostableSkill, value: number) {
		switch (skill) {
			case 'attack':
				activeSetup.attackLevel = value;
				break;
			case 'strength':
				activeSetup.strengthLevel = value;
				break;
			case 'defence':
				activeSetup.defenceLevel = value;
				break;
			case 'ranged':
				activeSetup.rangedLevel = value;
				break;
			case 'magic':
				activeSetup.mageLevel = value;
				break;
			case 'necromancy':
				activeSetup.necromancyLevel = value;
				break;
		}
	}

	function calculatedLevelFor(skill: BoostableSkill): number {
		return boostedLevel(baseLevelFor(skill), skill, activeBoosts);
	}

	// --- Gear tab ---
	let pendingItemPick: string = $state('');

	const mainHandWeapon = $derived(
		weapons.find((w) => w.name === activeSetup.mainHandWeaponName) ?? null
	);
	const offHandWeapon = $derived(
		weapons.find((w) => w.name === activeSetup.offHandWeaponName) ?? null
	);
	const equippedAmmo = $derived(ammo.find((a) => a.name === activeSetup.ammoName) ?? null);
	const headArmour = $derived(armour.find((a) => a.name === activeSetup.headArmourName) ?? null);
	const torsoArmour = $derived(armour.find((a) => a.name === activeSetup.torsoArmourName) ?? null);
	const legsArmour = $derived(armour.find((a) => a.name === activeSetup.legsArmourName) ?? null);
	const handsArmour = $derived(armour.find((a) => a.name === activeSetup.handsArmourName) ?? null);
	const feetArmour = $derived(armour.find((a) => a.name === activeSetup.feetArmourName) ?? null);
	const shield = $derived(armour.find((a) => a.name === activeSetup.shieldName) ?? null);
	const capeArmour = $derived(armour.find((a) => a.name === activeSetup.capeArmourName) ?? null);
	const neckArmour = $derived(armour.find((a) => a.name === activeSetup.neckArmourName) ?? null);
	const ringArmour = $derived(armour.find((a) => a.name === activeSetup.ringArmourName) ?? null);
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
			baseArmourRating(activeSetup.defenceLevel) +
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
		if (mainHandIsTwoHanded) activeSetup.offHandWeaponName = '';
	});

	// A shield and an off-hand weapon can't be worn at once -- equipping either clears the other.
	$effect(() => {
		if (activeSetup.offHandWeaponName) activeSetup.shieldName = '';
	});
	$effect(() => {
		if (activeSetup.shieldName) activeSetup.offHandWeaponName = '';
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
		// Consume the pick immediately -- otherwise this effect (which also depends on
		// `activeSetup`) re-fires on every subsequent setup-tab switch and re-applies the same
		// stale pick to whichever setup just became active.
		pendingItemPick = '';

		if (picked.kind === 'ammo') {
			activeSetup.ammoName = picked.item.name;
		} else if (picked.kind === 'armour') {
			switch (picked.item.slot) {
				case 'head':
					activeSetup.headArmourName = picked.item.name;
					break;
				case 'torso':
					activeSetup.torsoArmourName = picked.item.name;
					break;
				case 'legs':
					activeSetup.legsArmourName = picked.item.name;
					break;
				case 'hands':
					activeSetup.handsArmourName = picked.item.name;
					break;
				case 'feet':
					activeSetup.feetArmourName = picked.item.name;
					break;
				case 'offHand':
					activeSetup.shieldName = picked.item.name;
					break;
				case 'cape':
					activeSetup.capeArmourName = picked.item.name;
					break;
				case 'neck':
					activeSetup.neckArmourName = picked.item.name;
					break;
				case 'ring':
					activeSetup.ringArmourName = picked.item.name;
					break;
			}
		} else if (picked.item.slot === 'offHand') {
			activeSetup.offHandWeaponName = picked.item.name;
		} else {
			activeSetup.mainHandWeaponName = picked.item.name;
			if (picked.item.slot === 'twoHanded') activeSetup.offHandWeaponName = '';
		}
	});

	// --- Prayers tab ---
	// Players only ever have access to standard Prayers OR Ancient Curses at once, never
	// both -- switching modes clears the other mode's selections, since they can't be active
	// simultaneously in-game.
	function setPrayerMode(mode: 'prayers' | 'curses') {
		if (activeSetup.prayerMode === mode) return;
		activeSetup.prayerMode = mode;
		activeSetup.selectedPrayerNames = { accuracy: null, damage: null, armour: null };
	}

	// Selecting a prayer fills every slot it covers (e.g. Piety fills accuracy+damage+armour
	// at once, replacing whatever was in each of those slots -- matches how equipping Piety
	// in-game deactivates any single-purpose prayer that was active). Clicking an
	// already-active prayer deactivates it (clears only the slots it was occupying).
	function togglePrayer(prayer: Prayer) {
		const isActive = prayer.slots.every(
			(slot) => activeSetup.selectedPrayerNames[slot] === prayer.name
		);
		const next = { ...activeSetup.selectedPrayerNames };
		for (const slot of prayer.slots) {
			next[slot] = isActive ? null : prayer.name;
		}
		activeSetup.selectedPrayerNames = next;
	}

	const activePrayers = $derived(
		[
			activeSetup.selectedPrayerNames.accuracy,
			activeSetup.selectedPrayerNames.damage,
			activeSetup.selectedPrayerNames.armour
		]
			.filter((name, index, all) => name !== null && all.indexOf(name) === index)
			.map((name) => prayers.find((p) => p.name === name))
			.filter((p) => p !== undefined)
	);

	// --- Config tab ---
	// (all fields now live on Setup -- see activeSetup)

	// --- Monster panel: selected boss for hit chance calculation ---
	// Shared globally across all setups -- comparing setups only makes sense against one target.
	let selectedBossName: string = $state('');

	// --- Persistence: restore whatever the user manually entered on their last visit ---
	// Covers the whole `setups` array (all Stats/Gear/Prayers/Config/timeline data for every
	// setup tab, plus which one was active) and the globally-shared boss selection -- not
	// transient UI state like pendingItemPick (mid-pick combobox selection) or
	// hiscoresStatus/hiscoresError (in-flight lookup state), which don't make sense to resurrect
	// on reload.
	interface PersistedState {
		setups: Setup[];
		activeSetupIndex: number;
		hiscoresPlayerName: string;
		selectedBossName: string;
	}

	function isValidSetup(s: unknown): s is Setup {
		if (!s || typeof s !== 'object') return false;
		const setup = s as Record<string, unknown>;
		return (
			typeof setup.id === 'string' &&
			typeof setup.label === 'string' &&
			typeof setup.mageLevel === 'number' &&
			Array.isArray(setup.timelinePlacements)
		);
	}

	const PERSISTENCE_KEY = 'rs3-dps-calc:sheet';
	const SHARE_QUERY_PARAM = 'share';

	let hasRestored = $state(false);

	// --- Share loadout: encodes setups/activeSetupIndex/selectedBossName (the same shape as
	// local persistence, minus the player's hiscores name) into a gzip+base64url query param.
	// A visitor who opens the link gets an exact read-only-at-first copy of the sender's state --
	// applying it just seeds the same $state that normal editing/persistence already uses, so
	// the shared state becomes editable and locally-persisted like any other session from there.
	type ShareableState = Pick<PersistedState, 'setups' | 'activeSetupIndex' | 'selectedBossName'>;

	let shareStatus: 'idle' | 'copying' | 'copied' | 'error' = $state('idle');

	async function buildShareUrl(): Promise<string> {
		const state: ShareableState = {
			setups: $state.snapshot(setups),
			activeSetupIndex,
			selectedBossName
		};
		const payload = await encodeShareState(state);
		const response = await fetch('/api/share', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ payload })
		});
		if (!response.ok) throw new Error('Failed to create share link');
		const { code } = (await response.json()) as { code: string };

		const url = new URL(window.location.href);
		url.search = '';
		url.searchParams.set(SHARE_QUERY_PARAM, code);
		return url.toString();
	}

	function applyShareableState(state: Partial<ShareableState>) {
		if (typeof state.selectedBossName === 'string') selectedBossName = state.selectedBossName;
		if (Array.isArray(state.setups) && state.setups.length > 0 && state.setups.every(isValidSetup)) {
			setups = state.setups;
			activeSetupIndex =
				typeof state.activeSetupIndex === 'number' &&
				state.activeSetupIndex >= 0 &&
				state.activeSetupIndex < setups.length
					? state.activeSetupIndex
					: 0;
		}
	}

	async function shareLoadout() {
		shareStatus = 'copying';
		try {
			const url = await buildShareUrl();
			await navigator.clipboard.writeText(url);
			window.history.replaceState(null, '', url);
			shareStatus = 'copied';
		} catch {
			shareStatus = 'error';
		} finally {
			setTimeout(() => (shareStatus = 'idle'), 2000);
		}
	}

	let feedbackOpen = $state(false);
	let feedbackText = $state('');
	let feedbackStatus: 'idle' | 'submitting' | 'sent' | 'error' = $state('idle');
	let feedbackSnapshotUrl = $state('');
	let feedbackIncludeSnapshot = $state(true);
	// Honeypot: hidden from real users via CSS, so only a bot filling every input on the form
	// would populate it. Left non-empty on submit -> silently drop the request server-side.
	let feedbackHoneypot = $state('');

	async function openFeedback() {
		feedbackText = '';
		feedbackStatus = 'idle';
		feedbackIncludeSnapshot = true;
		feedbackSnapshotUrl = '';
		feedbackHoneypot = '';
		feedbackOpen = true;
		try {
			feedbackSnapshotUrl = await buildShareUrl();
		} catch {
			feedbackSnapshotUrl = '';
		}
	}

	function closeFeedback() {
		feedbackOpen = false;
	}

	async function submitFeedback() {
		const message = feedbackText.trim();
		if (!message) return;

		feedbackStatus = 'submitting';
		try {
			const snapshotUrl = feedbackIncludeSnapshot ? feedbackSnapshotUrl : null;
			const fullMessage = snapshotUrl ? `${message}\n\nLoadout snapshot: ${snapshotUrl}` : message;
			const response = await fetch('/api/feedback', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: fullMessage, website: feedbackHoneypot })
			});
			if (!response.ok) throw new Error('Request failed');
			feedbackStatus = 'sent';
			setTimeout(() => {
				feedbackOpen = false;
			}, 1200);
		} catch {
			feedbackStatus = 'error';
		}
	}

	onMount(() => {
		(async () => {
			const url = new URL(window.location.href);
			const shareCode = url.searchParams.get(SHARE_QUERY_PARAM);
			if (shareCode) {
				try {
					const response = await fetch(`/api/share/${encodeURIComponent(shareCode)}`);
					if (!response.ok) throw new Error('Share link not found');
					const { payload } = (await response.json()) as { payload: string };
					const state = await decodeShareState<Partial<ShareableState>>(payload);
					applyShareableState(state);
					hasRestored = true;
					return;
				} catch {
					// Missing/expired/unparseable share link -- fall through to local persistence instead.
				}
			}

			try {
				const raw = localStorage.getItem(PERSISTENCE_KEY);
				if (!raw) return;
				const saved: Partial<PersistedState> = JSON.parse(raw);

				if (typeof saved.hiscoresPlayerName === 'string') {
					hiscoresPlayerName = saved.hiscoresPlayerName;
				}
				applyShareableState(saved);
			} catch {
				// Corrupt or pre-format localStorage entry -- ignore and start fresh rather than
				// throwing on load.
			} finally {
				hasRestored = true;
			}
		})();
	});

	// Saves on every change, but only once restore has run -- otherwise the initial default
	// values would overwrite a real saved snapshot before onMount gets a chance to apply it.
	$effect(() => {
		const snapshot: PersistedState = {
			setups,
			activeSetupIndex,
			hiscoresPlayerName,
			selectedBossName
		};
		if (!hasRestored) return;
		localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(snapshot));
	});

	const spellsForLevel = $derived(
		spells
			.filter((s) => s.level <= activeSetup.mageLevel)
			.sort((a, b) => a.name.localeCompare(b.name))
	);
	const selectedSpell = $derived(
		spells.find((s) => s.name === activeSetup.selectedSpellName) ?? null
	);

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

	const adTotal = $derived(result.value?.total ?? 0);
	const timelineGearContext = $derived<GearContext>({
		isTwoHanded: mainHandIsTwoHanded,
		hasOffHandWeapon: !!offHandWeapon,
		equippedCapeName: capeArmour?.name ?? null
	});

	// How many pieces of each armour set (by Armour.setName) are currently equipped -- generalized
	// across every set-effect armour (Vestments of havoc today, ~10 more later), derived entirely
	// from what's already equipped rather than a manual toggle. Feeds Timeline's set-effect
	// Modifiers (see ModifierContext.setPieceCounts).
	const setPieceCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const piece of equippedArmourPieces) {
			counts[piece.setName] = (counts[piece.setName] ?? 0) + 1;
		}
		return counts;
	});
	const hasMeleeWeaponEquipped = $derived(mainHandWeapon?.combatStyle === 'melee');

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

	// Keyed map form of hitChanceValue for damageByTick's `hitChanceByStyle` param -- a setup only
	// ever has one combat style (from its Main Hand weapon), so this is always at most one entry,
	// but damageByTick's signature is keyed by style since a single call site (like this one) could
	// in principle be asked about any style. Empty (defaults every style to 100%, i.e. no change)
	// until both a combat style and a target are selected.
	const hitChanceByStyle = $derived<Partial<Record<CombatStyle, number>>>(
		combatStyle && hitChanceValue !== null ? { [combatStyle]: hitChanceValue } : {}
	);

	// --- Multi-setup damage overlay ---
	// Re-derives ability damage (AD total, gear context, set piece counts) for EVERY setup, not
	// just the active one -- so the overlay chart below can plot each setup's own rotation against
	// its own gear, independent of whichever tab is currently open. This mirrors the single-setup
	// "Ability damage calculation" derivation chain above (equippedArmourPieces -> totalDamageBonus
	// -> skillLevelForStyle -> weaponConfig -> calculateAbilityDamage -> AD total) but as a plain
	// function over an arbitrary Setup, since $derived can't be parameterized per array element.
	function adTotalForSetup(setup: Setup): number {
		const mhWeapon = weapons.find((w) => w.name === setup.mainHandWeaponName) ?? null;
		const ohWeapon = weapons.find((w) => w.name === setup.offHandWeaponName) ?? null;
		const style = mhWeapon?.combatStyle ?? null;
		if (!style) return 0;
		const isTwoHanded = mhWeapon?.slot === 'twoHanded';

		const pieces = [
			armour.find((a) => a.name === setup.headArmourName),
			armour.find((a) => a.name === setup.torsoArmourName),
			armour.find((a) => a.name === setup.legsArmourName),
			armour.find((a) => a.name === setup.handsArmourName),
			armour.find((a) => a.name === setup.feetArmourName),
			armour.find((a) => a.name === setup.shieldName),
			armour.find((a) => a.name === setup.capeArmourName),
			armour.find((a) => a.name === setup.neckArmourName),
			armour.find((a) => a.name === setup.ringArmourName)
		].filter((piece): piece is Armour => piece !== undefined);

		const bonusField = STYLE_BONUS_FIELD[style];
		const totalBonus = pieces.reduce((sum, piece) => sum + Math.floor(piece[bonusField]), 0);

		const setupPrayers = [
			setup.selectedPrayerNames.accuracy,
			setup.selectedPrayerNames.damage,
			setup.selectedPrayerNames.armour
		]
			.filter((name, index, all) => name !== null && all.indexOf(name) === index)
			.map((name) => prayers.find((p) => p.name === name))
			.filter((p) => p !== undefined)
			.filter((p) => p.style === style || p.style === null);
		const damagePercentBonus = setupPrayers.reduce((sum, p) => sum + p.damagePercentBonus, 0);

		const levelFor = (skill: BoostableSkill) => {
			const base =
				skill === 'attack'
					? setup.attackLevel
					: skill === 'strength'
						? setup.strengthLevel
						: skill === 'defence'
							? setup.defenceLevel
							: skill === 'ranged'
								? setup.rangedLevel
								: skill === 'magic'
									? setup.mageLevel
									: setup.necromancyLevel;
			const boosts = skillBoosts.filter((b) => setup.selectedBoostNames.includes(b.name));
			return boostedLevel(base, skill, boosts);
		};
		const skillLevel =
			style === 'magic'
				? levelFor('magic')
				: style === 'ranged'
					? levelFor('ranged')
					: style === 'melee'
						? levelFor('strength')
						: 0;

		const weaponConfigForSetup: WeaponConfig | null = mhWeapon
			? isTwoHanded
				? { kind: 'twoHanded', tier: mhWeapon.tier }
				: { kind: 'dualWield', mainHandTier: mhWeapon.tier, offHandTier: ohWeapon?.tier ?? 0 }
			: null;
		if (!weaponConfigForSetup) return 0;

		try {
			let styleTier: number | undefined;
			if (style === 'magic') {
				styleTier = spells.find((s) => s.name === setup.selectedSpellName)?.level ?? 0;
			} else if (style === 'ranged') {
				styleTier = ammo.find((a) => a.name === setup.ammoName)?.tier ?? 0;
			}
			const raw = calculateAbilityDamage({
				style,
				weapon: weaponConfigForSetup,
				level: skillLevel,
				bonus: totalBonus,
				styleTier
			});
			const multiplier = 1 + damagePercentBonus / 100;
			return multiplier === 1 ? raw.total : Math.floor(raw.total * multiplier);
		} catch {
			return 0;
		}
	}

	// Mirrors hitChanceValue above but for an arbitrary Setup (see adTotalForSetup) -- each setup's
	// own accuracy (weapon + skill bonus + hybrid nerf) against the SAME globally-shared selected
	// boss, since comparing setups only makes sense against one target.
	function hitChanceForSetup(setup: Setup): Partial<Record<CombatStyle, number>> {
		const style = combatStyleForSetup(setup);
		if (!style || !selectedBoss) return {};

		const mhWeapon = weapons.find((w) => w.name === setup.mainHandWeaponName) ?? null;
		const weaponAcc = mhWeapon?.accuracy ?? 0;

		const pieces = setPieceArmourForSetup(setup);

		const levelFor = (skill: BoostableSkill) => {
			const base =
				skill === 'attack'
					? setup.attackLevel
					: skill === 'ranged'
						? setup.rangedLevel
						: setup.mageLevel;
			const boosts = skillBoosts.filter((b) => setup.selectedBoostNames.includes(b.name));
			return boostedLevel(base, skill, boosts);
		};
		const setupPrayers = [
			setup.selectedPrayerNames.accuracy,
			setup.selectedPrayerNames.damage,
			setup.selectedPrayerNames.armour
		]
			.filter((name, index, all) => name !== null && all.indexOf(name) === index)
			.map((name) => prayers.find((p) => p.name === name))
			.filter((p) => p !== undefined)
			.filter((p) => p.style === style || p.style === null);
		const prayerAccuracyLevelBonus = setupPrayers.reduce((sum, p) => sum + p.accuracyLevelBonus, 0);

		const accuracySkillLvl =
			style === 'magic'
				? levelFor('magic') + prayerAccuracyLevelBonus
				: style === 'ranged'
					? levelFor('ranged') + prayerAccuracyLevelBonus
					: style === 'melee'
						? levelFor('attack') + prayerAccuracyLevelBonus
						: 0;

		const totalAcc =
			weaponAcc + Math.floor(accuracySkillBonus(accuracySkillLvl)) + hybridNerf(style, pieces);

		const armourRating = targetArmourRating(selectedBoss.armour, selectedBoss.defenceLevel);
		const affinity =
			style === 'necromancy'
				? NECROMANCY_AFFINITY
				: style === 'melee'
					? selectedBoss.affinityMelee
					: style === 'ranged'
						? selectedBoss.affinityRanged
						: selectedBoss.affinityMagic;

		return { [style]: hitChance(affinity, totalAcc, armourRating) };
	}

	function setPieceArmourForSetup(setup: Setup): Armour[] {
		return [
			armour.find((a) => a.name === setup.headArmourName),
			armour.find((a) => a.name === setup.torsoArmourName),
			armour.find((a) => a.name === setup.legsArmourName),
			armour.find((a) => a.name === setup.handsArmourName),
			armour.find((a) => a.name === setup.feetArmourName),
			armour.find((a) => a.name === setup.shieldName),
			armour.find((a) => a.name === setup.capeArmourName),
			armour.find((a) => a.name === setup.neckArmourName),
			armour.find((a) => a.name === setup.ringArmourName)
		].filter((piece): piece is Armour => piece !== undefined);
	}

	function gearContextForSetup(setup: Setup): GearContext {
		const mhWeapon = weapons.find((w) => w.name === setup.mainHandWeaponName) ?? null;
		return {
			isTwoHanded: mhWeapon?.slot === 'twoHanded',
			hasOffHandWeapon: !!setup.offHandWeaponName,
			equippedCapeName: setup.capeArmourName || null
		};
	}

	function combatStyleForSetup(setup: Setup): CombatStyle | null {
		return weapons.find((w) => w.name === setup.mainHandWeaponName)?.combatStyle ?? null;
	}

	function hasMeleeWeaponEquippedForSetup(setup: Setup): boolean {
		return combatStyleForSetup(setup) === 'melee';
	}

	function setPieceCountsForSetup(setup: Setup): Record<string, number> {
		const pieces = [
			armour.find((a) => a.name === setup.headArmourName),
			armour.find((a) => a.name === setup.torsoArmourName),
			armour.find((a) => a.name === setup.legsArmourName),
			armour.find((a) => a.name === setup.handsArmourName),
			armour.find((a) => a.name === setup.feetArmourName),
			armour.find((a) => a.name === setup.shieldName),
			armour.find((a) => a.name === setup.capeArmourName),
			armour.find((a) => a.name === setup.neckArmourName),
			armour.find((a) => a.name === setup.ringArmourName)
		].filter((piece): piece is Armour => piece !== undefined);
		const counts: Record<string, number> = {};
		for (const piece of pieces) counts[piece.setName] = (counts[piece.setName] ?? 0) + 1;
		return counts;
	}

	const SETUP_LINE_COLORS = [
		'#f4d78c',
		'#7fb3d5',
		'#d97757',
		'#8fc98f',
		'#c98fc9',
		'#e0e07a',
		'#7ad4c9',
		'#e08fa0'
	];

	function colorForSetupIndex(index: number): string {
		return SETUP_LINE_COLORS[index % SETUP_LINE_COLORS.length];
	}

	// One damage + adrenaline series per setup, using each setup's OWN gear/AD/timeline -- not the
	// active one's -- so the overlay charts plot every setup's actual rotation simultaneously.
	const setupSeries = $derived(
		setups.map((setup, index) => {
			const gear = gearContextForSetup(setup);
			const setPieceCounts = setPieceCountsForSetup(setup);
			const series = computeDamageSeries(
				setup.timelinePlacements,
				abilities,
				adTotalForSetup(setup),
				gear,
				setup.timelineLength,
				setPieceCounts,
				hitChanceForSetup(setup)
			);
			const adrenalineStates = resolveAdrenaline(
				setup.timelinePlacements,
				abilities,
				combatStyleForSetup(setup),
				setup.startingAdrenaline,
				setup.timelineLength,
				setup.hasRingOfVigour,
				setup.hasFuryOfTheSmall,
				setPieceCounts,
				hasMeleeWeaponEquippedForSetup(setup),
				gear
			);
			return {
				id: setup.id,
				label: setup.label,
				color: colorForSetupIndex(index),
				...series,
				adrenaline: adrenalineStates.map((s) => s.value)
			};
		})
	);
</script>

<header class="hud-title">
	<div class="hud-title-text">
		<h1>RS3 Ability Damage Calculator</h1>
		<p>
			Formulas from
			<a href="https://runescape.wiki/w/Ability_damage" target="_blank" rel="noreferrer"
				>runescape.wiki</a
			>.
		</p>
	</div>
	<div class="hud-title-actions">
		<button type="button" class="share-button" onclick={openFeedback}>Submit feedback</button>
		<button
			type="button"
			class="share-button"
			onclick={shareLoadout}
			disabled={shareStatus === 'copying'}
		>
			{#if shareStatus === 'copied'}
				Link copied!
			{:else if shareStatus === 'error'}
				Copy failed
			{:else}
				Share loadout
			{/if}
		</button>
	</div>
</header>

{#if feedbackOpen}
	<div
		class="feedback-overlay"
		role="button"
		tabindex="0"
		onclick={closeFeedback}
		onkeydown={(e) => e.key === 'Escape' && closeFeedback()}
	>
		<div
			class="feedback-modal"
			role="dialog"
			aria-modal="true"
			aria-label="Submit feedback"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<h2>Submit feedback</h2>
			<div class="feedback-honeypot" aria-hidden="true">
				<label for="feedback-website">Website</label>
				<input
					id="feedback-website"
					name="website"
					type="text"
					tabindex="-1"
					autocomplete="off"
					bind:value={feedbackHoneypot}
				/>
			</div>
			<textarea
				bind:value={feedbackText}
				placeholder="Found a bug or have a suggestion? Let me know."
				maxlength="2000"
				rows="6"
			></textarea>
			<label class="feedback-snapshot-toggle">
				<input type="checkbox" bind:checked={feedbackIncludeSnapshot} />
				Include a link to my current loadout so it can be recreated
			</label>
			{#if feedbackIncludeSnapshot}
				<p class="feedback-snapshot-url">
					{feedbackSnapshotUrl || 'Generating snapshot link...'}
				</p>
			{/if}
			<div class="feedback-modal-actions">
				<span class="feedback-status">
					{#if feedbackStatus === 'sent'}
						Thanks!
					{:else if feedbackStatus === 'error'}
						Something went wrong -- try again.
					{/if}
				</span>
				<button type="button" class="feedback-cancel" onclick={closeFeedback}>Cancel</button>
				<button
					type="button"
					class="share-button"
					onclick={submitFeedback}
					disabled={feedbackStatus === 'submitting' ||
						feedbackText.trim().length === 0 ||
						(feedbackIncludeSnapshot && !feedbackSnapshotUrl)}
				>
					{feedbackStatus === 'submitting' ? 'Sending...' : 'Send'}
				</button>
			</div>
		</div>
	</div>
{/if}

<div class="hud-columns">
	<div class="hud-column">
		<div class="setup-panel-group">
			<nav class="setup-tabs">
				{#each setups as setup, index (setup.id)}
					<button
						type="button"
						class="setup-tab"
						class:active={index === activeSetupIndex}
						onclick={() => (activeSetupIndex = index)}
					>
						{setup.label}
					</button>
				{/each}
				<button type="button" class="setup-tab-add" title="Add setup" onclick={addSetup}>
					+
				</button>
			</nav>

			<div class="hud-window">
			<div class="setup-header">
				{#if renamingSetupId === activeSetup.id}
					<input
						type="text"
						class="setup-header-rename"
						bind:value={renameDraft}
						use:focusOnMount
						onblur={() => commitRenameSetup(activeSetup)}
						onkeydown={(e) => {
							if (e.key === 'Enter') commitRenameSetup(activeSetup);
							else if (e.key === 'Escape') cancelRenamingSetup();
						}}
					/>
				{:else}
					<button
						type="button"
						class="setup-header-name"
						ondblclick={() => startRenamingSetup(activeSetup)}
						title="Double-click to rename"
					>
						{activeSetup.label}
					</button>
					<button
						type="button"
						class="setup-header-icon-btn"
						title="Rename loadout"
						onclick={() => startRenamingSetup(activeSetup)}
					>
						<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
							<path
								fill="currentColor"
								d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
							/>
						</svg>
					</button>
				{/if}
				{#if setups.length > 1}
					<button
						type="button"
						class="setup-header-icon-btn setup-header-delete"
						title="Delete loadout {activeSetup.label}"
						onclick={() => {
							const index = activeSetupIndex;
							setups.splice(index, 1);
							if (activeSetupIndex >= setups.length) activeSetupIndex = setups.length - 1;
						}}
					>
						<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
							<path
								fill="currentColor"
								d="M9 3a1 1 0 0 0-1 1v1H4v2h1.1l.9 12.1A2 2 0 0 0 8 21h8a2 2 0 0 0 2-1.9L18.9 7H20V5h-4V4a1 1 0 0 0-1-1H9zm1 2h4v1h-4V5zM8.1 7h7.8l-.86 11.6a.5.5 0 0 1-.5.4H9.46a.5.5 0 0 1-.5-.4L8.1 7zM10 9v9h1.5V9H10zm3.5 0v9H15V9h-1.5z"
							/>
						</svg>
					</button>
				{/if}
			</div>

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
							{@const active = activeSetup.selectedBoostNames.includes(boost.name)}
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
											activeSetup.mainHandWeaponName = '';
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
											activeSetup.offHandWeaponName = '';
											activeSetup.shieldName = '';
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
											activeSetup.ammoName = '';
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
											activeSetup.headArmourName = '';
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
											activeSetup.torsoArmourName = '';
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
											activeSetup.legsArmourName = '';
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
											activeSetup.handsArmourName = '';
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
											activeSetup.feetArmourName = '';
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
											activeSetup.capeArmourName = '';
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
											activeSetup.neckArmourName = '';
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
											activeSetup.ringArmourName = '';
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
							class:active={activeSetup.prayerMode === 'prayers'}
							onclick={() => setPrayerMode('prayers')}
						>
							Prayers
						</button>
						<button
							type="button"
							class="prayer-mode-button"
							class:active={activeSetup.prayerMode === 'curses'}
							onclick={() => setPrayerMode('curses')}
						>
							Ancient Curses
						</button>
					</div>
					<div class="prayer-grid">
						{#each prayers.filter((p) => p.isCurse === (activeSetup.prayerMode === 'curses')) as prayer (prayer.name)}
							{@const isActive = prayer.slots.every(
								(slot) => activeSetup.selectedPrayerNames[slot] === prayer.name
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
								Pick a spell (level ≤ {activeSetup.mageLevel})
								<Combobox
									id="spell-combobox"
									options={spellsForLevel}
									bind:value={activeSetup.selectedSpellName}
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

						<!-- Effects and Weapon Poison sections removed until wired into the damage engine:
						<section class="config-section">
							<h3>Effects</h3>
							<label class="config-checkbox">
								<input type="checkbox" bind:checked={activeSetup.hasStatiusWarhammer} />
								Statius Warhammer
							</label>
							<label class="config-checkbox">
								<input type="checkbox" bind:checked={activeSetup.hasVulnBomb} />
								Vuln Bomb
							</label>
							<label class="config-checkbox">
								<input type="checkbox" bind:checked={activeSetup.hasSmokeCloud} />
								Smoke Cloud
							</label>
						</section>

						<section class="config-section">
							<h3>Weapon Poison</h3>
							<label class="config-field">
								Potency
								<select bind:value={activeSetup.weaponPoison}>
									{#each WEAPON_POISON_OPTIONS as option (option)}
										<option value={option}>{option}</option>
									{/each}
								</select>
							</label>
						</section>
						-->

						<section class="config-section">
							<h3>Global Unlocks</h3>
							<label class="config-checkbox">
								<input type="checkbox" bind:checked={activeSetup.hasRingOfVigour} />
								Ring of Vigour
							</label>
							<label class="config-checkbox">
								<input type="checkbox" bind:checked={activeSetup.hasFuryOfTheSmall} />
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
									value={activeSetup.startingAdrenaline}
									oninput={(e) =>
										(activeSetup.startingAdrenaline = Number(
											(e.target as HTMLInputElement).value
										))}
								/>
							</label>
						</section>
					</div>
				{/if}
			</div>
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

		<div class="hud-window scroll-hint">
			<p>
				<span aria-hidden="true">&darr;</span> Scroll down to build out your rotation on the timeline.
			</p>
		</div>
	</div>
</div>

<div class="timeline-section">
	{#key activeSetup.id}
		<Timeline
			{abilities}
			{combatStyle}
			{adTotal}
			startingAdrenaline={activeSetup.startingAdrenaline}
			hasRingOfVigour={activeSetup.hasRingOfVigour}
			hasFuryOfTheSmall={activeSetup.hasFuryOfTheSmall}
			gearContext={timelineGearContext}
			{setPieceCounts}
			{hasMeleeWeaponEquipped}
			bind:placements={activeSetup.timelinePlacements}
			bind:styleFilterEnabled={activeSetup.timelineStyleFilterEnabled}
			bind:timelineLength={activeSetup.timelineLength}
			overlaySeries={setupSeries}
			{hitChanceByStyle}
		/>
	{/key}
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
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.hud-title-actions {
		flex-shrink: 0;
		display: flex;
		gap: 0.75rem;
	}

	.share-button {
		flex-shrink: 0;
		padding: 0.5rem 1rem;
		background: #2e2517;
		border: 2px solid #5a4a2c;
		border-radius: 6px;
		color: #f4d78c;
		font: inherit;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.share-button:hover:not(:disabled) {
		background: #3a2e1c;
		border-color: #f4d78c;
	}

	.share-button:disabled {
		cursor: default;
		opacity: 0.7;
	}

	.feedback-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.feedback-modal {
		position: relative;
		background: #1c160c;
		border: 2px solid #5a4a2c;
		border-radius: 8px;
		padding: 1.5rem;
		width: 100%;
		max-width: 28rem;
		color: #e8dcc0;
	}

	.feedback-modal h2 {
		margin: 0 0 1rem;
		font-size: 1.1rem;
	}

	.feedback-honeypot {
		position: absolute;
		left: -9999px;
		top: -9999px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}

	.feedback-modal textarea {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		background: #241d12;
		border: 1px solid #5a4a2c;
		border-radius: 6px;
		color: #e8dcc0;
		font: inherit;
		padding: 0.6rem;
	}

	.feedback-snapshot-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.75rem;
		font-size: 0.85rem;
		color: #cbb98e;
	}

	.feedback-snapshot-url {
		margin: 0.35rem 0 0;
		padding: 0.4rem 0.6rem;
		background: #100c08;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		font-size: 0.75rem;
		color: #8a7c5a;
		overflow-wrap: anywhere;
	}

	.feedback-modal-actions {
		margin-top: 1rem;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.75rem;
	}

	.feedback-status {
		margin-right: auto;
		font-size: 0.8rem;
		opacity: 0.8;
	}

	.feedback-cancel {
		background: none;
		border: none;
		color: #e8dcc0;
		opacity: 0.7;
		cursor: pointer;
		font: inherit;
	}

	.feedback-cancel:hover {
		opacity: 1;
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

	.scroll-hint {
		padding: 0.9rem 1rem;
		text-align: center;
	}

	.scroll-hint p {
		margin: 0;
		color: #cbb98e;
		font-size: 0.9rem;
	}

	/* .hud-column's own `gap` (meant for spacing between unrelated panels) would otherwise shove
	   the tabs away from the container they belong to -- this group opts out of that gap so the
	   tabs sit flush against the panel's top edge, reading as extra material growing directly out
	   of it rather than a separate floating row above it. */
	.setup-panel-group {
		display: flex;
		flex-direction: column;
	}

	/* No background of its own -- tabs sit directly on the page background, immediately above
	   the panel. */
	.setup-tabs {
		display: flex;
		align-items: flex-end;
		gap: 0.4rem;
		flex-wrap: wrap;
		padding: 0 0.6rem;
	}

	.setup-tab {
		position: relative;
		padding: 0.4rem 0.9rem;
		background: #1a140d;
		border: 2px solid #5a4a2c;
		border-bottom: none;
		border-radius: 6px 6px 0 0;
		color: #a89468;
		font: inherit;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.setup-tab:hover {
		background: #241d14;
		color: #e8dcc4;
	}

	.setup-tab.active {
		background: #2e2517;
		border-color: #5a4a2c;
		color: #f4d78c;
	}

	.setup-tab-add {
		padding: 0.3rem 0.6rem;
		background: transparent;
		border: 2px dashed #5a4a2c;
		border-bottom: none;
		border-radius: 6px 6px 0 0;
		color: #d8b566;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
		align-self: flex-end;
	}

	.setup-tab-add:hover {
		background: #241d14;
		border-color: #f4d78c;
		color: #f4d78c;
	}

	.setup-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		background: #2e2517;
		border-bottom: 2px solid #5a4a2c;
	}

	.setup-header-name {
		font: inherit;
		font-size: 1rem;
		font-weight: 700;
		color: #f4d78c;
		background: transparent;
		border: none;
		padding: 0;
		cursor: text;
	}

	.setup-header-rename {
		font: inherit;
		font-size: 1rem;
		font-weight: 700;
		color: #f4d78c;
		background: #1a140d;
		border: 1px solid #f4d78c;
		border-radius: 4px;
		padding: 0.15rem 0.4rem;
		width: 12rem;
	}

	.setup-header-icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.3rem;
		background: transparent;
		border: none;
		border-radius: 4px;
		color: #a89468;
		cursor: pointer;
	}

	.setup-header-icon-btn:hover {
		background: #1a140d;
		color: #f4d78c;
	}

	.setup-header-delete {
		margin-left: auto;
	}

	.setup-header-delete:hover {
		color: #f4a89a;
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

	/* .config-field select rules unused while the Weapon Poison config section is disabled:
	.config-field select {
		font-size: 1rem;
		padding: 0.4rem 0.5rem;
		background: #100c08;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		color: #e8dcc4;
	}

	.config-field select option {
		background-color: #100c08;
		color: #e8dcc4;
	}

	.config-field select:focus {
		outline: 2px solid #f4d78c;
		outline-offset: 1px;
	}
	*/

	.stat-row-input:focus {
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
