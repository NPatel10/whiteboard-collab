import type { LocalBoardSnapshot } from './board-store.svelte.js';
import type {
	BoardState,
	ShapeKind,
	StrokeElement,
	StrokePoint,
	TextElement
} from './types.js';

export interface BoardJsonExportOptions {
	pretty?: boolean;
}

export interface BoardPngExportOptions {
	backgroundColor?: string;
	isBrowser?: boolean;
	minimumHeight?: number;
	minimumWidth?: number;
	padding?: number;
	pixelRatio?: number;
	renderer?: BoardPngRenderer;
}

export interface BoardPngRenderRequest {
	scene: BoardExportScene;
	pixelRatio: number;
}

export interface BoardPngRenderer {
	render(request: BoardPngRenderRequest): Promise<string> | string;
}

export interface BoardExportScene {
	backgroundColor: string;
	height: number;
	offsetX: number;
	offsetY: number;
	width: number;
	elements: BoardExportSceneElement[];
}

export type BoardExportSceneElement =
	| BoardExportStrokeSceneElement
	| BoardExportShapeSceneElement
	| BoardExportTextSceneElement
	| BoardExportStickySceneElement;

export interface BoardExportStrokeSceneElement {
	kind: 'stroke';
	points: number[];
	stroke: string;
	strokeWidth: number;
}

export interface BoardExportShapeSceneElement {
	kind: 'shape';
	shape: ShapeKind;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	stroke: string;
	fill: string;
	strokeWidth: number;
}

export interface BoardExportTextSceneElement {
	kind: 'text';
	x: number;
	y: number;
	width: number;
	height: number;
	text: string;
	fontSize: number;
	color: string;
	align: TextElement['align'];
}

export interface BoardExportStickySceneElement {
	kind: 'sticky';
	x: number;
	y: number;
	width: number;
	height: number;
	text: string;
	background: string;
	color: string;
}

export class BoardExportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BoardExportError';
	}
}

interface KonvaStageLike {
	add(node: unknown): void;
	toDataURL(config?: { mimeType?: string; pixelRatio?: number; quality?: number }): string;
	destroy(): void;
}

interface KonvaLayerLike {
	add(node: unknown): void;
	draw(): void;
}

interface KonvaGroupLike {
	add(node: unknown): void;
}

interface KonvaModuleLike {
	Stage: new (config: { container: HTMLElement; width: number; height: number }) => KonvaStageLike;
	Layer: new () => KonvaLayerLike;
	Rect: new (config: Record<string, unknown>) => unknown;
	Group: new (config?: Record<string, unknown>) => KonvaGroupLike;
	Line: new (config: Record<string, unknown>) => unknown;
	Text: new (config: Record<string, unknown>) => unknown;
	Ellipse: new (config: Record<string, unknown>) => unknown;
	Arrow: new (config: Record<string, unknown>) => unknown;
}

const defaultBackgroundColor = '#ffffff';
const defaultPixelRatio = 2;
const defaultMinimumWidth = 1024;
const defaultMinimumHeight = 768;
const defaultPadding = 48;

export function exportBoardStateToJson(
	boardState: BoardState,
	options: BoardJsonExportOptions = {}
) {
	return serializeJson(boardState, options.pretty ?? true);
}

export function exportBoardSnapshotToJson(
	snapshot: LocalBoardSnapshot,
	options: BoardJsonExportOptions = {}
) {
	return serializeJson(snapshot, options.pretty ?? true);
}

export function buildBoardExportScene(
	boardState: BoardState,
	options: BoardPngExportOptions = {}
): BoardExportScene {
	const backgroundColor = options.backgroundColor ?? defaultBackgroundColor;
	const padding = Math.max(0, options.padding ?? defaultPadding);
	const minimumWidth = Math.max(1, options.minimumWidth ?? defaultMinimumWidth);
	const minimumHeight = Math.max(1, options.minimumHeight ?? defaultMinimumHeight);

	const exportElements = boardState.elements.flatMap((element) => toSceneElements(element));
	const bounds = calculateSceneBounds(exportElements);

	if (bounds === null) {
		return {
			backgroundColor,
			width: minimumWidth,
			height: minimumHeight,
			offsetX: padding,
			offsetY: padding,
			elements: exportElements
		};
	}

	const width = Math.max(minimumWidth, Math.ceil(bounds.maxX - bounds.minX + padding * 2));
	const height = Math.max(minimumHeight, Math.ceil(bounds.maxY - bounds.minY + padding * 2));

	return {
		backgroundColor,
		width,
		height,
		offsetX: padding - bounds.minX,
		offsetY: padding - bounds.minY,
		elements: exportElements
	};
}

