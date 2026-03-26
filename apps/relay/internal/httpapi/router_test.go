package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"whiteboard-relay/internal/config"
)

func TestNewRouterHealthz(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))

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
	}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))

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

func TestNewRouterWebSocketRequiresUpgradeHeaders(t *testing.T) {
	t.Parallel()

	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{}, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	server := httptest.NewServer(router)
	defer server.Close()

	response, err := http.Get(server.URL + "/api/v1/ws")
	if err != nil {
		t.Fatalf("get websocket endpoint: %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status code = %d, want %d", response.StatusCode, http.StatusBadRequest)
	}
}

func TestNewRouterReturnsStructuredErrorsForUnknownRoutes(t *testing.T) {
	t.Parallel()

	var logBuffer bytes.Buffer
	router := NewRouter(time.Unix(0, 0).UTC(), config.Config{}, slog.New(slog.NewTextHandler(&logBuffer, nil)))

	request := httptest.NewRequest(http.MethodPost, "/api/v1/unknown", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status code = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}

	var payload errorResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode unknown route response: %v", err)
	}

	if payload.Error.Code != "method_not_allowed" {
		t.Fatalf("error code = %q, want %q", payload.Error.Code, "method_not_allowed")
	}

	if !strings.Contains(logBuffer.String(), "component=relay.http") {
		t.Fatalf("log output = %q, want component field", logBuffer.String())
	}

	if !strings.Contains(logBuffer.String(), "status=405") {
		t.Fatalf("log output = %q, want status field", logBuffer.String())
	}

	if !strings.Contains(logBuffer.String(), "error_code=method_not_allowed") {
		t.Fatalf("log output = %q, want error code field", logBuffer.String())
	}
}
