package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"whiteboard-relay/internal/config"
)

func TestNewRouterHealthz(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", response.Code, http.StatusOK)
	}

	if contentType := response.Header().Get("Content-Type"); contentType != "application/json; charset=utf-8" {
		t.Fatalf("content type = %q, want %q", contentType, "application/json; charset=utf-8")
	}

	var payload healthResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode health response: %v", err)
	}

	if payload.Status != "ok" {
		t.Fatalf("status = %q, want %q", payload.Status, "ok")
	}

	if payload.UptimeSeconds <= 0 {
		t.Fatalf("uptime_seconds = %d, want > 0", payload.UptimeSeconds)
	}
}

func TestNewRouterConfig(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{
		MaxParticipantsPerBoard: 4,
		JoinCodeLength:          8,
		CodeTTL:                 24 * time.Hour,
		HeartbeatInterval:       25 * time.Second,
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", response.Code, http.StatusOK)
	}

	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "no-store" {
		t.Fatalf("cache-control = %q, want %q", cacheControl, "no-store")
	}

	var payload configResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode config response: %v", err)
	}

	if payload.MaxParticipantsPerBoard != 4 {
		t.Fatalf("max participants = %d, want %d", payload.MaxParticipantsPerBoard, 4)
	}

	if payload.JoinCodeLength != 8 {
		t.Fatalf("join code length = %d, want %d", payload.JoinCodeLength, 8)
	}

	if payload.CodeTTLSeconds != 24*60*60 {
		t.Fatalf("code ttl seconds = %d, want %d", payload.CodeTTLSeconds, 24*60*60)
	}

	if payload.HeartbeatIntervalSecs != 25 {
		t.Fatalf("heartbeat interval seconds = %d, want %d", payload.HeartbeatIntervalSecs, 25)
	}
}
