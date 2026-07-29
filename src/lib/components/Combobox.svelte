<script lang="ts" generics="T">
	import { onMount } from 'svelte';

	interface Props {
		options: T[];
		value: string;
		getValue: (option: T) => string;
		getLabel: (option: T) => string;
		/** Text to substring-match against while typing. Defaults to getLabel(option). */
		getSearchText?: (option: T) => string;
		placeholder?: string;
		emptyOptionLabel?: string;
		disabled?: boolean;
		id?: string;
		option?: import('svelte').Snippet<[T]>;
	}

	let {
		options,
		value = $bindable(),
		getValue,
		getLabel,
		getSearchText,
		placeholder = '-- select --',
		emptyOptionLabel = '-- empty --',
		disabled = false,
		id,
		option
	}: Props = $props();

	// Progressive enhancement: the native <select> below always works with zero JS.
	// Once mounted (JS ran), we swap in a text-input + filtered-listbox combobox.
	let jsEnabled = $state(false);
	onMount(() => {
		jsEnabled = true;
	});

	const searchTextFor = (opt: T) => (getSearchText ?? getLabel)(opt).toLowerCase();

	let query: string = $state('');
	let listboxOpen: boolean = $state(false);
	let activeIndex: number = $state(-1);
	let inputEl: HTMLInputElement | undefined = $state();
	let rootEl: HTMLDivElement | undefined = $state();
	// See onInputInput: true right after the option list re-renders from typing, until a
	// real mousemove is observed over the list. Blocks stray mouseenter/click from a
	// stationary cursor that ends up over a newly laid-out <li>.
	let suppressHoverUntilMove = false;

	// Infinite scroll over the matched options: only `renderLimit` <li>s exist in the DOM at
	// once (rather than every match), growing by RENDER_PAGE_SIZE as the user scrolls near the
	// bottom of the listbox (see onListboxScroll). Without a cap, a several-thousand-item
	// options list (e.g. the full weapon/armour/ammo roster) would render every match into the
	// DOM on every keystroke -- each row has an <img> plus nested spans, so a few thousand of
	// them makes typing visibly stutter/freeze.
	const RENDER_PAGE_SIZE = 50;
	let renderLimit = $state(RENDER_PAGE_SIZE);

	const matchingOptions = $derived.by(() => {
		if (!listboxOpen) return options;
		const needle = query.trim().toLowerCase();
		if (!needle) return options;
		return options.filter((o) => searchTextFor(o).includes(needle));
	});

	// Reset the render window back to one page whenever the match set itself changes (new
	// search narrows/widens the results) -- otherwise a previously-scrolled-open limit from a
	// broader search would carry over and immediately render hundreds of rows for a new query.
	$effect(() => {
		matchingOptions;
		renderLimit = RENDER_PAGE_SIZE;
	});

	const filteredOptions = $derived(matchingOptions.slice(0, renderLimit));
	const truncatedCount = $derived(matchingOptions.length - filteredOptions.length);

	function onListboxScroll(e: Event) {
		if (truncatedCount <= 0) return;
		const el = e.currentTarget as HTMLUListElement;
		// Grow the render window once the user has scrolled within ~2 row-heights of the
		// bottom, so more rows are already in the DOM by the time they'd actually reach them.
		const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
		if (nearBottom) {
			renderLimit = Math.min(renderLimit + RENDER_PAGE_SIZE, matchingOptions.length);
		}
	}

	function openListbox() {
		listboxOpen = true;
		activeIndex = filteredOptions.length > 0 ? 0 : -1;
	}

	function closeListbox() {
		listboxOpen = false;
		activeIndex = -1;
	}

	// Picking an item keeps whatever the user typed and keeps the listbox open, so equipping
	// several items matching the same search (e.g. "masterwork") doesn't require retyping
	// between picks. The query text is never cleared automatically -- only the user deleting
	// it (or a fresh mount) changes it. Closing the box (Escape/click-outside/blur) leaves it
	// exactly as typed, so reopening/refocusing shows the same filtered results.
	function choose(opt: T | null) {
		value = opt ? getValue(opt) : '';
		// Keep keyboard focus on the item that was just picked (its index in the still-current
		// filtered list) rather than jumping back to the top -- lets arrow keys continue
		// naturally from where the user was, e.g. Down, Enter, Down, Enter to equip a run of
		// adjacent matches without re-scanning from the first result each time.
		const chosenIndex = opt ? filteredOptions.findIndex((o) => getValue(o) === getValue(opt)) : -1;
		activeIndex = chosenIndex >= 0 ? chosenIndex : filteredOptions.length > 0 ? 0 : -1;
	}

	function onInputFocus() {
		openListbox();
	}

	function onInputInput() {
		if (!listboxOpen) listboxOpen = true;
		activeIndex = filteredOptions.length > 0 ? 0 : -1;
		// Filtering re-renders the option list while the mouse may be sitting stationary
		// over it. If a different (or the same) <li> ends up under the pointer after the
		// re-render, the browser fires a synthetic mouseenter/mouseover on it even though
		// the mouse never moved -- ignore hover-driven activation until the mouse actually
		// moves again, so typing never causes whatever's under the cursor to get selected.
		suppressHoverUntilMove = true;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (!listboxOpen) {
				openListbox();
				return;
			}
			// Grow the render window a page early when arrowing down near the current end of
			// the rendered list, so keyboard-only users can walk past the initial page just
			// like scrolling does -- otherwise ArrowDown would dead-end at row `renderLimit`
			// even though there are more (unrendered) matches below.
			if (activeIndex >= filteredOptions.length - 5 && truncatedCount > 0) {
				renderLimit = Math.min(renderLimit + RENDER_PAGE_SIZE, matchingOptions.length);
			}
			activeIndex = Math.min(activeIndex + 1, filteredOptions.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (!listboxOpen) {
				openListbox();
				return;
			}
			activeIndex = Math.max(activeIndex - 1, 0);
		} else if (e.key === 'Enter') {
			if (listboxOpen) {
				e.preventDefault();
				const chosen = filteredOptions[activeIndex];
				if (chosen) choose(chosen);
			}
		} else if (e.key === 'Escape') {
			if (listboxOpen) {
				e.preventDefault();
				closeListbox();
			}
		}
	}

	function onNativeChange(e: Event) {
		value = (e.target as HTMLSelectElement).value;
	}

	const listboxId = $derived(`${id ?? 'combobox'}-listbox`);
	// Unique per instance so multiple comboboxes on one page don't fight over the same
	// CSS anchor-name. Rendering the listbox in a top-layer popover (rather than a plain
	// absolutely-positioned element) lets it escape any ancestor's overflow:hidden/clipping.
	const anchorName = $derived(`--combobox-anchor-${id ?? 'combobox'}`);

	let popoverEl: HTMLUListElement | undefined = $state();
	const supportsAnchorPositioning =
		typeof CSS !== 'undefined' && CSS.supports('position-anchor: --x');

	$effect(() => {
		if (!popoverEl) return;
		if (listboxOpen) {
			// Anchor positioning handles placement via CSS when supported. Otherwise, compute
			// viewport coordinates from the input's rect so the fixed-position popover lands
			// in the right place (see the "not (position-anchor: ...)" fallback CSS).
			if (!supportsAnchorPositioning && inputEl) {
				const rect = inputEl.getBoundingClientRect();
				popoverEl.style.setProperty('--combobox-fallback-top', `${rect.bottom}px`);
				popoverEl.style.setProperty('--combobox-fallback-left', `${rect.left}px`);
				popoverEl.style.setProperty('--combobox-fallback-width', `${rect.width}px`);
			}
			popoverEl.showPopover();
		} else {
			popoverEl.hidePopover();
		}
	});

	function onDocumentClick(e: MouseEvent) {
		const target = e.target as Node;
		if (rootEl?.contains(target) || popoverEl?.contains(target)) return;
		if (listboxOpen) closeListbox();
	}

	// Arrow-key navigation moves activeIndex, but the browser has no reason to scroll the
	// listbox on its own -- without this, focus can move to an item scrolled out of view,
	// leaving the user unable to see (or visually confirm) what's currently highlighted.
	// Indexed positionally via children rather than by id lookup, since the "No matches"
	// empty-state <li> has no id and options are rendered in the same order as activeIndex.
	$effect(() => {
		if (!listboxOpen || activeIndex < 0 || !popoverEl) return;
		popoverEl.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
	});
