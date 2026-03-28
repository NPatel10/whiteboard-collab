package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"whiteboard-relay/internal/config"
)

func TestFixedWindowRateLimiterResetsAfterWindow(t *testing.T) {
	t.Parallel()

	currentNow := time.Date(2026, time.March, 28, 10, 30, 0, 0, time.UTC)
	limiter := newFixedWindowRateLimiter(2, time.Minute, func() time.Time {
		return currentNow
	})

	if !limiter.Allow("198.51.100.1") {
		t.Fatal("first request should be allowed")
	}

	if !limiter.Allow("198.51.100.1") {
		t.Fatal("second request should be allowed")
	}

	if limiter.Allow("198.51.100.1") {
		t.Fatal("third request should be rate limited")
	}

	currentNow = currentNow.Add(time.Minute)

	if !limiter.Allow("198.51.100.1") {
		t.Fatal("request should be allowed after the window resets")
	}
}

func TestWebsocketRateLimitsTrackIPAndCodeSeparately(t *testing.T) {
	t.Parallel()

	currentNow := time.Date(2026, time.March, 28, 10, 30, 0, 0, time.UTC)
	limits := newWebsocketRateLimitsWithConfig(func() time.Time {
		return currentNow
	}, 1, 2, 1, time.Minute)

	if !limits.allowSessionCreate("198.51.100.1:1234") {
		t.Fatal("first create request should be allowed")
	}

	if limits.allowSessionCreate("198.51.100.1:5678") {
		t.Fatal("second create request from same IP should be rate limited")
	}

	if !limits.allowSessionJoinByIP("198.51.100.1:1234") {
		t.Fatal("first join request should be allowed")
	}

	if !limits.allowSessionJoinByIP("198.51.100.1:5678") {
		t.Fatal("second join request from same IP should be allowed")
	}

	if limits.allowSessionJoinByIP("198.51.100.1:9999") {
		t.Fatal("third join request from same IP should be rate limited")
	}

	if !limits.allowSessionJoinByCode("a7f3kq9x") {
		t.Fatal("first join attempt for a code should be allowed")
	}

	if limits.allowSessionJoinByCode("A7F3KQ9X") {
		t.Fatal("second join attempt for the same code should be rate limited")
	}

	currentNow = currentNow.Add(time.Minute)

	if !limits.allowSessionJoinByCode("A7F3KQ9X") {
		t.Fatal("join code limiter should reset after the window")
	}
}

func TestWebSocketSessionCreateRateLimitsByIP(t *testing.T) {
	t.Parallel()

	router := newRateLimitedTestRouter(time.Date(2026, time.March, 28, 10, 30, 0, 0, time.UTC), 1, 10, 10)
	server := httptest.NewServer(router)
	defer server.Close()

	firstConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer firstConn.Close()

	if err := firstConn.WriteJSON(map[string]any{
		"type":       "session.create",
		"request_id": "req_create_1",
		"payload": map[string]string{
			"nickname":  "Owner 1",
			"device_id": "device_owner_1",
		},
	}); err != nil {
		t.Fatalf("write first session.create message: %v", err)
	}

	if _, _, err := firstConn.ReadMessage(); err != nil {
		t.Fatalf("read first session.created message: %v", err)
	}

	secondConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer secondConn.Close()

	if err := secondConn.WriteJSON(map[string]any{
		"type":       "session.create",
		"request_id": "req_create_2",
		"payload": map[string]string{
			"nickname":  "Owner 2",
			"device_id": "device_owner_2",
		},
	}); err != nil {
		t.Fatalf("write second session.create message: %v", err)
	}

	_, rawMessage, err := secondConn.ReadMessage()
	if err != nil {
		t.Fatalf("read second session.create response: %v", err)
	}

	var envelope wsMessage
	if err := json.Unmarshal(rawMessage, &envelope); err != nil {
		t.Fatalf("decode second session.create response: %v", err)
	}

	if envelope.Type != "error" {
		t.Fatalf("response type = %q, want %q", envelope.Type, "error")
	}

	var payload wsErrorPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}

	if payload.Code != "rate_limited" {
		t.Fatalf("error code = %q, want %q", payload.Code, "rate_limited")
	}
}