export async function exportBoardStateToPng(
	boardState: BoardState,
	options: BoardPngExportOptions = {}
) {
	const renderer = options.renderer ?? createKonvaBoardPngRenderer();
	const canUseBrowser = options.isBrowser ?? (typeof window !== 'undefined' && typeof document !== 'undefined');
	if (options.renderer === undefined && !canUseBrowser) {
		throw new BoardExportError('PNG export requires a browser context');
	}

	const scene = buildBoardExportScene(boardState, options);

	return renderer.render({
		scene,
		pixelRatio: options.pixelRatio ?? defaultPixelRatio
	});
}

export async function exportBoardSnapshotToPng(
	snapshot: LocalBoardSnapshot,
	options: BoardPngExportOptions = {}
) {
	return exportBoardStateToPng(snapshot.boardState, options);
}

function serializeJson(value: unknown, pretty: boolean) {
	return JSON.stringify(value, null, pretty ? 2 : 0);
}

function toSceneElements(element: BoardState['elements'][number]): BoardExportSceneElement[] {
	switch (element.kind) {
		case 'stroke':
			return [toStrokeSceneElement(element)];
		case 'shape':
			return [toShapeSceneElement(element)];
		case 'text':
			return [toTextSceneElement(element)];
		case 'sticky':
			return [toStickySceneElement(element)];
		default:
			return [];
	}
}

function toStrokeSceneElement(element: StrokeElement): BoardExportStrokeSceneElement {
	return {
		kind: 'stroke',
		points: flattenPoints(element.points),
		stroke: element.stroke,
		strokeWidth: element.stroke_width
	};
}

function toShapeSceneElement(element: Extract<BoardState['elements'][number], { kind: 'shape' }>): BoardExportShapeSceneElement {
	return {
		kind: 'shape',
		shape: element.shape,
		x: element.x,
		y: element.y,
		width: element.width,
		height: element.height,
		rotation: element.rotation,
		stroke: element.stroke,
		fill: element.fill,
		strokeWidth: element.stroke_width
	};
}

function toTextSceneElement(element: Extract<BoardState['elements'][number], { kind: 'text' }>): BoardExportTextSceneElement {
	return {
		kind: 'text',
		x: element.x,
		y: element.y,
		width: element.width,
		height: element.height,
		text: element.text,
		fontSize: element.font_size,
		color: element.color,
		align: element.align
	};
}

function toStickySceneElement(
	element: Extract<BoardState['elements'][number], { kind: 'sticky' }>
): BoardExportStickySceneElement {
	return {
		kind: 'sticky',
		x: element.x,
		y: element.y,
		width: element.width,
		height: element.height,
		text: element.text,
		background: element.background,
		color: element.color
	};
}

function flattenPoints(points: StrokePoint[]) {
	return points.flatMap((point) => [point.x, point.y]);
}

function calculateSceneBounds(elements: BoardExportSceneElement[]) {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const element of elements) {
		const bounds = getSceneElementBounds(element);
		if (bounds === null) {
			continue;
		}

		minX = Math.min(minX, bounds.minX);
		minY = Math.min(minY, bounds.minY);
		maxX = Math.max(maxX, bounds.maxX);
		maxY = Math.max(maxY, bounds.maxY);
	}

	if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
		return null;
	}

	return {
		minX,
		minY,
		maxX,
		maxY
	};
}

function getSceneElementBounds(element: BoardExportSceneElement) {
	switch (element.kind) {
		case 'stroke':
			return getStrokeBounds(element);
		case 'shape':
			return getRotatedRectBounds(element.x, element.y, element.width, element.height, element.rotation);
		case 'text':
		case 'sticky':
			return getRectBounds(element.x, element.y, element.width, element.height);
		default:
			return null;
	}
}

