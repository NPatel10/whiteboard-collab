<script lang="ts">
	import { cn } from "$lib/utils.js";
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import type { IconProps } from "@lucide/svelte";

	type SpinnerProps = Omit<IconProps, "name" | "iconNode" | "children" | "title"> & {
		"aria-label"?: string;
	};

	let {
		class: className,
		role = "status",
		color,
		stroke,
		"aria-label": ariaLabel = "Loading",
		...restProps
	}: SpinnerProps = $props();
</script>

<Loader2Icon
	{role}
	{color}
	stroke={stroke}
	aria-label={ariaLabel}
	class={cn("size-4 animate-spin", className)}
	{...restProps}
/>
