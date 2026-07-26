export interface Spell {
	name: string;
	level: number;
	/** Base maximum hit at the spell's minimum level, per runescape.wiki/w/List_of_spells. */
	baseMaxHit: number;
	spellbook: 'Standard' | 'Ancient' | 'Lunar' | 'Daemonheim' | 'All';
	membersOnly: boolean;
	description: string;
	/** Path under /spell-icons relative to the static root. */
	iconPath: string;
}

/**
 * Combat spells with a known damage value, scraped from runescape.wiki/w/List_of_spells.
 * Spells whose Damage column was "N/A" (teleports, most skilling spells) are excluded.
 */
export const spells: Spell[] = [
	{
		name: 'Air Strike',
		level: 1,
		baseMaxHit: 9.6,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A simple air spell.Damage scales up to level 16.',
		iconPath: '/spell-icons/air-strike.png'
	},
	{
		name: 'Confuse',
		level: 1,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: false,
		description: "Reduces the target's chance to hit by 5% for 1 minute.",
		iconPath: '/spell-icons/confuse.png'
	},
	{
		name: 'Water Strike',
		level: 5,
		baseMaxHit: 48.0,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A simple water spell.Damage scales up to level 22.',
		iconPath: '/spell-icons/water-strike.png'
	},
	{
		name: 'Earth Strike',
		level: 9,
		baseMaxHit: 86.4,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A simple earth spell.Damage scales up to level 28.',
		iconPath: '/spell-icons/earth-strike.png'
	},
	{
		name: 'Weaken',
		level: 11,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: false,
		description: "Reduces the target's damage dealt by 5% for 1 minute.",
		iconPath: '/spell-icons/weaken.png'
	},
	{
		name: 'Fire Strike',
		level: 13,
		baseMaxHit: 124.8,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A simple fire spell.Damage scales up to level 34.',
		iconPath: '/spell-icons/fire-strike.png'
	},
	{
		name: 'Air Bolt',
		level: 17,
		baseMaxHit: 163.2,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A basic air spell.Damage scales up to level 40.',
		iconPath: '/spell-icons/air-bolt.png'
	},
	{
		name: 'Curse',
		level: 19,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: false,
		description: "Increases the target's damage received by 5% for 1 minute.",
		iconPath: '/spell-icons/curse.png'
	},
	{
		name: 'Bind',
		level: 20,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'Prevents creatures from moving for 12 seconds, or players for 6 seconds.',
		iconPath: '/spell-icons/bind.png'
	},
	{
		name: 'Water Bolt',
		level: 23,
		baseMaxHit: 220.8,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A basic water spell.Damage scales up to level 45.',
		iconPath: '/spell-icons/water-bolt.png'
	},
	{
		name: 'Earth Bolt',
		level: 29,
		baseMaxHit: 278.4,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A basic earth spell.Damage scales up to level 52.',
		iconPath: '/spell-icons/earth-bolt.png'
	},
	{
		name: 'Fire Bolt',
		level: 35,
		baseMaxHit: 336.0,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A basic fire spell.Damage scales up to level 58.',
		iconPath: '/spell-icons/fire-bolt.png'
	},
	{
		name: 'Air Blast',
		level: 41,
		baseMaxHit: 393.6,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A standard air spell.Damage scales up to level 61.',
		iconPath: '/spell-icons/air-blast.png'
	},
	{
		name: 'Water Blast',
		level: 47,
		baseMaxHit: 451.2,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A standard water spell.Damage scales up to level 64.',
		iconPath: '/spell-icons/water-blast.png'
	},
	{
		name: 'Snare',
		level: 50,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'Prevents creatures from moving for 18 seconds, or players for 9 seconds.',
		iconPath: '/spell-icons/snare.png'
	},
	{
		name: 'Slayer Dart',
		level: 50,
		baseMaxHit: 480.0,
		spellbook: 'Standard',
		membersOnly: true,
		description:
			'A powerful air spell, which is particularly effective against certain Slayer creatures.Damage scales up to level 65.',
		iconPath: '/spell-icons/slayer-dart.png'
	},
	{
		name: 'Smoke Rush',
		level: 50,
		baseMaxHit: 480.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A powerful air spell, which also reduces the targets chance to hit by 5% for 10 seconds.Damage scales up to level 60.',
		iconPath: '/spell-icons/smoke-rush.png'
	},
	{
		name: 'Shadow Rush',
		level: 52,
		baseMaxHit: 499.2,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			"A powerful earth spell, which also reduces the target's damage dealt by 5% for 10 seconds.Damage scales up to level 63.",
		iconPath: '/spell-icons/shadow-rush.png'
	},
	{
		name: 'Earth Blast',
		level: 53,
		baseMaxHit: 508.8,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A standard earth spell.Damage scales up to level 69.',
		iconPath: '/spell-icons/earth-blast.png'
	},
	{
		name: 'Blood Rush',
		level: 56,
		baseMaxHit: 537.6,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A powerful fire spell, which also heals you for 5% of the damage dealt.Damage scales up to level 67.',
		iconPath: '/spell-icons/blood-rush.png'
	},
	{
		name: 'Ice Rush',
		level: 58,
		baseMaxHit: 556.8,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A powerful water spell, which also prevents creatures and players from moving for 2.4 seconds.Damage scales up to level 69.',
		iconPath: '/spell-icons/ice-rush.png'
	},
	{
		name: 'Fire Blast',
		level: 59,
		baseMaxHit: 566.4,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'A standard fire spell.Damage scales up to level 74.',
		iconPath: '/spell-icons/fire-blast.png'
	},
	{
		name: 'Divine Storm',
		level: 60,
		baseMaxHit: 576.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'A powerful air spell.Damage scales up to level 78.',
		iconPath: '/spell-icons/divine-storm.png'
	},
	{
		name: 'Air Wave',
		level: 62,
		baseMaxHit: 595.2,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'A powerful air spell.Damage scales up to level 80.',
		iconPath: '/spell-icons/air-wave.png'
	},
	{
		name: 'Smoke Burst',
		level: 62,
		baseMaxHit: 595.2,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A powerful area air spell, which also reduces the targets chance to hit by 5% for 10 seconds.Damage scales up to level 73.',
		iconPath: '/spell-icons/smoke-burst.png'
	},
	{
		name: 'Shadow Burst',
		level: 64,
		baseMaxHit: 614.4,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A powerful area earth spell, which also reduces the targets damage dealt by 5% for 10 seconds.Damage scales up to level 75.',
		iconPath: '/spell-icons/shadow-burst.png'
	},
	{
		name: 'Water Wave',
		level: 65,
		baseMaxHit: 624.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'A powerful water spell.Damage scales up to level 80.',
		iconPath: '/spell-icons/water-wave.png'
	},
	{
		name: 'Vulnerability',
		level: 66,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: "Increases the target's damage received by 10% for 1 minute.",
		iconPath: '/spell-icons/vulnerability.png'
	},
	{
		name: 'Penance',
		level: 67,
		baseMaxHit: 0.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'Restore prayer points from damage taken.- Applies Penance to self.- 12m duration.Can be cast during the global cooldown.Aspect of sustain: You may only have one aspect active at once.Penance- 5% of damage taken is restored as Prayer Points, up to 100 per hit.',
		iconPath: '/spell-icons/penance.png'
	},
	{
		name: 'Blood Burst',
		level: 68,
		baseMaxHit: 652.8,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A powerful area fire spell, which also heals you for 5% of the damage dealt.Damage scales up to level 79.',
		iconPath: '/spell-icons/blood-burst.png'
	},
	{
		name: 'Vampyrism',
		level: 69,
		baseMaxHit: 0.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'Drain life from your foes to heal yourself.- Applies Vampyrism to self - 12m duration. Can be cast during the global cooldown.Aspect of Sustain: You may only have one aspect active at once.Vampyrism- Heals you for 5% of damage dealt, up to 50 Life Points per hit.',
		iconPath: '/spell-icons/vampyrism.png'
	},
	{
		name: 'Ice Burst',
		level: 70,
		baseMaxHit: 672.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A powerful area water spell, which also prevents creatures and players from moving for 4.8 seconds.Damage scales up to level 80.',
		iconPath: '/spell-icons/ice-burst.png'
	},
	{
		name: 'Earth Wave',
		level: 70,
		baseMaxHit: 672.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'A powerful earth spell.Damage scales up to level 80.',
		iconPath: '/spell-icons/earth-wave.png'
	},
	{
		name: 'Enfeeble',
		level: 73,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: "Reduces the target's damage dealt by 10% for 1 minute.",
		iconPath: '/spell-icons/enfeeble.png'
	},
	{
		name: 'Smoke Blitz',
		level: 74,
		baseMaxHit: 710.4,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			"A very powerful air spell, which also reduces the target's chance to hit by 5% for 10 seconds.Damage scales up to level 92.",
		iconPath: '/spell-icons/smoke-blitz.png'
	},
	{
		name: 'Smoke Cloud',
		level: 74,
		baseMaxHit: 0.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'Disorient the target with a veil of smoke, leaving them vulnerable.- Increases the critical strike damage by 15%.- 2m duration.- 40% effective for non-magic attacks.',
		iconPath: '/spell-icons/smoke-cloud.png'
	},
	{
		name: 'Fire Wave',
		level: 75,
		baseMaxHit: 720.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'A powerful fire spell.Damage scales up to level 80.',
		iconPath: '/spell-icons/fire-wave.png'
	},
	{
		name: 'Opal Aurora',
		level: 75,
		baseMaxHit: 720.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A simple air spell. On hit will find all prisms within a 3 square radius of the player and increase their duration by a small amount.Damage scales up to level 100.',
		iconPath: '/spell-icons/opal-aurora.png'
	},
	{
		name: 'Shadow Blitz',
		level: 76,
		baseMaxHit: 729.6,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			"A very powerful earth spell, which also reduces the target's damage dealt by 5% for 10 seconds.Damage scales up to level 92.",
		iconPath: '/spell-icons/shadow-blitz.png'
	},
	{
		name: 'Prism of Restoration',
		level: 76,
		baseMaxHit: 0.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			"A prism which will periodically heal your familiar, recharge your familiars' special attack by 1 per cycle and restore summoning points by up to 10 per cycle, based on the distance from the prism. While within range you will also have a chance at saving a scroll when used. Players must be within 7 tiles to gain the effect.",
		iconPath: '/spell-icons/prism-of-restoration.png'
	},
	{
		name: 'Storm of Armadyl',
		level: 77,
		baseMaxHit: 739.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'A very powerful air spell.Damage scales up to level 85.',
		iconPath: '/spell-icons/storm-of-armadyl.png'
	},
	{
		name: 'Sapphire Aurora',
		level: 77,
		baseMaxHit: 739.2,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A simple water spell. On hit has a chance to find all prisms within a 3 square radius of the player and give a small buff to their ability when they next activate.Damage scales up to level 100.',
		iconPath: '/spell-icons/sapphire-aurora.png'
	},
	{
		name: 'Intercept',
		level: 77,
		baseMaxHit: 0.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'Place a ward on an ally for 10 seconds, you will take all damage they would receive with a 5% reduction in damage.',
		iconPath: '/spell-icons/intercept.png'
	},
	{
		name: 'Crumble Undead',
		level: 78,
		baseMaxHit: 748.8,
		spellbook: 'Standard',
		membersOnly: true,
		description:
			'A very powerful spell against undead enemies.-Base damage is increased by 30% against undead.Damage scales up to level 100.',
		iconPath: '/spell-icons/crumble-undead.png'
	},
	{
		name: 'Entangle',
		level: 79,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'Prevents creatures from moving for 24 seconds, or players for 12 seconds.',
		iconPath: '/spell-icons/entangle.png'
	},
	{
		name: 'Emerald Aurora',
		level: 79,
		baseMaxHit: 758.4,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A simple earth spell. On hit will give the caster a small Damage Reduction buff. By 1% per stack, up to 5 stacks.Damage scales up to level 100.',
		iconPath: '/spell-icons/emerald-aurora.png'
	},
	{
		name: 'Prism of Salvation',
		level: 80,
		baseMaxHit: 0.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A prism which when clicked will allow any player to teleport to it. Must be within 8 tiles to use.',
		iconPath: '/spell-icons/prism-of-salvation.png'
	},
	{
		name: 'Stagger',
		level: 80,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: "Reduces the target's chance to hit by 10% for 1 minute.",
		iconPath: '/spell-icons/stagger.png'
	},
	{
		name: 'Blood Blitz',
		level: 80,
		baseMaxHit: 768.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A very powerful fire spell, which also heals you for 5% of the damage dealt.Damage scales up to level 92.',
		iconPath: '/spell-icons/blood-blitz.png'
	},
	{
		name: 'Ruby Aurora',
		level: 81,
		baseMaxHit: 777.6,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A simple fire spell. On hit has a chance to increase damage output, by 1% per stack up to 3 stacks, to all other players within a 5 tile radius from the caster.Damage scales up to level 100.',
		iconPath: '/spell-icons/ruby-aurora.png'
	},
	{
		name: 'Air Surge',
		level: 81,
		baseMaxHit: 777.6,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'A very powerful air spell.Damage scales up to level 100.',
		iconPath: '/spell-icons/air-surge.png'
	},
	{
		name: 'Ice Blitz',
		level: 82,
		baseMaxHit: 787.2,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A very powerful water spell, which also prevents creatures and players from moving for 7.2 seconds.Damage scales up to level 92.',
		iconPath: '/spell-icons/ice-blitz.png'
	},
	{
		name: 'Prism of Loyalty',
		level: 82,
		baseMaxHit: 0.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			"A prism which allows players to store their lifepoints in. Any player that comes within 5 tiles of the prism, with less than 25% health will transfer the prism's health to the player, healing them up to the maximum lifepoints this prism is holding.",
		iconPath: '/spell-icons/prism-of-loyalty.png'
	},
	{
		name: 'Shield Dome',
		level: 84,
		baseMaxHit: 0.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'Create an energy shield for 15 seconds that will protect all players within it, reducing damage by up to 50%. Each different shield following this will have diminishing returns that reset after 2 minutes.',
		iconPath: '/spell-icons/shield-dome.png'
	},
	{
		name: 'Animate Dead',
		level: 84,
		baseMaxHit: 0.0,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'Replace life with shadows to create a shield from the fallen.For each piece of magic tank equipment worn:- Gain 10% of its armour value as flat damage reduction. - Gain 25% of your defence level as flat damage reduction.- 12m duration. - Only core damage types can be reduced by this effect. - Damage cannot be reduced by more than 60% due to this effect.- Reduced effectiveness in PvP.Aspect of Evasion: You may only have one aspect active at once.',
		iconPath: '/spell-icons/animate-dead.png'
	},
	{
		name: 'Water Surge',
		level: 85,
		baseMaxHit: 816.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'A very powerful water spell.Damage scales up to level 100.',
		iconPath: '/spell-icons/water-surge.png'
	},
	{
		name: 'Teleport Block',
		level: 85,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: false,
		description: 'Prevent the targeted player from using teleport spells and items for 5 minutes.',
		iconPath: '/spell-icons/teleport-block.png'
	},
	{
		name: 'Smoke Barrage',
		level: 86,
		baseMaxHit: 825.6,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			"A very powerful area air spell, which also reduces the target's chance to hit by 5% for 10 seconds.Damage scales up to level 100.",
		iconPath: '/spell-icons/smoke-barrage.png'
	},
	{
		name: 'Shadow Barrage',
		level: 88,
		baseMaxHit: 844.8,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			"A very powerful area earth spell, which also reduces the target's damage dealt by 5% for 10 seconds.Damage scales up to level 100.",
		iconPath: '/spell-icons/shadow-barrage.png'
	},
	{
		name: 'Earth Surge',
		level: 90,
		baseMaxHit: 864.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'A very powerful earth spell.Damage scales up to level 100.',
		iconPath: '/spell-icons/earth-surge.png'
	},
	{
		name: 'Blood Barrage',
		level: 92,
		baseMaxHit: 883.2,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A very powerful area fire spell, which also heals you for 5% of the damage dealt.Damage scales up to level 100.',
		iconPath: '/spell-icons/blood-barrage.png'
	},
	{
		name: 'Ice Barrage',
		level: 94,
		baseMaxHit: 902.4,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'A very powerful area water spell, which also prevents creatures and players from moving for 9.6 seconds.Damage scales up to level 100.',
		iconPath: '/spell-icons/ice-barrage.png'
	},
	{
		name: 'Fire Surge',
		level: 95,
		baseMaxHit: 912.0,
		spellbook: 'Standard',
		membersOnly: true,
		description: 'A very powerful fire spell.Damage scales up to level 99.',
		iconPath: '/spell-icons/fire-surge.png'
	},
	{
		name: 'Exsanguinate',
		level: 96,
		baseMaxHit: 921.6,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'An extremely powerful fire spell. On ability cast, gain a stack of Blood Tithe (max 12) for 20s. - Each stack of Blood Tithe increases basic ability base damage by 1%Damage scales up to level 100.',
		iconPath: '/spell-icons/exsanguinate.png'
	},
	{
		name: 'Temporal Anomaly',
		level: 97,
		baseMaxHit: 0.0,
		spellbook: 'Standard',
		membersOnly: true,
		description:
			'Create a temporal anomaly.- Applies Temporal Anomaly to self.- 12m duration.Can be cast during the global cooldown.Aspect of Power: You may only have one aspect active at once.Temporal Anomaly- 12.5% of magic power armour damage bonus as chance to reset the cooldown of a magic ability when cast against a target.Maximum chance: 20%.',
		iconPath: '/spell-icons/temporal-anomaly.png'
	},
	{
		name: 'Incite Fear',
		level: 98,
		baseMaxHit: 940.8,
		spellbook: 'Ancient',
		membersOnly: true,
		description:
			'An extremely powerful water spell. On ability cast, gain a stack of Glacial Embrace (max 5) for 20s. - Each stack of Glacial Embrace reduces the adrenaline cost of Tsunami by 12% - At 5 stacks, your ability casts trigger Frost Surge (12s cooldown). - Frost Surge deals (10-50%) ability damage to the primary target and up to 8 adjacent enemies in a 5x5 area around your target. Damage scales up to level 100.',
		iconPath: '/spell-icons/incite-fear.png'
	}
];