function getStrokeBounds(element: BoardExportStrokeSceneElement) {
	if (element.points.length === 0) {
		return null;
	}

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (let index = 0; index < element.points.length; index += 2) {
		const x = element.points[index];
		const y = element.points[index + 1];
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}

	const strokePadding = Math.max(1, element.strokeWidth / 2);
	return {
		minX: minX - strokePadding,
		minY: minY - strokePadding,
		maxX: maxX + strokePadding,
		maxY: maxY + strokePadding
	};
}

function getRectBounds(x: number, y: number, width: number, height: number) {
	const left = Math.min(x, x + width);
	const top = Math.min(y, y + height);
	const right = Math.max(x, x + width);
	const bottom = Math.max(y, y + height);

	return {
		minX: left,
		minY: top,
		maxX: right,
		maxY: bottom
	};
}

function getRotatedRectBounds(x: number, y: number, width: number, height: number, rotation: number) {
	if (!Number.isFinite(rotation) || rotation === 0) {
		return getRectBounds(x, y, width, height);
	}

	const left = Math.min(x, x + width);
	const top = Math.min(y, y + height);
	const right = Math.max(x, x + width);
	const bottom = Math.max(y, y + height);
	const centerX = left + (right - left) / 2;
	const centerY = top + (bottom - top) / 2;
	const radians = (rotation * Math.PI) / 180;
	const corners = [
		{ x: left, y: top },
		{ x: right, y: top },
		{ x: right, y: bottom },
		{ x: left, y: bottom }
	].map((point) => rotatePoint(point.x, point.y, centerX, centerY, radians));

	return {
		minX: Math.min(...corners.map((point) => point.x)),
		minY: Math.min(...corners.map((point) => point.y)),
		maxX: Math.max(...corners.map((point) => point.x)),
		maxY: Math.max(...corners.map((point) => point.y))
	};
}

function rotatePoint(x: number, y: number, centerX: number, centerY: number, radians: number) {
	const relativeX = x - centerX;
	const relativeY = y - centerY;
	const sin = Math.sin(radians);
	const cos = Math.cos(radians);

	return {
		x: centerX + relativeX * cos - relativeY * sin,
		y: centerY + relativeX * sin + relativeY * cos
	};
}

function createKonvaBoardPngRenderer(): BoardPngRenderer {
	return {
		async render(request: BoardPngRenderRequest) {
			const konvaModule = await import('konva');
			const Konva = ((konvaModule as unknown as { default?: KonvaModuleLike }).default ?? konvaModule) as KonvaModuleLike;
			const container = createHiddenContainer();
			let stage: KonvaStageLike | undefined;

			try {
				stage = new Konva.Stage({
					container,
					width: request.scene.width,
					height: request.scene.height
				});

				const layer = new Konva.Layer();
				stage.add(layer);

				layer.add(
					new Konva.Rect({
						x: 0,
						y: 0,
						width: request.scene.width,
						height: request.scene.height,
						fill: request.scene.backgroundColor,
						listening: false
					})
				);

				const contentGroup = new Konva.Group({
					x: request.scene.offsetX,
					y: request.scene.offsetY
				});

				for (const element of request.scene.elements) {
					contentGroup.add(createKonvaNodeForSceneElement(Konva, element));
				}

				layer.add(contentGroup);
				layer.draw();

				return stage.toDataURL({
					mimeType: 'image/png',
					pixelRatio: request.pixelRatio
				});
			} finally {
				stage?.destroy();
				container.remove();
			}
		}
	};
}

function createKonvaNodeForSceneElement(Konva: KonvaModuleLike, element: BoardExportSceneElement) {
	switch (element.kind) {
		case 'stroke':
			return new Konva.Line({
				points: element.points,
				stroke: element.stroke,
				strokeWidth: element.strokeWidth,
				lineCap: 'round',
				lineJoin: 'round',
				tension: 0,
				perfectDrawEnabled: false,
				listening: false
			});
		case 'shape':
			return createKonvaShapeNode(Konva, element);
		case 'text':
			return new Konva.Text({
				x: element.x,
				y: element.y,
				width: element.width,
				height: element.height,
				text: element.text,
				fontSize: element.fontSize,
				fill: element.color,
				align: element.align,
				verticalAlign: 'middle',
				padding: 0,
				listening: false
			});
		case 'sticky':
			return createKonvaStickyNode(Konva, element);
		default:
			return new Konva.Group();
	}
}

