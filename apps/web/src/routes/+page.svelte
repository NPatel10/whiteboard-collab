<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '$lib/components/ui/drawer';
	import { Input } from '$lib/components/ui/input';
	import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '$lib/components/ui/sheet';
	import {
		appConnectionState,
		appSessionState,
		publicRuntimeConfig,
		type ParticipantRole,
		type ParticipantSummary,
		type WhiteboardTool
	} from '$lib';

	import BrushIcon from '@lucide/svelte/icons/brush';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import EraserIcon from '@lucide/svelte/icons/eraser';
	import FrameIcon from '@lucide/svelte/icons/frame';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import MonitorSmartphoneIcon from '@lucide/svelte/icons/monitor-smartphone';
	import MousePointer2Icon from '@lucide/svelte/icons/mouse-pointer-2';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open';
	import PenToolIcon from '@lucide/svelte/icons/pen-tool';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Share2Icon from '@lucide/svelte/icons/share-2';
	import StickyNoteIcon from '@lucide/svelte/icons/sticky-note';
	import TypeOutlineIcon from '@lucide/svelte/icons/type-outline';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import UsersIcon from '@lucide/svelte/icons/users';

	type ShellState = 'landing' | 'board';
	type OverlayState = 'invalid-code' | 'board-full' | 'reconnecting' | null;
	type ToolbarOption = { id: WhiteboardTool; label: string; shortcut: string; icon: any };
	type BoardMetric = { label: string; value: string };
	type RemoteCursorPlacement = 'above' | 'below';
	type RemoteCursor = {
		actorId: string;
		nickname: string;
		color: string;
		left: string;
		top: string;
		placement: RemoteCursorPlacement;
		tool: string;
		state: string;
	};

	const defaultJoinCode = 'A7F3KQ9X';
	const invalidJoinCodeError = 'Enter a valid 8-character board code.';
	const boardFullMessage = 'This board is full. All 4 seats are occupied.';
	const joinCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const paletteOptions = [
		{ label: 'Amber', value: '#f97316' },
		{ label: 'Sky', value: '#0ea5e9' },
		{ label: 'Mint', value: '#10b981' },
		{ label: 'Violet', value: '#8b5cf6' },
		{ label: 'Rose', value: '#f43f5e' }
	];
	const brushPresets = [2, 4, 6, 10, 16];
	const remoteCursorAnchors: Array<Pick<RemoteCursor, 'left' | 'top' | 'placement'>> = [
		{ left: '18%', top: '24%', placement: 'above' },
		{ left: '64%', top: '28%', placement: 'above' },
		{ left: '46%', top: '66%', placement: 'below' }
	];
	const ownerParticipant: ParticipantSummary = { actor_id: 'u_owner_1', nickname: 'Nayan', role: 'owner', color: '#f97316' };
	const guestBoardParticipant: ParticipantSummary = { actor_id: 'u_guest_2', nickname: 'Kai', role: 'guest', color: '#0ea5e9' };
	const tools: ToolbarOption[] = [
		{ id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2Icon },
		{ id: 'pen', label: 'Pen', shortcut: 'P', icon: PenToolIcon },
		{ id: 'eraser', label: 'Eraser', shortcut: 'E', icon: EraserIcon },
		{ id: 'shapes', label: 'Shapes', shortcut: 'R', icon: FrameIcon },
		{ id: 'text', label: 'Text', shortcut: 'T', icon: TypeOutlineIcon },
		{ id: 'sticky', label: 'Sticky', shortcut: 'N', icon: StickyNoteIcon }
	];

	let guestNickname = $state(publicRuntimeConfig.defaultNickname);
	let joinCode = $state('');
	let joinError = $state<string | null>(null);
	let isJoinFormOpen = $state(false);
	let activeTool = $state<WhiteboardTool>('pen');
	let overlayState = $state<OverlayState>(null);
	let shellState = $state<ShellState>('landing');
	let shareDialogOpen = $state(false);
	let mobileControlsOpen = $state(false);
	let mobilePeopleOpen = $state(false);
	let selectedColor = $state(paletteOptions[0].value);
	let brushSize = $state(brushPresets[2]);
	let isJoinCodeRevoked = $state(false);
	let boardActivityMessage = $state('Canvas ready for live collaboration.');

	function generateJoinCode(length = 8) {
		let code = '';
		for (let index = 0; index < length; index += 1) {
			code += joinCodeAlphabet[Math.floor(Math.random() * joinCodeAlphabet.length)];
		}
		return code;
	}

	function currentJoinCode() {
		return appSessionState.joinCode || defaultJoinCode;
	}

	function setBoardActivity(message: string) {
		boardActivityMessage = message;
	}

	function createBoard() {
		appSessionState.setSession({
			actorId: ownerParticipant.actor_id,
			boardId: 'board_1',
			joinCode: defaultJoinCode,
			role: 'owner',
			participants: [ownerParticipant, guestBoardParticipant]
		});
		isJoinCodeRevoked = false;
		selectedColor = ownerParticipant.color;
		brushSize = brushPresets[2];
		isJoinFormOpen = false;
		joinError = null;
		overlayState = null;
		setBoardActivity('Owner board created. Share the code to invite guests.');
		openBoard('owner');
	}

	function openBoard(role: ParticipantRole) {
		appSessionState.setRole(role);
		shellState = 'board';
		overlayState = null;
		appConnectionState.setConnected();
		activeTool = role === 'owner' ? 'pen' : 'select';
		selectedColor = role === 'owner' ? ownerParticipant.color : guestBoardParticipant.color;
		brushSize = role === 'owner' ? 8 : 4;
		shareDialogOpen = false;
		mobileControlsOpen = false;
		mobilePeopleOpen = false;
		setBoardActivity(role === 'owner' ? 'Owner board synced and ready.' : 'Guest board synced with owner state.');
	}

	function showReconnectOverlay() {
		shellState = 'board';
		overlayState = 'reconnecting';
		appConnectionState.setReconnecting();
		setBoardActivity('Relay connection is reconnecting.');
	}

	function showBoardFullOverlay() {
		shellState = 'board';
		overlayState = 'board-full';
		appConnectionState.setConnected();
		activeTool = 'select';
		setBoardActivity(boardFullMessage);
	}

	function toggleJoinForm() {
		isJoinFormOpen = !isJoinFormOpen;
		joinError = null;
		overlayState = null;
		appConnectionState.setDisconnected();
	}

	function resetToLanding() {
		shellState = 'landing';
		overlayState = null;
		appConnectionState.setDisconnected();
		appSessionState.clearSession();
		shareDialogOpen = false;
		mobileControlsOpen = false;
		mobilePeopleOpen = false;
		isJoinCodeRevoked = false;
		selectedColor = paletteOptions[0].value;
		brushSize = brushPresets[2];
		activeTool = 'pen';
		setBoardActivity('Ready.');
	}

	function selectTool(toolId: WhiteboardTool) {
		activeTool = toolId;
		const tool = tools.find((entry) => entry.id === toolId);
		setBoardActivity(`${tool?.label ?? toolId} tool selected.`);
	}

	function selectColor(color: string) {
		selectedColor = color;
		setBoardActivity(`Color ${color} selected.`);
	}

	function selectBrush(size: number) {
		brushSize = size;
		setBoardActivity(`${size}px brush selected.`);
	}

	function openShareDialog() {
		shareDialogOpen = true;
		setBoardActivity(isJoinCodeRevoked ? 'Share dialog open with revoked code.' : 'Share dialog open for the active board.');
	}

	function openControlsDrawer() {
		mobileControlsOpen = true;
		setBoardActivity('Secondary controls open.');
	}

	function openParticipantsSheet() {
		mobilePeopleOpen = true;
		setBoardActivity('Participants panel open.');
	}

	async function copyJoinCode() {
		if (typeof navigator === 'undefined' || !navigator.clipboard) {
			setBoardActivity('Clipboard is unavailable.');
			return;
		}
		await navigator.clipboard.writeText(currentJoinCode());
		setBoardActivity(`Copied ${currentJoinCode()} to the clipboard.`);
	}

	function revokeJoinCode() {
		if (appSessionState.role !== 'owner') return;
		isJoinCodeRevoked = true;
		setBoardActivity(`Join code ${currentJoinCode()} revoked.`);
	}

	function regenerateJoinCode() {
		if (appSessionState.role !== 'owner') return;
		appSessionState.setJoinCode(generateJoinCode());
		isJoinCodeRevoked = false;
		shareDialogOpen = true;
		setBoardActivity(`Generated a new join code: ${currentJoinCode()}.`);
	}

	function handleImport() {
		openControlsDrawer();
		setBoardActivity('Import from JSON is staged in the controls drawer.');
	}

	function handleExport() {
		openControlsDrawer();
		setBoardActivity('Export to JSON or PNG is staged in the controls drawer.');
	}

	function kickParticipant(actorId: string) {
		if (appSessionState.role !== 'owner') return;
		const target = getParticipants().find((participant) => participant.actor_id === actorId);
		if (!target || target.role === 'owner') return;
		appSessionState.setParticipants(getParticipants().filter((participant) => participant.actor_id !== actorId));
		setBoardActivity(`${target.nickname} removed from the board.`);
	}

	function handleJoinCodeInput(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		joinCode = target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
	}

	function handleNicknameInput(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		guestNickname = target.value.slice(0, 24);
	}

	function submitJoin(event: SubmitEvent) {
		event.preventDefault();
		const trimmedNickname = guestNickname.trim();
		const normalizedJoinCode = joinCode.trim().toUpperCase();

		if (trimmedNickname.length < 2) {
			joinError = 'Enter a nickname with at least 2 characters.';
			overlayState = 'invalid-code';
			return;
		}

		if (normalizedJoinCode.length !== 8) {
			joinError = invalidJoinCodeError;
			overlayState = 'invalid-code';
			return;
		}

		guestNickname = trimmedNickname;
		joinError = null;
		overlayState = null;
		isJoinFormOpen = false;
		appSessionState.setSession({
			actorId: 'u_guest_local',
			boardId: `board_${normalizedJoinCode.toLowerCase()}`,
			joinCode: normalizedJoinCode,
			role: 'guest',
			participants: [
				ownerParticipant,
				{ actor_id: 'u_guest_local', nickname: trimmedNickname, role: 'guest', color: '#10b981' },
				guestBoardParticipant
			]
		});
		isJoinCodeRevoked = false;
		selectedColor = guestBoardParticipant.color;
		brushSize = 4;
		openBoard('guest');
		setBoardActivity(`Guest ${trimmedNickname} joined board ${normalizedJoinCode}.`);
	}

	function getParticipants(): ParticipantSummary[] {
		return appSessionState.participants.length > 0 ? appSessionState.participants : [ownerParticipant, guestBoardParticipant];
	}

	function getRemoteCursors(): RemoteCursor[] {
		return getParticipants()
			.filter((participant) => participant.actor_id !== appSessionState.actorId)
			.map((participant, index) => {
				const anchor = remoteCursorAnchors[index % remoteCursorAnchors.length];
				return {
					actorId: participant.actor_id,
					nickname: participant.nickname,
					color: participant.color,
					left: anchor.left,
					top: anchor.top,
					placement: anchor.placement,
					tool: participant.role === 'owner' ? 'pen' : index % 2 === 0 ? 'select' : 'text',
					state: participant.role === 'owner' ? 'drawing on the shared canvas' : 'editing with the live board'
				};
			});
	}

	function getBoardStats(): BoardMetric[] {
		return [
			{ label: 'Seats', value: `${getParticipants().length} / 4` },
			{ label: 'Sync', value: appConnectionState.isReconnecting ? 'Paused' : 'Live' },
			{ label: 'Brush', value: `${brushSize}px` }
		];
	}
