export type ISODateTimeString = string;
export type BoardId = string;
export type ActorId = string;
export type DeviceId = string;
export type JoinCode = string;
export type RequestId = string;
export type ActionId = string;
export type ObjectId = string;

export type ParticipantRole = 'owner' | 'guest';
export type JoinRejectedReason =
	| 'invalid_code'
	| 'board_full'
	| 'rate_limited'
	| 'board_unavailable';
export type ParticipantLeftReason = 'disconnect' | 'kick' | 'code_revoked';
export type BoardCodeRevokedReason = 'revoked_by_owner';
export type PresenceState = 'active' | 'idle';
export type WhiteboardTool =
	| 'select'
	| 'pen'
	| 'eraser'
	| 'shapes'
	| 'text'
	| 'sticky'
	| 'pan';
export type ShapeKind = 'rectangle' | 'ellipse' | 'diamond' | 'line' | 'arrow';

export type BoardActionKind =
	| 'stroke.begin'
	| 'stroke.append'
	| 'stroke.end'
	| 'eraser.apply'
	| 'shape.create'
	| 'shape.update'
	| 'shape.delete'
	| 'text.create'
	| 'text.update'
	| 'text.delete'
	| 'sticky.create'
	| 'sticky.update'
	| 'sticky.delete'
	| 'selection.update'
	| 'transform.update'
	| 'viewport.update'
	| 'undo.apply'
	| 'redo.apply';

export type SocketMessageType =
	| 'session.create'
	| 'session.created'
	| 'session.join'
	| 'session.joined'
	| 'session.join_rejected'
	| 'board.snapshot.request'
	| 'board.snapshot'
	| 'board.snapshot.ack'
	| 'board.action'
	| 'presence.update'
	| 'participant.joined'
	| 'participant.left'
	| 'participant.kick'
	| 'board.code.revoke'
	| 'board.code.revoked'
	| 'heartbeat.ping'
	| 'heartbeat.pong'
	| 'error';

export type ErrorCode =
	| 'invalid_message'
	| 'invalid_code'
	| 'board_full'
	| 'unauthorized'
	| 'rate_limited'
	| 'snapshot_timeout'
	| 'board_unavailable'
	| 'internal_error';

export interface Point {
	x: number;
	y: number;
}

export interface Viewport extends Point {
	zoom: number;
}

export interface ParticipantSummary {
	actor_id: ActorId;
	nickname: string;
	role: ParticipantRole;
	color: string;
}

interface BoardElementBase {
	id: ObjectId;
	kind: 'stroke' | 'shape' | 'text' | 'sticky';
	created_by: ActorId;
	created_at: ISODateTimeString;
	updated_at: ISODateTimeString;
}

export interface StrokePoint extends Point {
	pressure?: number;
}

export interface StrokeElement extends BoardElementBase {
	kind: 'stroke';
	stroke: string;
	stroke_width: number;
	points: StrokePoint[];
}

export interface ShapeElement extends BoardElementBase {
	kind: 'shape';
	shape: ShapeKind;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	stroke: string;
	fill: string;
	stroke_width: number;
}

export interface TextElement extends BoardElementBase {
	kind: 'text';
	x: number;
	y: number;
	width: number;
	height: number;
	text: string;
	font_size: number;
	color: string;
	align: 'left' | 'center' | 'right';
}

export interface StickyNoteElement extends BoardElementBase {
	kind: 'sticky';
	x: number;
	y: number;
	width: number;
	height: number;
	text: string;
	background: string;
	color: string;
}

export type BoardElement = StrokeElement | ShapeElement | TextElement | StickyNoteElement;

export interface BoardState {
	elements: BoardElement[];
	viewport: Viewport;
}

export interface StrokeBeginActionData {
	object_id: ObjectId;
	stroke: string;
	stroke_width: number;
	point: StrokePoint;
}

export interface StrokeAppendActionData {
	object_id: ObjectId;
	points: StrokePoint[];
}

export interface StrokeEndActionData {
	object_id: ObjectId;
}