function createKonvaShapeNode(Konva: KonvaModuleLike, element: BoardExportShapeSceneElement) {
	const normalizedRect = normalizeRectForRendering(element.x, element.y, element.width, element.height);
	switch (element.shape) {
		case 'rectangle':
			return new Konva.Rect({
				...normalizedRect,
				rotation: element.rotation,
				stroke: element.stroke,
				fill: element.fill,
				strokeWidth: element.strokeWidth,
				listening: false
			});
		case 'ellipse':
			return new Konva.Ellipse({
				x: normalizedRect.x + normalizedRect.width / 2,
				y: normalizedRect.y + normalizedRect.height / 2,
				radiusX: normalizedRect.width / 2,
				radiusY: normalizedRect.height / 2,
				rotation: element.rotation,
				stroke: element.stroke,
				fill: element.fill,
				strokeWidth: element.strokeWidth,
				listening: false
			});
		case 'diamond':
			return new Konva.Line({
				points: createDiamondPoints(normalizedRect.x, normalizedRect.y, normalizedRect.width, normalizedRect.height),
				closed: true,
				rotation: element.rotation,
				stroke: element.stroke,
				fill: element.fill,
				strokeWidth: element.strokeWidth,
				lineJoin: 'round',
				listening: false
			});
		case 'line':
			return new Konva.Line({
				points: [normalizedRect.x, normalizedRect.y, normalizedRect.x + normalizedRect.width, normalizedRect.y + normalizedRect.height],
				rotation: element.rotation,
				stroke: element.stroke,
				strokeWidth: element.strokeWidth,
				lineCap: 'round',
				lineJoin: 'round',
				listening: false
			});
		case 'arrow':
			return new Konva.Arrow({
				points: [normalizedRect.x, normalizedRect.y, normalizedRect.x + normalizedRect.width, normalizedRect.y + normalizedRect.height],
				rotation: element.rotation,
				stroke: element.stroke,
				fill: element.stroke,
				strokeWidth: element.strokeWidth,
				pointerLength: Math.max(6, element.strokeWidth * 2),
				pointerWidth: Math.max(6, element.strokeWidth * 2),
				listening: false
			});
		default:
			return new Konva.Rect({
				...normalizedRect,
				rotation: element.rotation,
				stroke: element.stroke,
				fill: element.fill,
				strokeWidth: element.strokeWidth,
				listening: false
			});
	}
}

function createKonvaStickyNode(Konva: KonvaModuleLike, element: BoardExportStickySceneElement) {
	const normalizedRect = normalizeRectForRendering(element.x, element.y, element.width, element.height);
	const group = new Konva.Group({
		x: normalizedRect.x,
		y: normalizedRect.y,
		listening: false
	});

	group.add(
		new Konva.Rect({
			x: 0,
			y: 0,
			width: normalizedRect.width,
			height: normalizedRect.height,
			fill: element.background,
			cornerRadius: 16,
			listening: false
		})
	);
	group.add(
		new Konva.Text({
			x: 16,
			y: 16,
			width: Math.max(0, normalizedRect.width - 32),
			height: Math.max(0, normalizedRect.height - 32),
			text: element.text,
			fontSize: 22,
			fill: element.color,
			align: 'left',
			verticalAlign: 'top',
			wrap: 'word',
			listening: false
		})
	);

	return group;
}

function normalizeRectForRendering(x: number, y: number, width: number, height: number) {
	return {
		x: Math.min(x, x + width),
		y: Math.min(y, y + height),
		width: Math.abs(width),
		height: Math.abs(height)
	};
}

function createDiamondPoints(x: number, y: number, width: number, height: number) {
	return [
		x + width / 2,
		y,
		x + width,
		y + height / 2,
		x + width / 2,
		y + height,
		x,
		y + height / 2
	];
}

function createHiddenContainer() {
	const container = document.createElement('div');
	container.style.position = 'fixed';
	container.style.left = '-10000px';
	container.style.top = '-10000px';
	container.style.width = '0';
	container.style.height = '0';
	container.style.overflow = 'hidden';
	container.style.pointerEvents = 'none';
	document.body.appendChild(container);
	return container;
}