</script>

<svelte:head>
	<title>Whiteboard Collab</title>
	<meta name="description" content="Create or join a collaborative whiteboard session." />
</svelte:head>

<div class="min-h-screen bg-[linear-gradient(180deg,#f6efe6_0%,#f3f1eb_30%,#eef2f3_100%)] text-zinc-950">
	<div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
		<header class="flex items-center justify-between gap-3">
			<div class="space-y-1">
				<p class="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">Whiteboard Collab</p>
				<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">Collaborative whiteboard</h1>
			</div>
			<div class="flex items-center gap-2">
				<Badge variant="outline" class="border-zinc-950/10 bg-white/70 text-zinc-700">{publicRuntimeConfig.relayWsUrl}</Badge>
				<Button variant="outline" class="bg-white/80" onclick={resetToLanding}>Landing</Button>
			</div>
		</header>

		{#if shellState === 'landing'}
			<section class="grid flex-1 items-center gap-6 py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)] lg:py-14">
				<div class="space-y-6">
					<Badge class="bg-amber-500 text-amber-950">Live collaboration</Badge>
					<h2 class="max-w-2xl text-4xl font-semibold tracking-tight text-zinc-950 sm:text-6xl">
						Create a board or join with a code.
					</h2>
				</div>

				<Card class="overflow-hidden border-white/70 bg-white/80 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
					<CardHeader class="border-b border-zinc-950/5">
						<div class="flex items-center justify-between gap-3">
							<div>
								<CardTitle class="text-xl text-zinc-950">Start a session</CardTitle>
								<CardDescription class="text-zinc-600">Create a board or join an active session.</CardDescription>
							</div>
							<Badge class="bg-zinc-950 text-white">Ready</Badge>
						</div>
					</CardHeader>
					<CardContent class="space-y-5 pt-6">
						<Button size="lg" class="bg-zinc-950 text-white hover:bg-zinc-800" onclick={createBoard}>Create board</Button>
						<Button size="lg" variant="outline" class="bg-white/80" onclick={toggleJoinForm}>{isJoinFormOpen ? 'Hide join form' : 'Join board'}</Button>
						<Button size="lg" variant="outline" class="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" onclick={showBoardFullOverlay}>Board full</Button>

						{#if isJoinFormOpen}
							<form class="space-y-4 rounded-[1.75rem] border border-zinc-950/8 bg-zinc-50/80 p-5" onsubmit={submitJoin}>
								<label class="space-y-2 block" for="join-code">
									<span class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Join code</span>
									<Input id="join-code" class="bg-white uppercase tracking-[0.32em]" placeholder="A7F3KQ9X" value={joinCode} maxlength={8} aria-invalid={!!joinError} oninput={handleJoinCodeInput} />
								</label>
								<label class="space-y-2 block" for="nickname">
									<span class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Nickname</span>
									<Input id="nickname" class="bg-white" placeholder="Guest" value={guestNickname} maxlength={24} oninput={handleNicknameInput} />
								</label>
								<div class="flex flex-wrap justify-end gap-3">
									<Button type="submit" class="bg-amber-500 text-amber-950 hover:bg-amber-400">Join board</Button>
								</div>
							</form>
						{/if}

						{#if joinError}
							<div class="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
								<p class="text-sm font-semibold uppercase tracking-[0.24em] text-rose-700">
									{joinError === invalidJoinCodeError ? 'Invalid Code' : 'Validation Error'}
								</p>
								<p class="mt-3 text-base font-medium">{joinError}</p>
							</div>
						{/if}
					</CardContent>
				</Card>
			</section>
		{:else}
			<section class="flex flex-1 flex-col gap-4 py-6">
				<div class="rounded-[1.75rem] border border-white/70 bg-white/80 px-5 py-4 shadow-[0_16px_50px_rgba(15,23,42,0.06)] backdrop-blur">
					<div class="flex flex-wrap items-start justify-between gap-4">
						<div class="space-y-3">
							<div class="flex flex-wrap items-center gap-2">
								<Badge class={appSessionState.role === 'owner' ? 'bg-amber-500 text-amber-950' : 'bg-sky-500 text-sky-950'}>{appSessionState.role === 'owner' ? 'Owner board' : 'Guest board'}</Badge>
								<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">{appConnectionState.statusLabel}</Badge>
								<Badge variant="outline" class={appConnectionState.isReconnecting ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}>{appConnectionState.isReconnecting ? 'Sync paused' : 'Live sync'}</Badge>
								<Badge variant="outline" class={isJoinCodeRevoked ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-zinc-950/10 bg-white text-zinc-700'}>{isJoinCodeRevoked ? 'Code revoked' : 'Code active'}</Badge>
							</div>
							<h2 class="text-xl font-semibold tracking-tight text-zinc-950">{appSessionState.role === 'owner' ? 'Shared board' : 'Joined board'}</h2>
							<p class="text-sm text-zinc-600">Code <span class="font-medium text-zinc-900">{currentJoinCode()}</span></p>
							<p class="text-sm text-zinc-600">{boardActivityMessage}</p>
						</div>

						<div class="flex flex-wrap gap-2">
							<Button variant="outline" class="bg-white" onclick={openShareDialog}><Share2Icon class="size-4" />Share</Button>
							<Button variant="outline" class="bg-white" onclick={handleImport}><UploadIcon class="size-4" />Import</Button>
							<Button variant="outline" class="bg-white" onclick={handleExport}><DownloadIcon class="size-4" />Export</Button>
							<Button variant="outline" class="bg-white xl:hidden" onclick={openControlsDrawer}><MonitorSmartphoneIcon class="size-4" />Controls</Button>
							<Button variant="outline" class="bg-white xl:hidden" onclick={openParticipantsSheet}><PanelRightOpenIcon class="size-4" />People</Button>
							<Button variant="outline" class="bg-white" onclick={resetToLanding}>Back to landing</Button>
						</div>
					</div>
				</div>

				<div class="flex flex-wrap gap-2 xl:hidden">
					<Button class="bg-zinc-950 text-white hover:bg-zinc-800" onclick={openControlsDrawer}><MonitorSmartphoneIcon class="size-4" />Board controls</Button>
					<Button variant="outline" class="bg-white" onclick={openParticipantsSheet}><UsersIcon class="size-4" />Participants</Button>
				</div>

				<div class="grid flex-1 gap-4 xl:grid-cols-[18rem_minmax(0,1fr)_21rem]">
					<aside class="hidden flex-col rounded-[1.75rem] border border-white/70 bg-white/80 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.05)] backdrop-blur xl:flex">
						<div class="flex items-start justify-between gap-3">
							<div>
								<p class="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Toolbar</p>
								<h3 class="mt-1 text-lg font-semibold text-zinc-950">Tools</h3>
							</div>
							<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">Desktop</Badge>
						</div>

						<div class="mt-4 space-y-3">
							<div class="grid grid-cols-2 gap-2">
								{#each tools as tool}
									<Button
										variant="outline"
										class={activeTool === tool.id ? 'justify-start border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800' : 'justify-start border-zinc-950/10 bg-white text-zinc-700 hover:border-zinc-950/20 hover:bg-zinc-50'}
										aria-pressed={activeTool === tool.id}
										title={`${tool.label} (${tool.shortcut})`}
										onclick={() => selectTool(tool.id)}
									>
										<tool.icon class="size-4" />
										<span class="flex-1 text-left">{tool.label}</span>
										<span class="text-[0.7rem] uppercase tracking-[0.26em] text-current/60">{tool.shortcut}</span>
									</Button>
								{/each}
							</div>

							<div class="rounded-[1.5rem] border border-zinc-950/8 bg-zinc-50/80 p-3">
								<div class="flex items-center gap-2">
									<PaletteIcon class="size-4 text-amber-600" />
									<p class="text-sm font-semibold text-zinc-900">Color</p>
								</div>
								<div class="mt-3 flex flex-wrap gap-2">
									{#each paletteOptions as option}
										<button
											type="button"
											class={`relative size-11 rounded-full border-2 shadow-sm transition ${
												selectedColor === option.value ? 'border-zinc-950 ring-2 ring-zinc-950/10' : 'border-white hover:scale-105'
											}`}
											style={`background-color: ${option.value};`}
											aria-label={`Select ${option.label}`}
											aria-pressed={selectedColor === option.value}
											title={option.label}
											onclick={() => selectColor(option.value)}
										>
											{#if selectedColor === option.value}
												<CheckIcon class="absolute inset-0 m-auto size-4 text-white drop-shadow" />
											{/if}
										</button>
									{/each}
								</div>
							</div>

							<div class="rounded-[1.5rem] border border-zinc-950/8 bg-white p-3">
								<div class="flex items-center gap-2">
									<BrushIcon class="size-4 text-amber-600" />
									<p class="text-sm font-semibold text-zinc-900">Brush</p>
								</div>
								<div class="mt-3 grid grid-cols-3 gap-2">
									{#each brushPresets as size}
										<Button
											variant="outline"
											class={brushSize === size ? 'border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800' : 'border-zinc-950/10 bg-white text-zinc-700 hover:bg-zinc-50'}
											aria-pressed={brushSize === size}
											onclick={() => selectBrush(size)}
										>
											{size}px
										</Button>
									{/each}
								</div>
							</div>

							<div class="grid gap-2">
								<Button variant="outline" class="justify-start bg-white" onclick={handleImport}><UploadIcon class="size-4" />Import JSON</Button>
								<Button variant="outline" class="justify-start bg-white" onclick={handleExport}><DownloadIcon class="size-4" />Export PNG</Button>
							</div>
						</div>
					</aside>

					<div class="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
						<div class="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-950/5 px-5 py-4">
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<div class="size-3 rounded-full bg-emerald-500"></div>
									<p class="text-sm font-semibold text-zinc-900">Canvas</p>
								</div>
								<div class="flex flex-wrap items-center gap-2">
									<Badge variant="outline" class={appConnectionState.isReconnecting ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}>{appConnectionState.isReconnecting ? 'Sync paused' : 'Sync live'}</Badge>
									<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">{appConnectionState.statusLabel}</Badge>
									<Badge variant="outline" class={isJoinCodeRevoked ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-zinc-950/10 bg-white text-zinc-700'}>{isJoinCodeRevoked ? 'Code revoked' : 'Code active'}</Badge>
								</div>
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">Role {appSessionState.role}</Badge>
								<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">Tool {activeTool}</Badge>
								<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">{brushSize}px</Badge>
								<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">{selectedColor}</Badge>
							</div>
						</div>

						<div class="relative min-h-[34rem] bg-[linear-gradient(90deg,rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(rgba(15,23,42,0.05)_1px,transparent_1px)] bg-[size:32px_32px]">
							<div class="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.2),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.12),transparent_28%)]"></div>
							<div class="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
								{#each getRemoteCursors() as cursor}
									<div class="absolute" style={`left: ${cursor.left}; top: ${cursor.top};`}>
										<div class="relative">
											<div
												class="absolute -left-1.5 -top-1.5 size-4 rounded-full border-2 border-white shadow-[0_10px_30px_rgba(15,23,42,0.18)]"
												style={`background-color: ${cursor.color};`}
											></div>
											<div
												class={`absolute ${
													cursor.placement === 'above'
														? 'bottom-full mb-3'
														: 'top-full mt-3'
												} left-4 w-48 rounded-2xl border border-white/80 bg-white/95 px-3 py-2 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur`}
											>
												<div class="flex items-center justify-between gap-2">
													<p class="text-xs font-semibold text-zinc-900">{cursor.nickname}</p>
													<span
														class="rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.22em]"
														style={`background-color: color-mix(in srgb, ${cursor.color} 14%, white); color: ${cursor.color};`}
													>
														{cursor.tool}
													</span>
												</div>
												<p class="mt-1 text-[0.72rem] leading-5 text-zinc-600">{cursor.state}</p>
											</div>
											<div
												class={`absolute ${
													cursor.placement === 'above'
														? 'bottom-0 left-0 -translate-x-1/2 translate-y-1'
														: 'top-0 left-0 -translate-x-1/2 -translate-y-1'
												} h-8 w-[2px] rounded-full`}
												style={`background: linear-gradient(to bottom, transparent, ${cursor.color});`}
											></div>
										</div>
									</div>
								{/each}
							</div>
							<div class="relative flex h-full min-h-[34rem] flex-col justify-between gap-6 px-6 py-6">
								<div class="flex flex-wrap gap-3">
									<div class="rounded-3xl border border-zinc-950/10 bg-white/85 px-4 py-3 shadow-sm">
										<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Visible sync</p>
										<p class="mt-2 text-base font-semibold text-zinc-950">{appConnectionState.isReconnecting ? 'Waiting for relay' : 'Live and aligned'}</p>
									</div>
									<div class="rounded-3xl border border-zinc-950/10 bg-white/85 px-4 py-3 shadow-sm">
										<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Connection</p>
										<p class="mt-2 text-base font-semibold text-zinc-950">{appConnectionState.statusLabel}</p>
									</div>
									<div class="rounded-3xl border border-zinc-950/10 bg-white/85 px-4 py-3 shadow-sm">
										<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Participants</p>
										<p class="mt-2 text-base font-semibold text-zinc-950">{getParticipants().length} / 4</p>
									</div>
								</div>

								<div class="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)]">
									<div class="rounded-[1.75rem] border border-zinc-950/10 bg-white/85 p-5 shadow-sm">
										<div class="flex items-center justify-between gap-3">
											<div>
												<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Session</p>
												<p class="mt-2 text-lg font-semibold text-zinc-950">Current board details.</p>
											</div>
											<Badge variant="outline" class="border-emerald-200 bg-emerald-50 text-emerald-700">Synced</Badge>
										</div>
										<div class="mt-4 grid gap-3 sm:grid-cols-2">
											<div class="rounded-[1.25rem] border border-zinc-950/8 bg-zinc-50/90 p-4">
												<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Role</p>
												<p class="mt-2 text-sm leading-6 text-zinc-600 capitalize">{appSessionState.role}</p>
											</div>
											<div class="rounded-[1.25rem] border border-zinc-950/8 bg-zinc-50/90 p-4">
												<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Session code</p>
												<p class="mt-2 font-mono text-lg font-semibold tracking-[0.28em] text-zinc-950">{currentJoinCode()}</p>
											</div>
										</div>
									</div>

									<div class="space-y-3 rounded-[1.75rem] border border-zinc-950/10 bg-white/85 p-5 shadow-sm">
										<div class="flex items-center gap-2">
											<CheckIcon class="size-4 text-emerald-600" />
											<p class="text-sm font-semibold text-zinc-900">Status</p>
										</div>
										<div class="flex flex-wrap gap-2">
											<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">{boardActivityMessage}</Badge>
											<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">{appConnectionState.statusLabel}</Badge>
											<Badge variant="outline" class={appConnectionState.isReconnecting ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}>{appConnectionState.isReconnecting ? 'Reconnect pending' : 'Sync healthy'}</Badge>
										</div>
										<div class="rounded-[1.5rem] border border-zinc-950/8 bg-zinc-50/80 p-4">
											<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Board summary</p>
											<div class="mt-3 space-y-2 text-sm text-zinc-600">
												<p>Active tool: <span class="font-medium text-zinc-900">{activeTool}</span></p>
												<p>Brush size: <span class="font-medium text-zinc-900">{brushSize}px</span></p>
												<p>Color: <span class="font-medium text-zinc-900">{selectedColor}</span></p>
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>

					<aside class="hidden flex-col rounded-[1.75rem] border border-white/70 bg-white/80 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.05)] backdrop-blur xl:flex">
						<div class="flex items-start justify-between gap-3">
							<div>
								<p class="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Participants</p>
								<h3 class="mt-1 text-lg font-semibold text-zinc-950">Session members</h3>
							</div>
							<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">{getParticipants().length} / 4</Badge>
						</div>

						<div class="mt-4 space-y-3">
							{#each getParticipants() as participant}
								<div class="rounded-[1.5rem] border border-zinc-950/8 bg-white p-4 shadow-sm">
									<div class="flex items-start justify-between gap-3">
										<div class="flex items-center gap-3">
											<span class="size-3.5 rounded-full ring-4 ring-white" style={`background-color: ${participant.color};`}></span>
											<div>
												<p class="font-semibold text-zinc-950">{participant.nickname}</p>
												<p class="text-sm text-zinc-600">{participant.role === 'owner' ? 'Board owner' : 'Guest collaborator'}</p>
											</div>
										</div>
										<Badge class={participant.role === 'owner' ? 'bg-amber-500 text-amber-950' : 'bg-sky-500 text-sky-950'}>{participant.role}</Badge>
									</div>
									<div class="mt-4 flex items-center justify-between gap-2">
										<p class="text-xs uppercase tracking-[0.24em] text-zinc-500">Color {participant.color}</p>
										{#if appSessionState.role === 'owner' && participant.role !== 'owner'}
											<Button variant="outline" class="bg-white text-rose-700 hover:border-rose-200 hover:bg-rose-50" onclick={() => kickParticipant(participant.actor_id)}>Kick</Button>
										{:else}
											<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">{participant.actor_id === appSessionState.actorId ? 'You' : 'Active'}</Badge>
										{/if}
									</div>
								</div>
							{/each}
						</div>

					</aside>
				</div>
			</section>

			<Dialog bind:open={shareDialogOpen}>
				<DialogContent class="sm:max-w-3xl">
					<DialogHeader>
						<div class="flex items-center gap-2"><Share2Icon class="size-4 text-amber-600" /><DialogTitle>Share board</DialogTitle></div>
						<DialogDescription>Current session access.</DialogDescription>
					</DialogHeader>
					<div class="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]">
						<div class="rounded-[1.5rem] border border-zinc-950/8 bg-zinc-50/80 p-5">
							<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Join code</p>
							<p class="mt-2 font-mono text-3xl font-semibold tracking-[0.35em] text-zinc-950">{currentJoinCode()}</p>
							<div class="mt-5 flex flex-wrap gap-2">
								<Button variant="outline" class="bg-white" onclick={copyJoinCode} disabled={isJoinCodeRevoked}><CopyIcon class="size-4" />Copy code</Button>
								<Button variant="outline" class="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" onclick={revokeJoinCode} disabled={appSessionState.role !== 'owner' || isJoinCodeRevoked}><Link2Icon class="size-4" />Revoke</Button>
								<Button class="bg-zinc-950 text-white hover:bg-zinc-800" onclick={regenerateJoinCode} disabled={appSessionState.role !== 'owner'}><RefreshCwIcon class="size-4" />Regenerate</Button>
							</div>
						</div>
						<div class="rounded-[1.5rem] border border-zinc-950/8 bg-white p-5">
							<p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Session snapshot</p>
							<div class="mt-4 space-y-3">
								<div class="flex items-center justify-between gap-3"><span class="text-sm text-zinc-500">Role</span><span class="text-sm font-semibold text-zinc-950">{appSessionState.role}</span></div>
								<div class="flex items-center justify-between gap-3"><span class="text-sm text-zinc-500">Connection</span><span class="text-sm font-semibold text-zinc-950">{appConnectionState.statusLabel}</span></div>
								<div class="flex items-center justify-between gap-3"><span class="text-sm text-zinc-500">Brush</span><span class="text-sm font-semibold text-zinc-950">{brushSize}px</span></div>
								<div class="flex items-center justify-between gap-3"><span class="text-sm text-zinc-500">Color</span><span class="text-sm font-semibold text-zinc-950">{selectedColor}</span></div>
							</div>
							<div class="mt-5 rounded-3xl border border-zinc-950/8 bg-zinc-50/80 p-4">
								<div class="flex items-center gap-2"><CheckIcon class="size-4 text-emerald-600" /><p class="text-sm font-semibold text-zinc-900">Share state</p></div>
								<p class="mt-2 text-sm leading-6 text-zinc-600">{boardActivityMessage}</p>
							</div>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" class="bg-white" onclick={() => (shareDialogOpen = false)}>Close</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Drawer bind:open={mobileControlsOpen}>
				<DrawerContent class="max-h-[88vh]">
					<DrawerHeader class="px-4 pt-4">
						<div class="flex items-center gap-2"><MonitorSmartphoneIcon class="size-4 text-amber-600" /><DrawerTitle>Board controls</DrawerTitle></div>
						<DrawerDescription>Tools and canvas actions.</DrawerDescription>
					</DrawerHeader>
					<div class="space-y-5 px-4 pb-6">
						<div class="grid grid-cols-2 gap-2">
							{#each tools as tool}
								<Button
									variant="outline"
									class={activeTool === tool.id ? 'justify-start border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800' : 'justify-start border-zinc-950/10 bg-white text-zinc-700'}
									aria-pressed={activeTool === tool.id}
									onclick={() => selectTool(tool.id)}
								>
									<tool.icon class="size-4" />
									<span class="flex-1 text-left">{tool.label}</span>
								</Button>
							{/each}
						</div>

						<div class="rounded-[1.5rem] border border-zinc-950/8 bg-zinc-50/80 p-4">
							<div class="flex items-center gap-2">
								<PaletteIcon class="size-4 text-amber-600" />
								<p class="text-sm font-semibold text-zinc-900">Color</p>
							</div>
							<div class="mt-3 flex flex-wrap gap-2">
								{#each paletteOptions as option}
									<button
										type="button"
										class={`size-10 rounded-full border-2 transition ${
											selectedColor === option.value ? 'border-zinc-950 ring-2 ring-zinc-950/10' : 'border-white'
										}`}
										style={`background-color: ${option.value};`}
										aria-label={`Select ${option.label}`}
										aria-pressed={selectedColor === option.value}
										onclick={() => selectColor(option.value)}
									></button>
								{/each}
							</div>
						</div>

						<div class="rounded-[1.5rem] border border-zinc-950/8 bg-white p-4">
							<div class="flex items-center gap-2">
								<BrushIcon class="size-4 text-amber-600" />
								<p class="text-sm font-semibold text-zinc-900">Brush</p>
							</div>
							<div class="mt-3 grid grid-cols-3 gap-2">
								{#each brushPresets as size}
									<Button variant="outline" class={brushSize === size ? 'border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800' : 'border-zinc-950/10 bg-white text-zinc-700'} onclick={() => selectBrush(size)}>
										{size}px
									</Button>
								{/each}
							</div>
						</div>

						<div class="grid gap-2">
							<Button variant="outline" class="justify-start bg-white" onclick={handleImport}><UploadIcon class="size-4" />Import JSON</Button>
							<Button variant="outline" class="justify-start bg-white" onclick={handleExport}><DownloadIcon class="size-4" />Export PNG</Button>
						</div>
					</div>
				</DrawerContent>
			</Drawer>

			<Sheet bind:open={mobilePeopleOpen}>
				<SheetContent side="right" class="w-full sm:max-w-md">
					<SheetHeader class="px-1 pt-4">
						<div class="flex items-center gap-2"><UsersIcon class="size-4 text-amber-600" /><SheetTitle>Participants</SheetTitle></div>
						<SheetDescription>Active people in this session.</SheetDescription>
					</SheetHeader>
					<div class="px-1 pb-6">
						<div class="mt-4 space-y-3">
							{#each getParticipants() as participant}
								<div class="rounded-[1.5rem] border border-zinc-950/8 bg-white p-4 shadow-sm">
									<div class="flex items-start justify-between gap-3">
										<div class="flex items-center gap-3">
											<span class="size-3.5 rounded-full ring-4 ring-white" style={`background-color: ${participant.color};`}></span>
											<div>
												<p class="font-semibold text-zinc-950">{participant.nickname}</p>
												<p class="text-sm text-zinc-600">{participant.role === 'owner' ? 'Board owner' : 'Guest collaborator'}</p>
											</div>
										</div>
										<Badge class={participant.role === 'owner' ? 'bg-amber-500 text-amber-950' : 'bg-sky-500 text-sky-950'}>{participant.role}</Badge>
									</div>
									<div class="mt-4 flex items-center justify-between gap-2">
										<p class="text-xs uppercase tracking-[0.24em] text-zinc-500">Color {participant.color}</p>
										{#if appSessionState.role === 'owner' && participant.role !== 'owner'}
											<Button variant="outline" class="bg-white text-rose-700 hover:border-rose-200 hover:bg-rose-50" onclick={() => kickParticipant(participant.actor_id)}>Kick</Button>
										{:else}
											<Badge variant="outline" class="border-zinc-950/10 bg-white text-zinc-700">{participant.actor_id === appSessionState.actorId ? 'You' : 'Active'}</Badge>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				</SheetContent>
			</Sheet>
		{/if}
	</div>
</div>
