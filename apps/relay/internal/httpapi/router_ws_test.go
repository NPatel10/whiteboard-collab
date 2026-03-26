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
