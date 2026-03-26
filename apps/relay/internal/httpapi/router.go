package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"whiteboard-relay/internal/config"
)

type healthResponse struct {
	Status        string `json:"status"`
	UptimeSeconds int64  `json:"uptime_seconds"`
}

type configResponse struct {
	MaxParticipantsPerBoard int `json:"max_participants_per_board"`
	JoinCodeLength          int `json:"join_code_length"`
	CodeTTLSeconds          int `json:"code_ttl_seconds"`
	HeartbeatIntervalSecs   int `json:"heartbeat_interval_seconds"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func NewRouter(startedAt time.Time, cfg config.Config) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]string{
			"name":    "whiteboard-relay",
			"version": "0.1.0",
		})
	})

	mux.HandleFunc("GET /api/v1/healthz", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, healthResponse{
			Status:        "ok",
			UptimeSeconds: int64(time.Since(startedAt).Seconds()),
		})
	})

	mux.HandleFunc("GET /api/v1/config", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Cache-Control", "no-store")
		writeJSON(writer, http.StatusOK, configResponse{
			MaxParticipantsPerBoard: cfg.MaxParticipantsPerBoard,
			JoinCodeLength:          cfg.JoinCodeLength,
			CodeTTLSeconds:          cfg.CodeTTLSeconds(),
			HeartbeatIntervalSecs:   cfg.HeartbeatIntervalSeconds(),
		})
	})

	mux.HandleFunc("GET /api/v1/ws", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusNotImplemented, errorResponse{
			Error: "websocket relay endpoint is scaffolded but not implemented yet",
		})
	})

	return mux
}

func writeJSON(writer http.ResponseWriter, statusCode int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(statusCode)

	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(payload)
}
