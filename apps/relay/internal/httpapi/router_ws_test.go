package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"whiteboard-relay/internal/config"

	"github.com/gorilla/websocket"
)

type wsMessage struct {
	Type      string          `json:"type"`
	RequestID string          `json:"request_id,omitempty"`
	BoardID   string          `json:"board_id,omitempty"`
	ActorID   string          `json:"actor_id,omitempty"`
	SentAt    string          `json:"sent_at,omitempty"`
	Payload   json.RawMessage `json:"payload"`
}

type wsSessionCreatedPayload struct {
	JoinCode         string `json:"join_code"`
	Role             string `json:"role"`
	MaxParticipants  int    `json:"max_participants"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
}

type wsParticipantSummary struct {
	ActorID  string `json:"actor_id"`
	Nickname string `json:"nickname"`
	Role     string `json:"role"`
	Color    string `json:"color"`
}

type wsSessionJoinedPayload struct {
	Role         string                 `json:"role"`
	OwnerActorID string                 `json:"owner_actor_id"`
	Participants []wsParticipantSummary `json:"participants"`
}

type wsSessionJoinRejectedPayload struct {
	Reason string `json:"reason"`
}

type wsBoardSnapshotRequestPayload struct {
	TargetActorID string `json:"target_actor_id"`
}

type wsBoardSnapshotPayload struct {
	TargetActorID   string          `json:"target_actor_id"`
	SnapshotVersion int             `json:"snapshot_version"`
	BoardState      json.RawMessage `json:"board_state"`
	ActionCursor    int             `json:"action_cursor"`
}

type wsBoardSnapshotAckPayload struct {
	SnapshotVersion int `json:"snapshot_version"`
}

type wsBoardActionPayload struct {
	ActionID       string          `json:"action_id"`
	ClientSequence int             `json:"client_sequence"`
	ActionKind     string          `json:"action_kind"`
	Data           json.RawMessage `json:"data"`
}

type wsPresenceCursorPayload struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type wsPresenceUpdatePayload struct {
	Cursor *wsPresenceCursorPayload `json:"cursor,omitempty"`
	Tool   string                   `json:"tool"`
	State  string                   `json:"state"`
}

type wsParticipantLeftPayload struct {
	ActorID string `json:"actor_id"`
	Reason  string `json:"reason"`
}

type wsErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func TestWebSocketSessionCreate(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	conn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer conn.Close()

	request := map[string]any{
		"type":       "session.create",
		"request_id": "req_create_1",
		"payload": map[string]string{
			"nickname":  "Nayan",
			"device_id": "device_owner_1",
		},
	}
	if err := conn.WriteJSON(request); err != nil {
		t.Fatalf("write session.create message: %v", err)
	}

	_, rawMessage, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read session.created message: %v", err)
	}

	var envelope wsMessage
	if err := json.Unmarshal(rawMessage, &envelope); err != nil {
		t.Fatalf("decode session.created envelope: %v", err)
	}

	if envelope.Type != "session.created" {
		t.Fatalf("response type = %q, want %q", envelope.Type, "session.created")
	}

	if envelope.RequestID != "req_create_1" {
		t.Fatalf("request id = %q, want %q", envelope.RequestID, "req_create_1")
	}

	if !strings.HasPrefix(envelope.BoardID, "board_") {
		t.Fatalf("board id = %q, want board_ prefix", envelope.BoardID)
	}

	if !strings.HasPrefix(envelope.ActorID, "actor_") {
		t.Fatalf("actor id = %q, want actor_ prefix", envelope.ActorID)
	}

	var payload wsSessionCreatedPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatalf("decode session.created payload: %v", err)
	}

	if len(payload.JoinCode) != 8 {
		t.Fatalf("join code length = %d, want %d", len(payload.JoinCode), 8)
	}

	for _, character := range payload.JoinCode {
		if !strings.ContainsRune("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", character) {
			t.Fatalf("join code = %q contains non-alphanumeric character %q", payload.JoinCode, character)
		}
	}

	if payload.Role != "owner" {
		t.Fatalf("role = %q, want %q", payload.Role, "owner")
	}

	if payload.MaxParticipants != 4 {
		t.Fatalf("max participants = %d, want %d", payload.MaxParticipants, 4)
	}

	if payload.ExpiresInSeconds != 24*60*60 {
		t.Fatalf("expires_in_seconds = %d, want %d", payload.ExpiresInSeconds, 24*60*60)
	}
}

func TestWebSocketSessionCreateRejectsInvalidPayload(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	conn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer conn.Close()

	request := map[string]any{
		"type":       "session.create",
		"request_id": "req_invalid_1",
		"payload": map[string]string{
			"nickname":  "   ",
			"device_id": "",
		},
	}
	if err := conn.WriteJSON(request); err != nil {
		t.Fatalf("write invalid session.create message: %v", err)
	}

	_, rawMessage, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read error message: %v", err)
	}

	var envelope wsMessage
	if err := json.Unmarshal(rawMessage, &envelope); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}

	if envelope.Type != "error" {
		t.Fatalf("response type = %q, want %q", envelope.Type, "error")
	}

	if envelope.RequestID != "req_invalid_1" {
		t.Fatalf("request id = %q, want %q", envelope.RequestID, "req_invalid_1")
	}

	var payload wsErrorPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}

	if payload.Code != "invalid_message" {
		t.Fatalf("error code = %q, want %q", payload.Code, "invalid_message")
	}
}

func TestWebSocketSessionJoin(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	ownerConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer ownerConn.Close()

	ownerRequest := map[string]any{
		"type":       "session.create",
		"request_id": "req_create_owner",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_1",
		},
	}
	if err := ownerConn.WriteJSON(ownerRequest); err != nil {
		t.Fatalf("write owner session.create message: %v", err)
	}

	_, ownerRawMessage, err := ownerConn.ReadMessage()
	if err != nil {
		t.Fatalf("read owner session.created message: %v", err)
	}

	var ownerEnvelope wsMessage
	if err := json.Unmarshal(ownerRawMessage, &ownerEnvelope); err != nil {
		t.Fatalf("decode owner session.created envelope: %v", err)
	}

	var ownerPayload wsSessionCreatedPayload
	if err := json.Unmarshal(ownerEnvelope.Payload, &ownerPayload); err != nil {
		t.Fatalf("decode owner session.created payload: %v", err)
	}

	guestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer guestConn.Close()

	joinRequest := map[string]any{
		"type":       "session.join",
		"request_id": "req_join_1",
		"payload": map[string]string{
			"join_code": ownerPayload.JoinCode,
			"nickname":  "Guest 1",
			"device_id": "device_guest_1",
		},
	}
	if err := guestConn.WriteJSON(joinRequest); err != nil {
		t.Fatalf("write session.join message: %v", err)
	}

	_, joinRawMessage, err := guestConn.ReadMessage()
	if err != nil {
		t.Fatalf("read session.joined message: %v", err)
	}

	var joinEnvelope wsMessage
	if err := json.Unmarshal(joinRawMessage, &joinEnvelope); err != nil {
		t.Fatalf("decode session.joined envelope: %v", err)
	}

	if joinEnvelope.Type != "session.joined" {
		t.Fatalf("response type = %q, want %q", joinEnvelope.Type, "session.joined")
	}

	if joinEnvelope.RequestID != "req_join_1" {
		t.Fatalf("request id = %q, want %q", joinEnvelope.RequestID, "req_join_1")
	}

	if joinEnvelope.BoardID != ownerEnvelope.BoardID {
		t.Fatalf("board id = %q, want %q", joinEnvelope.BoardID, ownerEnvelope.BoardID)
	}

	if !strings.HasPrefix(joinEnvelope.ActorID, "actor_") {
		t.Fatalf("actor id = %q, want actor_ prefix", joinEnvelope.ActorID)
	}

	var joinPayload wsSessionJoinedPayload
	if err := json.Unmarshal(joinEnvelope.Payload, &joinPayload); err != nil {
		t.Fatalf("decode session.joined payload: %v", err)
	}

	if joinPayload.Role != "guest" {
		t.Fatalf("role = %q, want %q", joinPayload.Role, "guest")
	}

	if joinPayload.OwnerActorID != ownerEnvelope.ActorID {
		t.Fatalf("owner actor id = %q, want %q", joinPayload.OwnerActorID, ownerEnvelope.ActorID)
	}

	if len(joinPayload.Participants) != 2 {
		t.Fatalf("participants len = %d, want %d", len(joinPayload.Participants), 2)
	}

	if joinPayload.Participants[0].Role != "owner" {
		t.Fatalf("first participant role = %q, want %q", joinPayload.Participants[0].Role, "owner")
	}

	if joinPayload.Participants[1].Role != "guest" {
		t.Fatalf("second participant role = %q, want %q", joinPayload.Participants[1].Role, "guest")
	}
}

func TestWebSocketParticipantJoinedNotifiesExistingParticipants(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	ownerConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer ownerConn.Close()

	ownerCreateRequest := map[string]any{
		"type":       "session.create",
		"request_id": "req_create_owner_for_participant_joined",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_1",
		},
	}
	if err := ownerConn.WriteJSON(ownerCreateRequest); err != nil {
		t.Fatalf("write owner session.create message: %v", err)
	}

	_, ownerCreatedRaw, err := ownerConn.ReadMessage()
	if err != nil {
		t.Fatalf("read owner session.created message: %v", err)
	}

	var ownerCreatedEnvelope wsMessage
	if err := json.Unmarshal(ownerCreatedRaw, &ownerCreatedEnvelope); err != nil {
		t.Fatalf("decode owner session.created envelope: %v", err)
	}

	var ownerCreatedPayload wsSessionCreatedPayload
	if err := json.Unmarshal(ownerCreatedEnvelope.Payload, &ownerCreatedPayload); err != nil {
		t.Fatalf("decode owner session.created payload: %v", err)
	}

	guestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer guestConn.Close()

	guestJoinRequest := map[string]any{
		"type":       "session.join",
		"request_id": "req_join_for_participant_joined",
		"payload": map[string]string{
			"join_code": ownerCreatedPayload.JoinCode,
			"nickname":  "Guest 1",
			"device_id": "device_guest_1",
		},
	}
	if err := guestConn.WriteJSON(guestJoinRequest); err != nil {
		t.Fatalf("write guest session.join message: %v", err)
	}

	_, guestJoinedRaw, err := guestConn.ReadMessage()
	if err != nil {
		t.Fatalf("read guest session.joined message: %v", err)
	}

	var guestJoinedEnvelope wsMessage
	if err := json.Unmarshal(guestJoinedRaw, &guestJoinedEnvelope); err != nil {
		t.Fatalf("decode guest session.joined envelope: %v", err)
	}

	if err := ownerConn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("set owner read deadline: %v", err)
	}

	_, ownerEventRaw, err := ownerConn.ReadMessage()
	if err != nil {
		t.Fatalf("read owner participant.joined message: %v", err)
	}

	if err := ownerConn.SetReadDeadline(time.Time{}); err != nil {
		t.Fatalf("clear owner read deadline: %v", err)
	}

	var ownerEventEnvelope wsMessage
	if err := json.Unmarshal(ownerEventRaw, &ownerEventEnvelope); err != nil {
		t.Fatalf("decode owner participant.joined envelope: %v", err)
	}

	if ownerEventEnvelope.Type != "participant.joined" {
		t.Fatalf("event type = %q, want %q", ownerEventEnvelope.Type, "participant.joined")
	}

	if ownerEventEnvelope.BoardID != ownerCreatedEnvelope.BoardID {
		t.Fatalf("event board id = %q, want %q", ownerEventEnvelope.BoardID, ownerCreatedEnvelope.BoardID)
	}

	if ownerEventEnvelope.ActorID != guestJoinedEnvelope.ActorID {
		t.Fatalf("event actor id = %q, want %q", ownerEventEnvelope.ActorID, guestJoinedEnvelope.ActorID)
	}

	var ownerEventPayload wsParticipantSummary
	if err := json.Unmarshal(ownerEventEnvelope.Payload, &ownerEventPayload); err != nil {
		t.Fatalf("decode owner participant.joined payload: %v", err)
	}

	if ownerEventPayload.ActorID != guestJoinedEnvelope.ActorID {
		t.Fatalf("payload actor id = %q, want %q", ownerEventPayload.ActorID, guestJoinedEnvelope.ActorID)
	}

	if ownerEventPayload.Nickname != "Guest 1" {
		t.Fatalf("payload nickname = %q, want %q", ownerEventPayload.Nickname, "Guest 1")
	}

	if ownerEventPayload.Role != "guest" {
		t.Fatalf("payload role = %q, want %q", ownerEventPayload.Role, "guest")
	}
}

func TestWebSocketSnapshotRequestIsSentToOwnerAfterGuestJoin(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	ownerConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer ownerConn.Close()

	if err := ownerConn.WriteJSON(map[string]any{
		"type":       "session.create",
		"request_id": "req_create_snapshot_owner",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_snapshot",
		},
	}); err != nil {
		t.Fatalf("write owner session.create: %v", err)
	}

	ownerCreatedEnvelope := readWebSocketMessageByType(t, ownerConn, "session.created", 2*time.Second)
	var ownerCreatedPayload wsSessionCreatedPayload
	if err := json.Unmarshal(ownerCreatedEnvelope.Payload, &ownerCreatedPayload); err != nil {
		t.Fatalf("decode owner session.created payload: %v", err)
	}

	guestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer guestConn.Close()

	const joinRequestID = "req_join_snapshot_request"
	if err := guestConn.WriteJSON(map[string]any{
		"type":       "session.join",
		"request_id": joinRequestID,
		"payload": map[string]string{
			"join_code": ownerCreatedPayload.JoinCode,
			"nickname":  "Guest Snapshot",
			"device_id": "device_guest_snapshot",
		},
	}); err != nil {
		t.Fatalf("write guest session.join: %v", err)
	}

	guestJoinedEnvelope := readWebSocketMessageByType(t, guestConn, "session.joined", 2*time.Second)
	snapshotRequestEnvelope := readWebSocketMessageByType(t, ownerConn, "board.snapshot.request", 2*time.Second)

	if snapshotRequestEnvelope.RequestID != joinRequestID {
		t.Fatalf("snapshot request request id = %q, want %q", snapshotRequestEnvelope.RequestID, joinRequestID)
	}

	if snapshotRequestEnvelope.BoardID != ownerCreatedEnvelope.BoardID {
		t.Fatalf("snapshot request board id = %q, want %q", snapshotRequestEnvelope.BoardID, ownerCreatedEnvelope.BoardID)
	}

	if snapshotRequestEnvelope.ActorID != guestJoinedEnvelope.ActorID {
		t.Fatalf("snapshot request actor id = %q, want %q", snapshotRequestEnvelope.ActorID, guestJoinedEnvelope.ActorID)
	}

	if snapshotRequestEnvelope.SentAt == "" {
		t.Fatal("snapshot request sent_at is empty, want non-empty")
	}

	var snapshotRequestPayload wsBoardSnapshotRequestPayload
	if err := json.Unmarshal(snapshotRequestEnvelope.Payload, &snapshotRequestPayload); err != nil {
		t.Fatalf("decode board.snapshot.request payload: %v", err)
	}

	if snapshotRequestPayload.TargetActorID != guestJoinedEnvelope.ActorID {
		t.Fatalf(
			"snapshot request target_actor_id = %q, want %q",
			snapshotRequestPayload.TargetActorID,
			guestJoinedEnvelope.ActorID,
		)
	}
}

func TestWebSocketBoardSnapshotRoutesFromOwnerToTargetGuest(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	ownerConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer ownerConn.Close()

	if err := ownerConn.WriteJSON(map[string]any{
		"type":       "session.create",
		"request_id": "req_create_snapshot_route",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_snapshot_route",
		},
	}); err != nil {
		t.Fatalf("write owner session.create: %v", err)
	}

	ownerCreatedEnvelope := readWebSocketMessageByType(t, ownerConn, "session.created", 2*time.Second)
	var ownerCreatedPayload wsSessionCreatedPayload
	if err := json.Unmarshal(ownerCreatedEnvelope.Payload, &ownerCreatedPayload); err != nil {
		t.Fatalf("decode owner session.created payload: %v", err)
	}

	guestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer guestConn.Close()

	if err := guestConn.WriteJSON(map[string]any{
		"type":       "session.join",
		"request_id": "req_join_snapshot_route",
		"payload": map[string]string{
			"join_code": ownerCreatedPayload.JoinCode,
			"nickname":  "Guest Route",
			"device_id": "device_guest_snapshot_route",
		},
	}); err != nil {
		t.Fatalf("write guest session.join: %v", err)
	}

	guestJoinedEnvelope := readWebSocketMessageByType(t, guestConn, "session.joined", 2*time.Second)

	const snapshotRequestID = "req_snapshot_route_1"
	if err := ownerConn.WriteJSON(map[string]any{
		"type":       "board.snapshot",
		"request_id": snapshotRequestID,
		"payload": map[string]any{
			"target_actor_id":  guestJoinedEnvelope.ActorID,
			"snapshot_version": 7,
			"board_state": map[string]any{
				"elements": []any{},
				"viewport": map[string]any{
					"x":    0,
					"y":    0,
					"zoom": 1,
				},
			},
			"action_cursor": 19,
		},
	}); err != nil {
		t.Fatalf("write board.snapshot: %v", err)
	}

	guestSnapshotEnvelope := readWebSocketMessageByType(t, guestConn, "board.snapshot", 2*time.Second)
	if guestSnapshotEnvelope.RequestID != snapshotRequestID {
		t.Fatalf("board.snapshot request id = %q, want %q", guestSnapshotEnvelope.RequestID, snapshotRequestID)
	}

	if guestSnapshotEnvelope.BoardID != ownerCreatedEnvelope.BoardID {
		t.Fatalf("board.snapshot board id = %q, want %q", guestSnapshotEnvelope.BoardID, ownerCreatedEnvelope.BoardID)
	}

	if guestSnapshotEnvelope.ActorID != ownerCreatedEnvelope.ActorID {
		t.Fatalf("board.snapshot actor id = %q, want %q", guestSnapshotEnvelope.ActorID, ownerCreatedEnvelope.ActorID)
	}

	if guestSnapshotEnvelope.SentAt == "" {
		t.Fatal("board.snapshot sent_at is empty, want non-empty")
	}

	var snapshotPayload wsBoardSnapshotPayload
	if err := json.Unmarshal(guestSnapshotEnvelope.Payload, &snapshotPayload); err != nil {
		t.Fatalf("decode board.snapshot payload: %v", err)
	}

	if snapshotPayload.TargetActorID != guestJoinedEnvelope.ActorID {
		t.Fatalf("target_actor_id = %q, want %q", snapshotPayload.TargetActorID, guestJoinedEnvelope.ActorID)
	}

	if snapshotPayload.SnapshotVersion != 7 {
		t.Fatalf("snapshot_version = %d, want %d", snapshotPayload.SnapshotVersion, 7)
	}

	if snapshotPayload.ActionCursor != 19 {
		t.Fatalf("action_cursor = %d, want %d", snapshotPayload.ActionCursor, 19)
	}

	var boardState map[string]any
	if err := json.Unmarshal(snapshotPayload.BoardState, &boardState); err != nil {
		t.Fatalf("decode board_state payload: %v", err)
	}

	if _, exists := boardState["elements"]; !exists {
		t.Fatal("board_state missing elements")
	}

	if _, exists := boardState["viewport"]; !exists {
		t.Fatal("board_state missing viewport")
	}
}

func TestWebSocketBoardSnapshotAckRoutesFromGuestToOwner(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	ownerConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer ownerConn.Close()

	if err := ownerConn.WriteJSON(map[string]any{
		"type":       "session.create",
		"request_id": "req_create_snapshot_ack_owner",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_snapshot_ack",
		},
	}); err != nil {
		t.Fatalf("write owner session.create: %v", err)
	}

	ownerCreatedEnvelope := readWebSocketMessageByType(t, ownerConn, "session.created", 2*time.Second)
	var ownerCreatedPayload wsSessionCreatedPayload
	if err := json.Unmarshal(ownerCreatedEnvelope.Payload, &ownerCreatedPayload); err != nil {
		t.Fatalf("decode owner session.created payload: %v", err)
	}

	guestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer guestConn.Close()

	if err := guestConn.WriteJSON(map[string]any{
		"type":       "session.join",
		"request_id": "req_join_snapshot_ack_guest",
		"payload": map[string]string{
			"join_code": ownerCreatedPayload.JoinCode,
			"nickname":  "Guest Ack",
			"device_id": "device_guest_snapshot_ack",
		},
	}); err != nil {
		t.Fatalf("write guest session.join: %v", err)
	}

	guestJoinedEnvelope := readWebSocketMessageByType(t, guestConn, "session.joined", 2*time.Second)

	if err := ownerConn.WriteJSON(map[string]any{
		"type":       "board.snapshot",
		"request_id": "req_snapshot_for_ack",
		"payload": map[string]any{
			"target_actor_id":  guestJoinedEnvelope.ActorID,
			"snapshot_version": 11,
			"board_state": map[string]any{
				"elements": []any{},
				"viewport": map[string]any{
					"x":    10,
					"y":    20,
					"zoom": 1.2,
				},
			},
			"action_cursor": 32,
		},
	}); err != nil {
		t.Fatalf("write board.snapshot for ack flow: %v", err)
	}

	_ = readWebSocketMessageByType(t, guestConn, "board.snapshot", 2*time.Second)

	const ackRequestID = "req_snapshot_ack_1"
	if err := guestConn.WriteJSON(map[string]any{
		"type":       "board.snapshot.ack",
		"request_id": ackRequestID,
		"payload": map[string]any{
			"snapshot_version": 11,
		},
	}); err != nil {
		t.Fatalf("write board.snapshot.ack: %v", err)
	}

	ownerAckEnvelope := readWebSocketMessageByType(t, ownerConn, "board.snapshot.ack", 2*time.Second)
	if ownerAckEnvelope.RequestID != ackRequestID {
		t.Fatalf("board.snapshot.ack request id = %q, want %q", ownerAckEnvelope.RequestID, ackRequestID)
	}

	if ownerAckEnvelope.BoardID != ownerCreatedEnvelope.BoardID {
		t.Fatalf("board.snapshot.ack board id = %q, want %q", ownerAckEnvelope.BoardID, ownerCreatedEnvelope.BoardID)
	}

	if ownerAckEnvelope.ActorID != guestJoinedEnvelope.ActorID {
		t.Fatalf("board.snapshot.ack actor id = %q, want %q", ownerAckEnvelope.ActorID, guestJoinedEnvelope.ActorID)
	}

	if ownerAckEnvelope.SentAt == "" {
		t.Fatal("board.snapshot.ack sent_at is empty, want non-empty")
	}

	var ackPayload wsBoardSnapshotAckPayload
	if err := json.Unmarshal(ownerAckEnvelope.Payload, &ackPayload); err != nil {
		t.Fatalf("decode board.snapshot.ack payload: %v", err)
	}

	if ackPayload.SnapshotVersion != 11 {
		t.Fatalf("snapshot_version = %d, want %d", ackPayload.SnapshotVersion, 11)
	}
}

func TestWebSocketBoardActionRoutesFromGuestToOwner(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	ownerConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer ownerConn.Close()

	if err := ownerConn.WriteJSON(map[string]any{
		"type":       "session.create",
		"request_id": "req_create_board_action_owner",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_action",
		},
	}); err != nil {
		t.Fatalf("write owner session.create: %v", err)
	}

	ownerCreatedEnvelope := readWebSocketMessageByType(t, ownerConn, "session.created", 2*time.Second)
	var ownerCreatedPayload wsSessionCreatedPayload
	if err := json.Unmarshal(ownerCreatedEnvelope.Payload, &ownerCreatedPayload); err != nil {
		t.Fatalf("decode owner session.created payload: %v", err)
	}

	guestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer guestConn.Close()

	if err := guestConn.WriteJSON(map[string]any{
		"type":       "session.join",
		"request_id": "req_join_board_action_guest",
		"payload": map[string]string{
			"join_code": ownerCreatedPayload.JoinCode,
			"nickname":  "Guest Action",
			"device_id": "device_guest_action",
		},
	}); err != nil {
		t.Fatalf("write guest session.join: %v", err)
	}

	guestJoinedEnvelope := readWebSocketMessageByType(t, guestConn, "session.joined", 2*time.Second)

	const actionRequestID = "req_board_action_1"
	if err := guestConn.WriteJSON(map[string]any{
		"type":       "board.action",
		"request_id": actionRequestID,
		"payload": map[string]any{
			"action_id":       "action_1",
			"client_sequence": 1,
			"action_kind":     "shape.create",
			"data": map[string]any{
				"shape":        "rectangle",
				"x":            120,
				"y":            140,
				"width":        240,
				"height":       120,
				"stroke":       "#111827",
				"fill":         "#fef3c7",
				"stroke_width": 2,
			},
		},
	}); err != nil {
		t.Fatalf("write board.action: %v", err)
	}

	actionEnvelope := readWebSocketMessageByType(t, ownerConn, "board.action", 2*time.Second)
	if actionEnvelope.RequestID != actionRequestID {
		t.Fatalf("board.action request id = %q, want %q", actionEnvelope.RequestID, actionRequestID)
	}

	if actionEnvelope.BoardID != ownerCreatedEnvelope.BoardID {
		t.Fatalf("board.action board id = %q, want %q", actionEnvelope.BoardID, ownerCreatedEnvelope.BoardID)
	}

	if actionEnvelope.ActorID != guestJoinedEnvelope.ActorID {
		t.Fatalf("board.action actor id = %q, want %q", actionEnvelope.ActorID, guestJoinedEnvelope.ActorID)
	}

	var actionPayload wsBoardActionPayload
	if err := json.Unmarshal(actionEnvelope.Payload, &actionPayload); err != nil {
		t.Fatalf("decode board.action payload: %v", err)
	}

	if actionPayload.ActionID != "action_1" {
		t.Fatalf("action_id = %q, want %q", actionPayload.ActionID, "action_1")
	}

	if actionPayload.ClientSequence != 1 {
		t.Fatalf("client_sequence = %d, want %d", actionPayload.ClientSequence, 1)
	}

	if actionPayload.ActionKind != "shape.create" {
		t.Fatalf("action_kind = %q, want %q", actionPayload.ActionKind, "shape.create")
	}

	var actionData map[string]any
	if err := json.Unmarshal(actionPayload.Data, &actionData); err != nil {
		t.Fatalf("decode board.action data: %v", err)
	}

	if actionData["shape"] != "rectangle" {
		t.Fatalf("data.shape = %v, want %q", actionData["shape"], "rectangle")
	}
}

func TestWebSocketBoardActionRejectsUnattachedSender(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	conn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{
		"type":       "board.action",
		"request_id": "req_board_action_rejected",
		"payload": map[string]any{
			"action_id":       "action_1",
			"client_sequence": 1,
			"action_kind":     "shape.create",
			"data": map[string]any{
				"shape":        "rectangle",
				"x":            120,
				"y":            140,
				"width":        240,
				"height":       120,
				"stroke":       "#111827",
				"fill":         "#fef3c7",
				"stroke_width": 2,
			},
		},
	}); err != nil {
		t.Fatalf("write board.action: %v", err)
	}

	errorEnvelope := readWebSocketMessageByType(t, conn, "error", 2*time.Second)
	if errorEnvelope.RequestID != "req_board_action_rejected" {
		t.Fatalf("error request id = %q, want %q", errorEnvelope.RequestID, "req_board_action_rejected")
	}

	var payload wsErrorPayload
	if err := json.Unmarshal(errorEnvelope.Payload, &payload); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}

	if payload.Code != "invalid_message" {
		t.Fatalf("error code = %q, want %q", payload.Code, "invalid_message")
	}
}

func TestWebSocketPresenceUpdateRoutesFromOwnerToGuest(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	ownerConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer ownerConn.Close()

	if err := ownerConn.WriteJSON(map[string]any{
		"type":       "session.create",
		"request_id": "req_create_presence_owner",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_presence",
		},
	}); err != nil {
		t.Fatalf("write owner session.create: %v", err)
	}

	ownerCreatedEnvelope := readWebSocketMessageByType(t, ownerConn, "session.created", 2*time.Second)
	var ownerCreatedPayload wsSessionCreatedPayload
	if err := json.Unmarshal(ownerCreatedEnvelope.Payload, &ownerCreatedPayload); err != nil {
		t.Fatalf("decode owner session.created payload: %v", err)
	}

	guestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer guestConn.Close()

	if err := guestConn.WriteJSON(map[string]any{
		"type":       "session.join",
		"request_id": "req_join_presence_guest",
		"payload": map[string]string{
			"join_code": ownerCreatedPayload.JoinCode,
			"nickname":  "Guest Presence",
			"device_id": "device_guest_presence",
		},
	}); err != nil {
		t.Fatalf("write guest session.join: %v", err)
	}

	guestJoinedEnvelope := readWebSocketMessageByType(t, guestConn, "session.joined", 2*time.Second)

	const presenceRequestID = "req_presence_update_1"
	if err := ownerConn.WriteJSON(map[string]any{
		"type":       "presence.update",
		"request_id": presenceRequestID,
		"payload": map[string]any{
			"tool":  "pen",
			"state": "active",
			"cursor": map[string]any{
				"x": 320,
				"y": 240,
			},
		},
	}); err != nil {
		t.Fatalf("write presence.update: %v", err)
	}

	presenceEnvelope := readWebSocketMessageByType(t, guestConn, "presence.update", 2*time.Second)
	if presenceEnvelope.RequestID != presenceRequestID {
		t.Fatalf("presence.update request id = %q, want %q", presenceEnvelope.RequestID, presenceRequestID)
	}

	if presenceEnvelope.BoardID != ownerCreatedEnvelope.BoardID {
		t.Fatalf("presence.update board id = %q, want %q", presenceEnvelope.BoardID, ownerCreatedEnvelope.BoardID)
	}

	if presenceEnvelope.ActorID != ownerCreatedEnvelope.ActorID {
		t.Fatalf("presence.update actor id = %q, want %q", presenceEnvelope.ActorID, ownerCreatedEnvelope.ActorID)
	}

	var presencePayload wsPresenceUpdatePayload
	if err := json.Unmarshal(presenceEnvelope.Payload, &presencePayload); err != nil {
		t.Fatalf("decode presence.update payload: %v", err)
	}

	if presencePayload.Tool != "pen" {
		t.Fatalf("tool = %q, want %q", presencePayload.Tool, "pen")
	}

	if presencePayload.State != "active" {
		t.Fatalf("state = %q, want %q", presencePayload.State, "active")
	}

	if presencePayload.Cursor == nil {
		t.Fatal("cursor is nil, want coordinates")
	}

	if presencePayload.Cursor.X != 320 || presencePayload.Cursor.Y != 240 {
		t.Fatalf("cursor = %#v, want x=320 y=240", presencePayload.Cursor)
	}

	if guestJoinedEnvelope.ActorID == ownerCreatedEnvelope.ActorID {
		t.Fatal("guest actor id unexpectedly matched owner actor id")
	}
}

func TestWebSocketPresenceUpdateRejectsMalformedPayload(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	conn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{
		"type":       "presence.update",
		"request_id": "req_presence_update_invalid",
		"payload": map[string]any{
			"tool":   "pen",
			"state":  "active",
			"cursor": "not-an-object",
		},
	}); err != nil {
		t.Fatalf("write malformed presence.update: %v", err)
	}

	errorEnvelope := readWebSocketMessageByType(t, conn, "error", 2*time.Second)
	if errorEnvelope.RequestID != "req_presence_update_invalid" {
		t.Fatalf("error request id = %q, want %q", errorEnvelope.RequestID, "req_presence_update_invalid")
	}

	var payload wsErrorPayload
	if err := json.Unmarshal(errorEnvelope.Payload, &payload); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}

	if payload.Code != "invalid_message" {
		t.Fatalf("error code = %q, want %q", payload.Code, "invalid_message")
	}
}

func TestWebSocketHeartbeatPingKeepsSessionAlive(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       100 * time.Millisecond,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	conn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{
		"type":       "session.create",
		"request_id": "req_heartbeat_owner",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_heartbeat",
		},
	}); err != nil {
		t.Fatalf("write session.create: %v", err)
	}

	_ = readWebSocketMessageByType(t, conn, "session.created", 2*time.Second)

	time.Sleep(90 * time.Millisecond)

	if err := conn.WriteJSON(map[string]any{
		"type":       "heartbeat.ping",
		"request_id": "req_heartbeat_ping_1",
		"payload":    map[string]any{},
	}); err != nil {
		t.Fatalf("write first heartbeat.ping: %v", err)
	}

	firstPong := readWebSocketMessageByType(t, conn, "heartbeat.pong", 2*time.Second)
	if firstPong.RequestID != "" {
		t.Fatalf("heartbeat.pong request id = %q, want empty", firstPong.RequestID)
	}

	var firstPongPayload map[string]any
	if err := json.Unmarshal(firstPong.Payload, &firstPongPayload); err != nil {
		t.Fatalf("decode first heartbeat.pong payload: %v", err)
	}
	if len(firstPongPayload) != 0 {
		t.Fatalf("heartbeat.pong payload = %#v, want empty object", firstPongPayload)
	}

	time.Sleep(130 * time.Millisecond)

	if err := conn.WriteJSON(map[string]any{
		"type":       "heartbeat.ping",
		"request_id": "req_heartbeat_ping_2",
		"payload":    map[string]any{},
	}); err != nil {
		t.Fatalf("write second heartbeat.ping: %v", err)
	}

	secondPong := readWebSocketMessageByType(t, conn, "heartbeat.pong", 2*time.Second)
	if secondPong.RequestID != "" {
		t.Fatalf("heartbeat.pong request id = %q, want empty", secondPong.RequestID)
	}
}

func TestWebSocketIdleConnectionDisconnectsWithoutHeartbeat(t *testing.T) {
	t.Parallel()

	handler := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       100 * time.Millisecond,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	router := handler.(*Router)
	server := httptest.NewServer(handler)
	defer server.Close()

	conn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{
		"type":       "session.create",
		"request_id": "req_idle_owner",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_idle",
		},
	}); err != nil {
		t.Fatalf("write session.create: %v", err)
	}

	createdEnvelope := readWebSocketMessageByType(t, conn, "session.created", 2*time.Second)
	var createdPayload wsSessionCreatedPayload
	if err := json.Unmarshal(createdEnvelope.Payload, &createdPayload); err != nil {
		t.Fatalf("decode session.created payload: %v", err)
	}

	time.Sleep(250 * time.Millisecond)

	if err := conn.SetReadDeadline(time.Now().Add(250 * time.Millisecond)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}

	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("read message after idle timeout, want connection close error")
	}

	loaded, ok := router.store.GetBoardByJoinCode(createdPayload.JoinCode)
	if !ok {
		t.Fatal("GetBoardByJoinCode() returned ok = false, want true while waiting for ttl-based board expiry")
	}

	if len(loaded.Participants) != 0 {
		t.Fatalf("GetBoardByJoinCode() participants len = %d, want 0 after idle disconnect cleanup", len(loaded.Participants))
	}
}

func TestWebSocketParticipantLeftNotifiesRemainingParticipantsOnDisconnect(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	ownerConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer ownerConn.Close()

	ownerCreateRequest := map[string]any{
		"type":       "session.create",
		"request_id": "req_create_owner_for_participant_left",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_1",
		},
	}
	if err := ownerConn.WriteJSON(ownerCreateRequest); err != nil {
		t.Fatalf("write owner session.create message: %v", err)
	}

	_, ownerCreatedRaw, err := ownerConn.ReadMessage()
	if err != nil {
		t.Fatalf("read owner session.created message: %v", err)
	}

	var ownerCreatedEnvelope wsMessage
	if err := json.Unmarshal(ownerCreatedRaw, &ownerCreatedEnvelope); err != nil {
		t.Fatalf("decode owner session.created envelope: %v", err)
	}

	var ownerCreatedPayload wsSessionCreatedPayload
	if err := json.Unmarshal(ownerCreatedEnvelope.Payload, &ownerCreatedPayload); err != nil {
		t.Fatalf("decode owner session.created payload: %v", err)
	}

	guestConn := dialWebSocket(t, server.URL+"/api/v1/ws")

	guestJoinRequest := map[string]any{
		"type":       "session.join",
		"request_id": "req_join_for_participant_left",
		"payload": map[string]string{
			"join_code": ownerCreatedPayload.JoinCode,
			"nickname":  "Guest 1",
			"device_id": "device_guest_1",
		},
	}
	if err := guestConn.WriteJSON(guestJoinRequest); err != nil {
		t.Fatalf("write guest session.join message: %v", err)
	}

	_, guestJoinedRaw, err := guestConn.ReadMessage()
	if err != nil {
		t.Fatalf("read guest session.joined message: %v", err)
	}

	var guestJoinedEnvelope wsMessage
	if err := json.Unmarshal(guestJoinedRaw, &guestJoinedEnvelope); err != nil {
		t.Fatalf("decode guest session.joined envelope: %v", err)
	}

	joinedEventEnvelope := readWebSocketMessageByType(t, ownerConn, "participant.joined", 2*time.Second)

	if joinedEventEnvelope.Type != "participant.joined" {
		t.Fatalf("event type = %q, want %q", joinedEventEnvelope.Type, "participant.joined")
	}

	if err := guestConn.Close(); err != nil {
		t.Fatalf("close guest websocket: %v", err)
	}

	leftEventEnvelope := readWebSocketMessageByType(t, ownerConn, "participant.left", 2*time.Second)

	if leftEventEnvelope.Type != "participant.left" {
		t.Fatalf("event type = %q, want %q", leftEventEnvelope.Type, "participant.left")
	}

	if leftEventEnvelope.BoardID != ownerCreatedEnvelope.BoardID {
		t.Fatalf("event board id = %q, want %q", leftEventEnvelope.BoardID, ownerCreatedEnvelope.BoardID)
	}

	if leftEventEnvelope.ActorID != guestJoinedEnvelope.ActorID {
		t.Fatalf("event actor id = %q, want %q", leftEventEnvelope.ActorID, guestJoinedEnvelope.ActorID)
	}

	var leftEventPayload wsParticipantLeftPayload
	if err := json.Unmarshal(leftEventEnvelope.Payload, &leftEventPayload); err != nil {
		t.Fatalf("decode owner participant.left payload: %v", err)
	}

	if leftEventPayload.ActorID != guestJoinedEnvelope.ActorID {
		t.Fatalf("payload actor id = %q, want %q", leftEventPayload.ActorID, guestJoinedEnvelope.ActorID)
	}

	if leftEventPayload.Reason != "disconnect" {
		t.Fatalf("payload reason = %q, want %q", leftEventPayload.Reason, "disconnect")
	}
}

func TestWebSocketSessionJoinRejectedInvalidCode(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	conn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer conn.Close()

	request := map[string]any{
		"type":       "session.join",
		"request_id": "req_join_invalid_code",
		"payload": map[string]string{
			"join_code": "ZZZZZZZZ",
			"nickname":  "Guest",
			"device_id": "device_guest_1",
		},
	}
	if err := conn.WriteJSON(request); err != nil {
		t.Fatalf("write session.join invalid code message: %v", err)
	}

	_, rawMessage, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read session.join_rejected message: %v", err)
	}

	var envelope wsMessage
	if err := json.Unmarshal(rawMessage, &envelope); err != nil {
		t.Fatalf("decode session.join_rejected envelope: %v", err)
	}

	if envelope.Type != "session.join_rejected" {
		t.Fatalf("response type = %q, want %q", envelope.Type, "session.join_rejected")
	}

	if envelope.RequestID != "req_join_invalid_code" {
		t.Fatalf("request id = %q, want %q", envelope.RequestID, "req_join_invalid_code")
	}

	var payload wsSessionJoinRejectedPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatalf("decode session.join_rejected payload: %v", err)
	}

	if payload.Reason != "invalid_code" {
		t.Fatalf("reason = %q, want %q", payload.Reason, "invalid_code")
	}
}

func TestWebSocketSessionJoinRejectedBoardFull(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 2,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	ownerConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer ownerConn.Close()

	ownerRequest := map[string]any{
		"type":       "session.create",
		"request_id": "req_create_owner_board_full",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner_1",
		},
	}
	if err := ownerConn.WriteJSON(ownerRequest); err != nil {
		t.Fatalf("write owner session.create message: %v", err)
	}

	_, ownerRawMessage, err := ownerConn.ReadMessage()
	if err != nil {
		t.Fatalf("read owner session.created message: %v", err)
	}

	var ownerEnvelope wsMessage
	if err := json.Unmarshal(ownerRawMessage, &ownerEnvelope); err != nil {
		t.Fatalf("decode owner session.created envelope: %v", err)
	}

	var ownerPayload wsSessionCreatedPayload
	if err := json.Unmarshal(ownerEnvelope.Payload, &ownerPayload); err != nil {
		t.Fatalf("decode owner session.created payload: %v", err)
	}

	firstGuestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer firstGuestConn.Close()

	firstJoinRequest := map[string]any{
		"type":       "session.join",
		"request_id": "req_join_board_full_1",
		"payload": map[string]string{
			"join_code": ownerPayload.JoinCode,
			"nickname":  "Guest 1",
			"device_id": "device_guest_1",
		},
	}
	if err := firstGuestConn.WriteJSON(firstJoinRequest); err != nil {
		t.Fatalf("write first guest session.join message: %v", err)
	}

	_, _, err = firstGuestConn.ReadMessage()
	if err != nil {
		t.Fatalf("read first guest session.joined message: %v", err)
	}

	secondGuestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer secondGuestConn.Close()

	secondJoinRequest := map[string]any{
		"type":       "session.join",
		"request_id": "req_join_board_full_2",
		"payload": map[string]string{
			"join_code": ownerPayload.JoinCode,
			"nickname":  "Guest 2",
			"device_id": "device_guest_2",
		},
	}
	if err := secondGuestConn.WriteJSON(secondJoinRequest); err != nil {
		t.Fatalf("write second guest session.join message: %v", err)
	}

	_, rawMessage, err := secondGuestConn.ReadMessage()
	if err != nil {
		t.Fatalf("read second guest session.join_rejected message: %v", err)
	}

	var envelope wsMessage
	if err := json.Unmarshal(rawMessage, &envelope); err != nil {
		t.Fatalf("decode second guest session.join_rejected envelope: %v", err)
	}

	if envelope.Type != "session.join_rejected" {
		t.Fatalf("response type = %q, want %q", envelope.Type, "session.join_rejected")
	}

	var payload wsSessionJoinRejectedPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatalf("decode second guest session.join_rejected payload: %v", err)
	}

	if payload.Reason != "board_full" {
		t.Fatalf("reason = %q, want %q", payload.Reason, "board_full")
	}
}

func TestWebSocketSessionJoinRejectsInvalidPayload(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	conn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer conn.Close()

	request := map[string]any{
		"type":       "session.join",
		"request_id": "req_join_invalid_payload",
		"payload": map[string]string{
			"join_code": "",
			"nickname":  "Guest",
			"device_id": "",
		},
	}
	if err := conn.WriteJSON(request); err != nil {
		t.Fatalf("write invalid session.join message: %v", err)
	}

	_, rawMessage, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read error message: %v", err)
	}

	var envelope wsMessage
	if err := json.Unmarshal(rawMessage, &envelope); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}

	if envelope.Type != "error" {
		t.Fatalf("response type = %q, want %q", envelope.Type, "error")
	}

	if envelope.RequestID != "req_join_invalid_payload" {
		t.Fatalf("request id = %q, want %q", envelope.RequestID, "req_join_invalid_payload")
	}

	var payload wsErrorPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}

	if payload.Code != "invalid_message" {
		t.Fatalf("error code = %q, want %q", payload.Code, "invalid_message")
	}
}

func dialWebSocket(t *testing.T, endpoint string) *websocket.Conn {
	t.Helper()

	socketURL := "ws" + strings.TrimPrefix(endpoint, "http")
	connection, response, err := websocket.DefaultDialer.Dial(socketURL, nil)
	if err != nil {
		if response != nil {
			t.Fatalf("dial websocket %s failed with status %d: %v", socketURL, response.StatusCode, err)
		}

		t.Fatalf("dial websocket %s failed: %v", socketURL, err)
	}

	return connection
}

func readWebSocketMessageByType(
	t *testing.T,
	conn *websocket.Conn,
	expectedType string,
	timeout time.Duration,
) wsMessage {
	t.Helper()

	if err := conn.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	defer func() {
		if err := conn.SetReadDeadline(time.Time{}); err != nil {
			t.Fatalf("clear read deadline: %v", err)
		}
	}()

	for {
		_, rawMessage, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read websocket message while waiting for %s: %v", expectedType, err)
		}

		var envelope wsMessage
		if err := json.Unmarshal(rawMessage, &envelope); err != nil {
			t.Fatalf("decode websocket message while waiting for %s: %v", expectedType, err)
		}

		if envelope.Type == expectedType {
			return envelope
		}
	}
}