func TestWebSocketSessionJoinRateLimitsByCode(t *testing.T) {
	t.Parallel()

	router := newRateLimitedTestRouter(time.Date(2026, time.March, 28, 10, 30, 0, 0, time.UTC), 10, 10, 1)
	server := httptest.NewServer(router)
	defer server.Close()

	ownerConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer ownerConn.Close()

	if err := ownerConn.WriteJSON(map[string]any{
		"type":       "session.create",
		"request_id": "req_owner_create",
		"payload": map[string]string{
			"nickname":  "Owner",
			"device_id": "device_owner",
		},
	}); err != nil {
		t.Fatalf("write owner session.create: %v", err)
	}

	ownerCreatedEnvelope := readWebSocketMessageByType(t, ownerConn, "session.created", 2*time.Second)
	var ownerCreatedPayload wsSessionCreatedPayload
	if err := json.Unmarshal(ownerCreatedEnvelope.Payload, &ownerCreatedPayload); err != nil {
		t.Fatalf("decode owner session.created payload: %v", err)
	}

	firstGuestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer firstGuestConn.Close()

	if err := firstGuestConn.WriteJSON(map[string]any{
		"type":       "session.join",
		"request_id": "req_guest_join_1",
		"payload": map[string]string{
			"join_code": ownerCreatedPayload.JoinCode,
			"nickname":  "Guest 1",
			"device_id": "device_guest_1",
		},
	}); err != nil {
		t.Fatalf("write first session.join: %v", err)
	}

	if _, _, err := firstGuestConn.ReadMessage(); err != nil {
		t.Fatalf("read first session.joined message: %v", err)
	}

	_ = readWebSocketMessageByType(t, ownerConn, "board.snapshot.request", 2*time.Second)

	secondGuestConn := dialWebSocket(t, server.URL+"/api/v1/ws")
	defer secondGuestConn.Close()

	if err := secondGuestConn.WriteJSON(map[string]any{
		"type":       "session.join",
		"request_id": "req_guest_join_2",
		"payload": map[string]string{
			"join_code": ownerCreatedPayload.JoinCode,
			"nickname":  "Guest 2",
			"device_id": "device_guest_2",
		},
	}); err != nil {
		t.Fatalf("write second session.join: %v", err)
	}

	_, rawMessage, err := secondGuestConn.ReadMessage()
	if err != nil {
		t.Fatalf("read second session.join response: %v", err)
	}

	var envelope wsMessage
	if err := json.Unmarshal(rawMessage, &envelope); err != nil {
		t.Fatalf("decode second session.join response: %v", err)
	}

	if envelope.Type != "session.join_rejected" {
		t.Fatalf("response type = %q, want %q", envelope.Type, "session.join_rejected")
	}

	var payload wsSessionJoinRejectedPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatalf("decode join rejected payload: %v", err)
	}

	if payload.Reason != "rate_limited" {
		t.Fatalf("join rejected reason = %q, want %q", payload.Reason, "rate_limited")
	}
}

func newRateLimitedTestRouter(startedAt time.Time, sessionCreateByIPLimit, sessionJoinByIPLimit, sessionJoinByCodeLimit int) *Router {
	router := NewRouter(
		startedAt,
		config.Config{
			MaxParticipantsPerBoard: 4,
			JoinCodeLength:          8,
			CodeTTL:                 24 * time.Hour,
			HeartbeatInterval:       25 * time.Second,
		},
		slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)),
	).(*Router)

	router.rateLimits = newWebsocketRateLimitsWithConfig(
		func() time.Time { return startedAt },
		sessionCreateByIPLimit,
		sessionJoinByIPLimit,
		sessionJoinByCodeLimit,
		time.Minute,
	)

	return router
}