export interface EraserApplyActionData {
	object_ids: ObjectId[];
}

export interface ShapeCreateActionData {
	shape: ShapeKind;
	x: number;
	y: number;
	width: number;
	height: number;
	stroke: string;
	fill: string;
	stroke_width?: number;
}

export interface ShapeUpdateActionData {
	object_id: ObjectId;
	patch: Partial<
		Pick<ShapeElement, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'stroke' | 'fill' | 'stroke_width'>
	>;
}

export interface ShapeDeleteActionData {
	object_id: ObjectId;
}

export interface TextCreateActionData {
	x: number;
	y: number;
	width: number;
	height: number;
	text: string;
	font_size: number;
	color: string;
	align: TextElement['align'];
}

export interface TextUpdateActionData {
	object_id: ObjectId;
	patch: Partial<Pick<TextElement, 'x' | 'y' | 'width' | 'height' | 'text' | 'font_size' | 'color' | 'align'>>;
}

export interface TextDeleteActionData {
	object_id: ObjectId;
}

export interface StickyCreateActionData {
	x: number;
	y: number;
	width: number;
	height: number;
	text: string;
	background: string;
	color: string;
}

export interface StickyUpdateActionData {
	object_id: ObjectId;
	patch: Partial<
		Pick<StickyNoteElement, 'x' | 'y' | 'width' | 'height' | 'text' | 'background' | 'color'>
	>;
}

export interface StickyDeleteActionData {
	object_id: ObjectId;
}

export interface SelectionUpdateActionData {
	object_ids: ObjectId[];
}

export interface TransformUpdateActionData {
	object_id: ObjectId;
	x: number;
	y: number;
	width?: number;
	height?: number;
	rotation?: number;
}

export interface ViewportUpdateActionData {
	viewport: Viewport;
}

export interface UndoApplyActionData {
	count?: number;
}

export interface RedoApplyActionData {
	count?: number;
}

export interface BoardActionDataMap {
	'stroke.begin': StrokeBeginActionData;
	'stroke.append': StrokeAppendActionData;
	'stroke.end': StrokeEndActionData;
	'eraser.apply': EraserApplyActionData;
	'shape.create': ShapeCreateActionData;
	'shape.update': ShapeUpdateActionData;
	'shape.delete': ShapeDeleteActionData;
	'text.create': TextCreateActionData;
	'text.update': TextUpdateActionData;
	'text.delete': TextDeleteActionData;
	'sticky.create': StickyCreateActionData;
	'sticky.update': StickyUpdateActionData;
	'sticky.delete': StickyDeleteActionData;
	'selection.update': SelectionUpdateActionData;
	'transform.update': TransformUpdateActionData;
	'viewport.update': ViewportUpdateActionData;
	'undo.apply': UndoApplyActionData;
	'redo.apply': RedoApplyActionData;
}

export type BoardActionData = BoardActionDataMap[BoardActionKind];

export interface BoardActionPayload<TKind extends BoardActionKind = BoardActionKind> {
	action_id: ActionId;
	client_sequence: number;
	action_kind: TKind;
	object_id?: ObjectId;
	object_version?: number;
	data: BoardActionDataMap[TKind];
}

export interface PresenceUpdatePayload {
	cursor?: Point;
	tool: WhiteboardTool;
	state: PresenceState;
}

export interface SessionCreatePayload {
	nickname: string;
	device_id: DeviceId;
}

export interface SessionCreatedPayload {
	join_code: JoinCode;
	role: 'owner';
	max_participants: number;
	expires_in_seconds: number;
}

export interface SessionJoinPayload {
	join_code: JoinCode;
	nickname: string;
	device_id: DeviceId;
}

export interface SessionJoinedPayload {
	role: 'guest';
	owner_actor_id: ActorId;
	participants: ParticipantSummary[];
}

export interface SessionJoinRejectedPayload {
	reason: JoinRejectedReason;
}

export interface BoardSnapshotRequestPayload {
	target_actor_id: ActorId;
}

