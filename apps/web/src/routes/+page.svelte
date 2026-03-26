<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import {
		publicRuntimeConfig,
		type ParticipantRole,
		type ParticipantSummary,
		type WhiteboardTool
	} from '$lib';

	type OverlayState = 'invalid-code' | 'reconnecting' | null;
	type ShellState = 'landing' | 'board';

	type ToolbarOption = {
		id: WhiteboardTool;
		label: string;
		shortcut: string;
	};

	type BoardMetric = {
		label: string;
		value: string;
	};

	const previewJoinCode = 'A7F3KQ9X';
	const participants: ParticipantSummary[] = [
		{ actor_id: 'u_owner_1', nickname: 'Nayan', role: 'owner', color: '#f97316' },
		{ actor_id: 'u_guest_1', nickname: 'Mira', role: 'guest', color: '#10b981' },
		{ actor_id: 'u_guest_2', nickname: 'Kai', role: 'guest', color: '#0ea5e9' }
	];
	const tools: ToolbarOption[] = [
		{ id: 'select', label: 'Select', shortcut: 'V' },
		{ id: 'pen', label: 'Pen', shortcut: 'P' },
		{ id: 'eraser', label: 'Eraser', shortcut: 'E' },
		{ id: 'shapes', label: 'Shapes', shortcut: 'R' },
		{ id: 'text', label: 'Text', shortcut: 'T' },
		{ id: 'sticky', label: 'Sticky', shortcut: 'N' }
	];
	const ownerMetrics: BoardMetric[] = [
		{ label: 'Participants', value: '3 / 4' },
		{ label: 'Snapshot version', value: '18' },
		{ label: 'Action cursor', value: '245' }
	];
	const guestMetrics: BoardMetric[] = [
		{ label: 'Participants', value: '3 / 4' },
		{ label: 'Owner source', value: 'Nayan' },
		{ label: 'Sync status', value: 'Ready' }
	];

	let activeTool = $state<WhiteboardTool>('pen');
	let boardRole = $state<ParticipantRole>('owner');
	let overlayState = $state<OverlayState>(null);
	let shellState = $state<ShellState>('landing');

	function openBoard(role: ParticipantRole) {
		boardRole = role;
		shellState = 'board';
		overlayState = null;
		activeTool = role === 'owner' ? 'pen' : 'select';
	}

	function showReconnectOverlay() {
		shellState = 'board';
		overlayState = 'reconnecting';
	}

	function showInvalidCodeState() {
		shellState = 'landing';
		overlayState = 'invalid-code';
	}

	function resetToLanding() {
		shellState = 'landing';
		overlayState = null;
	}

	function selectTool(toolId: WhiteboardTool) {
		activeTool = toolId;
	}

	function isActiveTool(toolId: WhiteboardTool) {
		return activeTool === toolId;
	}
</script>

<svelte:head>
	<title>Whiteboard Collab</title>
	<meta
		name="description"
		content="Single-route collaborative whiteboard shell with landing, board, reconnecting, and invalid-code states."
	/>
</svelte:head>

