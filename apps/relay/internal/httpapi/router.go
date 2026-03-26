package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
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
	Error errorDetails `json:"error"`
}

type errorDetails struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Router struct {
	startedAt time.Time
	cfg       config.Config
	logger    *slog.Logger
}

func NewRouter(startedAt time.Time, cfg config.Config, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}

	return &Router{
		startedAt: startedAt,
		cfg:       cfg,
		logger:    logger.With("component", "relay.http"),
	}
}

func (router *Router) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	recorder := newResponseRecorder(writer)
	started := time.Now()

	switch {
	case request.Method == http.MethodGet && request.URL.Path == "/":
		writeJSON(recorder, http.StatusOK, map[string]string{
			"name":    "whiteboard-relay",
			"version": "0.1.0",
		})
	case request.Method == http.MethodGet && request.URL.Path == "/api/v1/healthz":
		writeJSON(recorder, http.StatusOK, healthResponse{
			Status:        "ok",
			UptimeSeconds: int64(time.Since(router.startedAt).Seconds()),
		})
	case request.Method == http.MethodGet && request.URL.Path == "/api/v1/config":
		recorder.Header().Set("Cache-Control", "no-store")
		writeJSON(recorder, http.StatusOK, configResponse{
			MaxParticipantsPerBoard: router.cfg.MaxParticipantsPerBoard,
			JoinCodeLength:          router.cfg.JoinCodeLength,
			CodeTTLSeconds:          router.cfg.CodeTTLSeconds(),
			HeartbeatIntervalSecs:   router.cfg.HeartbeatIntervalSeconds(),
		})
	case request.Method == http.MethodGet && request.URL.Path == "/api/v1/ws":
		writeError(recorder, http.StatusNotImplemented, "not_implemented", "websocket relay endpoint is scaffolded but not implemented yet")
	case strings.HasPrefix(request.URL.Path, "/api/v1/"):
		if request.Method != http.MethodGet {
			writeError(recorder, http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed for this route")
			break
		}

		writeError(recorder, http.StatusNotFound, "not_found", "route was not found")
	default:
		writeError(recorder, http.StatusNotFound, "not_found", "route was not found")
	}

	router.logRequest(request, recorder, time.Since(started))
}

func (router *Router) logRequest(request *http.Request, recorder *responseRecorder, duration time.Duration) {
	statusCode := recorder.statusCode()
	fields := []any{
		"method", request.Method,
		"path", request.URL.Path,
		"status", statusCode,
		"duration_ms", duration.Milliseconds(),
	}

	if request.RemoteAddr != "" {
		fields = append(fields, "remote_addr", request.RemoteAddr)
	}

	if recorder.errorCode != "" {
		fields = append(fields, "error_code", recorder.errorCode)
		fields = append(fields, "error_message", recorder.errorMessage)
	}

	if statusCode >= http.StatusBadRequest {
		router.logger.Warn("request completed with error", fields...)
		return
	}

	router.logger.Info("request completed", fields...)
}

func writeJSON(writer http.ResponseWriter, statusCode int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(statusCode)

	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(payload)
}

func writeError(writer http.ResponseWriter, statusCode int, code, message string) {
	if recorder, ok := writer.(errorRecorder); ok {
		recorder.recordError(code, message)
	}

	writeJSON(writer, statusCode, errorResponse{
		Error: errorDetails{
			Code:    code,
			Message: message,
		},
	})
}

type responseRecorder struct {
	http.ResponseWriter
	statusCodeValue int
	errorCode       string
	errorMessage    string
}

func newResponseRecorder(writer http.ResponseWriter) *responseRecorder {
	return &responseRecorder{ResponseWriter: writer, statusCodeValue: http.StatusOK}
}

func (recorder *responseRecorder) WriteHeader(statusCode int) {
	recorder.statusCodeValue = statusCode
	recorder.ResponseWriter.WriteHeader(statusCode)
}

func (recorder *responseRecorder) statusCode() int {
	return recorder.statusCodeValue
}

func (recorder *responseRecorder) recordError(code, message string) {
	recorder.errorCode = code
	recorder.errorMessage = message
}

type errorRecorder interface {
	recordError(code, message string)
}