</script>

<svelte:document onclick={onDocumentClick} />

<div class="combobox-root" bind:this={rootEl} class:js-enabled={jsEnabled}>
	<!-- No-JS baseline: a plain native select. Always rendered and functional; hidden via
	     CSS only once JS has confirmed the enhanced combobox is active. -->
	<select class="native-select" {id} {disabled} {value} onchange={onNativeChange}>
		<option value="">{emptyOptionLabel}</option>
		{#each options as opt (getValue(opt))}
			<option value={getValue(opt)}>{getLabel(opt)}</option>
		{/each}
	</select>

	{#if jsEnabled}
		<div class="enhanced-combobox" style:anchor-name={anchorName}>
			<input
				bind:this={inputEl}
				type="text"
				role="combobox"
				aria-expanded={listboxOpen}
				aria-controls={listboxId}
				aria-autocomplete="list"
				aria-activedescendant={activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
				autocomplete="off"
				{disabled}
				{placeholder}
				bind:value={query}
				onfocus={onInputFocus}
				oninput={onInputInput}
				onkeydown={onKeydown}
			/>
			<!-- popover="manual": open state is driven entirely by our own listboxOpen/$effect
			     below (we need it to open on focus/typing, not just a click toggle). popover="auto"
			     was tried here but its native light-dismiss logic could treat the very click that
			     focused the input as an "outside click," closing the popover the instant it opened.
			     Click-outside and Escape are handled manually instead (see onDocumentClick/onKeydown).
			     Rendering in the top layer means an ancestor's overflow:hidden can never clip this list. -->
			<ul
				bind:this={popoverEl}
				popover="manual"
				class="listbox"
				role="listbox"
				id={listboxId}
				style:position-anchor={anchorName}
				onmousemove={() => (suppressHoverUntilMove = false)}
				onscroll={onListboxScroll}
			>
				{#if filteredOptions.length === 0}
					<li class="listbox-empty">No matches</li>
				{/if}
				{#each filteredOptions as opt, i (getValue(opt))}
					<!-- Keyboard selection is handled by the input's onkeydown (ARIA combobox
					     pattern: the input owns focus, options are activated via aria-activedescendant). -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<li
						id="{listboxId}-opt-{i}"
						role="option"
						aria-selected={getValue(opt) === value}
						class:active={i === activeIndex}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => {
							if (suppressHoverUntilMove) return;
							choose(opt);
						}}
						onmouseenter={() => {
							if (suppressHoverUntilMove) return;
							activeIndex = i;
						}}
					>
						{#if option}
							{@render option(opt)}
						{:else}
							{getLabel(opt)}
						{/if}
					</li>
				{/each}
				{#if truncatedCount > 0}
					<li class="listbox-empty">+{truncatedCount} more &ndash; scroll for more</li>
				{/if}
			</ul>
		</div>
	{/if}
</div>

<style>
	.combobox-root {
		position: relative;
	}

	/* Once the enhanced combobox has mounted, hide the native select visually but keep
	   the enhanced input as the real interactive control. */
	.combobox-root.js-enabled .native-select {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.native-select {
		width: 100%;
		font-size: 1rem;
		padding: 0.4rem 0.5rem;
		background-color: #100c08;
		color: #e8dcc4;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
	}

	/* Explicit colors on <option> too: color-scheme: dark (set globally) handles most
	   browsers' native dropdown popup chrome, but some UAs still need option-level
	   colors set directly to avoid low-contrast black-on-dark text. */
	.native-select option {
		background-color: #100c08;
		color: #e8dcc4;
	}

	.enhanced-combobox {
		position: relative;
	}

	.enhanced-combobox input {
		width: 100%;
		box-sizing: border-box;
	}

	/* Rendered as a top-layer popover so it can never be clipped by an ancestor's
	   overflow:hidden. Positioned via CSS anchor positioning, tied to the input via
	   anchor-name/position-anchor (set inline per-instance in the component). */
	.listbox {
		position: fixed;
		margin: 0.25rem 0 0;
		padding: 0.25rem;
		list-style: none;
		max-height: 16rem;
		overflow-y: auto;
		background: #100c08;
		border: 1px solid #5a4a2c;
		border-radius: 4px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
	}

	@supports (position-anchor: --x) {
		.listbox {
			position-area: bottom span-right;
			width: anchor-size(width);
			/* Always render below the input, never flipped above it -- the page guarantees
			   scroll room below every combobox (see .scroll-spacer) so there's always space. */
			position-try-fallbacks: none;
		}
	}

	@supports not (position-anchor: --x) {
		/* Fallback for browsers without CSS anchor positioning: still escapes ancestor
		   overflow via the top-layer popover, but falls back to viewport-relative
		   coordinates set from JS (see positionFallback in the component script). */
		.listbox {
			top: var(--combobox-fallback-top, 0px);
			left: var(--combobox-fallback-left, 0px);
			width: var(--combobox-fallback-width, auto);
		}
	}

	.listbox li {
		padding: 0.35rem 0.5rem;
		border-radius: 3px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.listbox li.active {
		background: #2e2517;
	}

	.listbox-empty {
		color: #6b5d42;
		font-style: italic;
		cursor: default;
	}
</style>