<div class="min-h-screen bg-[linear-gradient(180deg,#f6efe6_0%,#f3f1eb_30%,#eef2f3_100%)] text-zinc-950">
	<div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
		<header class="flex items-center justify-between">
			<div class="space-y-1">
				<p class="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">Whiteboard Collab</p>
				<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">One route, five app states.</h1>
			</div>

			<div class="flex items-center gap-2">
				<Badge variant="outline" class="border-zinc-950/10 bg-white/70 text-zinc-700">
					{publicRuntimeConfig.relayWsUrl}
				</Badge>
				<Button variant="outline" class="bg-white/80" onclick={resetToLanding}>Landing</Button>
			</div>
		</header>

		{#if shellState === 'landing'}
			<section class="grid flex-1 items-center gap-6 py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] lg:py-14">
				<div class="space-y-8">
					<div class="space-y-4">
						<Badge class="bg-amber-500 text-amber-950">Single-route app shell</Badge>
						<h2 class="max-w-2xl text-4xl font-semibold tracking-tight text-zinc-950 sm:text-6xl">
							Landing, board, reconnecting, and invalid-code states live in the same route.
						</h2>
						<p class="max-w-xl text-lg leading-8 text-zinc-700">
							This shell keeps navigation flat so socket, board, and participant state can survive local
							route changes. The board view is already split for owner and guest chrome.
						</p>
					</div>

					<div class="flex flex-wrap gap-3">
						<Button size="lg" class="bg-zinc-950 text-white hover:bg-zinc-800" onclick={() => openBoard('owner')}>
							Preview owner board
						</Button>
						<Button size="lg" variant="outline" class="bg-white/80" onclick={() => openBoard('guest')}>
							Preview guest board
						</Button>
						<Button size="lg" variant="ghost" class="text-zinc-700 hover:bg-white/70" onclick={showInvalidCodeState}>
							Show invalid-code state
						</Button>
					</div>

					<div class="grid gap-3 sm:grid-cols-3">
						{#each [
							{ label: 'Route', value: '/' },
							{ label: 'Relay HTTP', value: publicRuntimeConfig.relayHttpUrl },
							{ label: 'Default nickname', value: publicRuntimeConfig.defaultNickname }
						] as item}
							<div class="rounded-3xl border border-white/70 bg-white/70 p-4 shadow-[0_1px_0_rgba(255,255,255,0.7)] backdrop-blur">
								<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">{item.label}</p>
								<p class="mt-2 text-sm font-medium text-zinc-900">{item.value}</p>
							</div>
						{/each}
					</div>
				</div>

				<Card class="overflow-hidden border-white/70 bg-white/80 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
					<CardHeader class="gap-3 border-b border-zinc-950/5">
						<div class="flex items-center justify-between gap-3">
							<div>
								<CardTitle class="text-xl text-zinc-950">State Preview</CardTitle>
								<CardDescription class="text-zinc-600">
									The same page renders all runtime states without leaving `/`.
								</CardDescription>
							</div>
							<Badge class="bg-zinc-950 text-white">Route shell</Badge>
						</div>
					</CardHeader>
					<CardContent class="space-y-5 pt-6">
						<div class="grid gap-3">
							{#each [
								{
									name: 'Landing',
									body: 'Create and join entry points stay together with validation UI.'
								},
								{
									name: 'Owner board',
									body: 'Top bar, tool rail, canvas, and participant panel are already laid out.'
								},
								{
									name: 'Guest board',
									body: 'Owner-only actions drop away while export and sync status remain visible.'
								},
								{
									name: 'Reconnecting',
									body: 'Board stays mounted and receives an overlay instead of navigating away.'
								},
								{
									name: 'Invalid code',
									body: 'Join failure resolves inline on the landing shell instead of a separate page.'
								}
							] as state}
								<div class="rounded-3xl border border-zinc-950/8 bg-zinc-50/80 p-4">
									<div class="flex items-center justify-between gap-3">
										<p class="text-sm font-semibold text-zinc-900">{state.name}</p>
										<div class="size-2 rounded-full bg-amber-500"></div>
									</div>
									<p class="mt-2 text-sm leading-6 text-zinc-600">{state.body}</p>
								</div>
							{/each}
						</div>

						{#if overlayState === 'invalid-code'}
							<div class="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
								<p class="text-sm font-semibold uppercase tracking-[0.24em] text-rose-700">Invalid Code</p>
								<p class="mt-3 text-base font-medium">The join code is invalid, expired, or unavailable.</p>
								<p class="mt-2 text-sm leading-6 text-rose-700">
									The landing shell handles this inline so the user can retry immediately without losing
									context.
								</p>
							</div>
						{/if}
					</CardContent>
				</Card>
			</section>
		{:else}
			<section class="flex flex-1 flex-col gap-4 py-6">
				<div class="flex flex-wrap items-center justify-between gap-3 rounded-[1.75rem] border border-white/70 bg-white/75 px-5 py-4 shadow-[0_16px_50px_rgba(15,23,42,0.06)] backdrop-blur">
					<div class="space-y-1">
						<div class="flex items-center gap-2">
							<Badge class={boardRole === 'owner' ? 'bg-amber-500 text-amber-950' : 'bg-sky-500 text-sky-950'}>
								{boardRole === 'owner' ? 'Owner board' : 'Guest board'}
							</Badge>
							<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">
								{overlayState === 'reconnecting' ? 'Reconnecting' : 'Live canvas'}
							</Badge>
						</div>
						<h2 class="text-xl font-semibold tracking-tight text-zinc-950">
							{boardRole === 'owner' ? 'Authority view for snapshots and controls' : 'Guest view with owner-synced state'}
						</h2>
						<p class="text-sm text-zinc-600">
							Board <span class="font-medium text-zinc-900">{previewJoinCode}</span> stays in the same route while UI
							chrome adapts by role and connection state.
						</p>
					</div>

					<div class="flex flex-wrap gap-2">
						<Button variant="outline" class="bg-white" onclick={() => openBoard(boardRole)}>
							Clear overlay
						</Button>
						<Button variant="outline" class="bg-white" onclick={showReconnectOverlay}>
							Show reconnecting
						</Button>
						<Button variant="outline" class="bg-white" onclick={resetToLanding}>
							Back to landing
						</Button>
					</div>
				</div>

				<div class="grid flex-1 gap-4 xl:grid-cols-[5.5rem_minmax(0,1fr)_18rem]">
					<div class="rounded-[1.75rem] border border-white/70 bg-white/80 p-3 shadow-[0_12px_40px_rgba(15,23,42,0.05)] backdrop-blur">
						<div class="flex flex-row gap-2 overflow-x-auto xl:flex-col xl:overflow-visible">
							{#each tools as tool}
								<button
									type="button"
									class={`flex min-w-20 flex-1 flex-col items-center justify-center gap-1 rounded-2xl border px-3 py-3 text-center transition ${
										isActiveTool(tool.id)
											? 'border-amber-400 bg-amber-50 text-amber-950 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.25)]'
											: 'border-transparent bg-zinc-50 text-zinc-600 hover:border-zinc-200 hover:bg-white'
									}`}
									onclick={() => selectTool(tool.id)}
								>
									<span class="text-sm font-semibold">{tool.label}</span>
									<span class="text-xs uppercase tracking-[0.22em] text-zinc-400">{tool.shortcut}</span>
								</button>
							{/each}
						</div>
					</div>

					<div class="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
						<div class="flex items-center justify-between gap-3 border-b border-zinc-950/5 px-5 py-4">
							<div class="flex items-center gap-2">
								<div class="size-3 rounded-full bg-emerald-500"></div>
								<p class="text-sm font-semibold text-zinc-900">Infinite canvas shell</p>
							</div>
							<div class="flex items-center gap-2">
								{#if boardRole === 'owner'}
									<Button variant="outline" size="sm" class="bg-white">Share</Button>
									<Button variant="outline" size="sm" class="bg-white">Import</Button>
								{/if}
								<Button variant="outline" size="sm" class="bg-white">Export</Button>
							</div>
						</div>

						<div class="relative min-h-[34rem] bg-[linear-gradient(90deg,rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(rgba(15,23,42,0.05)_1px,transparent_1px)] bg-[size:32px_32px]">
							<div class="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.2),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.12),transparent_28%)]"></div>
							<div class="relative flex h-full min-h-[34rem] flex-col justify-between px-6 py-6">
								<div class="flex flex-wrap gap-3">
									<div class="rounded-3xl border border-zinc-950/10 bg-white/85 px-4 py-3 shadow-sm">
										<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Active tool</p>
										<p class="mt-2 text-base font-semibold text-zinc-950">{activeTool}</p>
									</div>
									<div class="rounded-3xl border border-zinc-950/10 bg-white/85 px-4 py-3 shadow-sm">
										<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Connection</p>
										<p class="mt-2 text-base font-semibold text-zinc-950">
											{overlayState === 'reconnecting' ? 'Waiting for relay' : 'Stable'}
										</p>
									</div>
								</div>

								<div class="flex flex-wrap items-end justify-between gap-6">
									<div class="max-w-md rounded-[1.75rem] border border-zinc-950/10 bg-white/85 p-5 shadow-sm">
										<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Canvas Notes</p>
										<p class="mt-3 text-lg font-semibold text-zinc-950">
											Keep the board mounted while participant, sync, and reconnect UX changes around it.
										</p>
										<p class="mt-2 text-sm leading-6 text-zinc-600">
											This layout already reserves stable regions for the top bar, tool rail, canvas
											controls, and participant list.
										</p>
									</div>

									<div class="flex items-center gap-2 rounded-full border border-zinc-950/10 bg-white/85 px-3 py-2 shadow-sm">
										<Button variant="outline" size="sm" class="rounded-full bg-white px-4">Fit view</Button>
										<Button variant="outline" size="sm" class="rounded-full bg-white px-4">Undo</Button>
										<Button variant="outline" size="sm" class="rounded-full bg-white px-4">Redo</Button>
									</div>
								</div>
							</div>

							{#if overlayState === 'reconnecting'}
								<div class="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/35 p-6 backdrop-blur-sm">
									<div class="w-full max-w-md rounded-[1.75rem] border border-white/20 bg-zinc-950/90 p-6 text-white shadow-2xl">
										<p class="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">Reconnecting</p>
										<h3 class="mt-3 text-2xl font-semibold tracking-tight">
											Suspend edits until relay sync recovers.
										</h3>
										<p class="mt-3 text-sm leading-6 text-zinc-300">
											The board shell stays mounted so we can show progress, preserve viewport context, and
											apply a fresh snapshot when the owner comes back online.
										</p>
										<div class="mt-6 flex gap-2">
											<Button class="bg-amber-400 text-zinc-950 hover:bg-amber-300" onclick={() => openBoard(boardRole)}>
												Resume preview
											</Button>
											<Button variant="outline" class="border-white/20 bg-transparent text-white hover:bg-white/10" onclick={resetToLanding}>
												Leave board
											</Button>
										</div>
									</div>
								</div>
							{/if}
						</div>
					</div>

					<aside class="rounded-[1.75rem] border border-white/70 bg-white/80 p-5 shadow-[0_12px_40px_rgba(15,23,42,0.05)] backdrop-blur">
						<div class="flex items-center justify-between gap-3">
							<div>
								<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Board Meta</p>
								<h3 class="mt-2 text-lg font-semibold text-zinc-950">Participants and sync context</h3>
							</div>
							<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">
								{boardRole === 'owner' ? 'Owner controls' : 'Guest controls'}
							</Badge>
						</div>

						<div class="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
							{#each boardRole === 'owner' ? ownerMetrics : guestMetrics as metric}
								<div class="rounded-3xl border border-zinc-950/8 bg-zinc-50/80 p-4">
									<p class="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">{metric.label}</p>
									<p class="mt-2 text-sm font-semibold text-zinc-950">{metric.value}</p>
								</div>
							{/each}
						</div>

						<Separator class="my-5 bg-zinc-950/8" />

						<div class="space-y-3">
							{#each participants as participant}
								<div class="flex items-center justify-between gap-3 rounded-3xl border border-zinc-950/8 bg-white/85 px-4 py-3">
									<div class="flex items-center gap-3">
										<div
											class="flex size-10 items-center justify-center rounded-2xl text-sm font-semibold text-white"
											style={`background-color: ${participant.color};`}
										>
											{participant.nickname.slice(0, 2).toUpperCase()}
										</div>
										<div>
											<p class="text-sm font-semibold text-zinc-950">{participant.nickname}</p>
											<p class="text-xs uppercase tracking-[0.2em] text-zinc-500">{participant.role}</p>
										</div>
									</div>

									{#if boardRole === 'owner' && participant.role === 'guest'}
										<Button variant="outline" size="sm" class="bg-white">Kick</Button>
									{/if}
								</div>
							{/each}
						</div>
					</aside>
				</div>
			</section>
		{/if}
	</div>
</div>