export interface BoardSnapshotPayload {
	target_actor_id: ActorId;
	snapshot_version: number;
	board_state: BoardState;
	action_cursor: number;
}

export interface BoardSnapshotAckPayload {
	snapshot_version: number;
}

export interface ParticipantJoinedPayload extends ParticipantSummary {}

export interface ParticipantLeftPayload {
	actor_id: ActorId;
	reason: ParticipantLeftReason;
}

export interface ParticipantKickPayload {
	target_actor_id: ActorId;
}

export interface BoardCodeRevokePayload {}

export interface BoardCodeRevokedPayload {
	reason: BoardCodeRevokedReason;
}

export interface HeartbeatPingPayload {}

export interface HeartbeatPongPayload {}

export interface ErrorPayload {
	code: ErrorCode;
	message: string;
}

export interface SocketEnvelope<TType extends SocketMessageType, TPayload> {
	type: TType;
	request_id?: RequestId;
	board_id?: BoardId;
	actor_id?: ActorId;
	sent_at?: ISODateTimeString;
	payload: TPayload;
}

export type SessionCreateMessage = SocketEnvelope<'session.create', SessionCreatePayload>;
export type SessionCreatedMessage = SocketEnvelope<'session.created', SessionCreatedPayload>;
export type SessionJoinMessage = SocketEnvelope<'session.join', SessionJoinPayload>;
export type SessionJoinedMessage = SocketEnvelope<'session.joined', SessionJoinedPayload>;
export type SessionJoinRejectedMessage = SocketEnvelope<
	'session.join_rejected',
	SessionJoinRejectedPayload
>;
export type BoardSnapshotRequestMessage = SocketEnvelope<
	'board.snapshot.request',
	BoardSnapshotRequestPayload
>;
export type BoardSnapshotMessage = SocketEnvelope<'board.snapshot', BoardSnapshotPayload>;
export type BoardSnapshotAckMessage = SocketEnvelope<'board.snapshot.ack', BoardSnapshotAckPayload>;
export type BoardActionMessage<TKind extends BoardActionKind = BoardActionKind> = SocketEnvelope<
	'board.action',
	BoardActionPayload<TKind>
>;
export type PresenceUpdateMessage = SocketEnvelope<'presence.update', PresenceUpdatePayload>;
export type ParticipantJoinedMessage = SocketEnvelope<'participant.joined', ParticipantJoinedPayload>;
export type ParticipantLeftMessage = SocketEnvelope<'participant.left', ParticipantLeftPayload>;
export type ParticipantKickMessage = SocketEnvelope<'participant.kick', ParticipantKickPayload>;
export type BoardCodeRevokeMessage = SocketEnvelope<'board.code.revoke', BoardCodeRevokePayload>;
export type BoardCodeRevokedMessage = SocketEnvelope<'board.code.revoked', BoardCodeRevokedPayload>;
export type HeartbeatPingMessage = SocketEnvelope<'heartbeat.ping', HeartbeatPingPayload>;
export type HeartbeatPongMessage = SocketEnvelope<'heartbeat.pong', HeartbeatPongPayload>;
export type ErrorMessage = SocketEnvelope<'error', ErrorPayload>;

export type ClientSocketMessage =
	| SessionCreateMessage
	| SessionJoinMessage
	| BoardSnapshotMessage
	| BoardSnapshotAckMessage
	| BoardActionMessage
	| PresenceUpdateMessage
	| ParticipantKickMessage
	| BoardCodeRevokeMessage
	| HeartbeatPingMessage;

export type ServerSocketMessage =
	| SessionCreatedMessage
	| SessionJoinedMessage
	| SessionJoinRejectedMessage
	| BoardSnapshotRequestMessage
	| BoardSnapshotMessage
	| BoardActionMessage
	| PresenceUpdateMessage
	| ParticipantJoinedMessage
	| ParticipantLeftMessage
	| BoardCodeRevokedMessage
	| HeartbeatPongMessage
	| ErrorMessage;

export type SocketMessage = ClientSocketMessage | ServerSocketMessage;
