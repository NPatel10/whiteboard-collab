package httpapi

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"whiteboard-relay/internal/config"
	"whiteboard-relay/internal/roomstore"

	"github.com/gorilla/websocket"
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
	startedAt          time.Time
	cfg                config.Config
	logger             *slog.Logger
	store              *roomstore.Store
	websocketUpgrader  websocket.Upgrader
	idGenerator        func(prefix string) (string, error)
	connectionMu       sync.RWMutex
	connectionsByBoard map[string]map[string]*websocketClient
	sessionByConn      map[*websocket.Conn]participantSession
}

func NewRouter(startedAt time.Time, cfg config.Config, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}

	cfg = normalizeRuntimeConfig(cfg)
	storeOptions := []roomstore.Option{
		roomstore.WithJoinCodeLength(cfg.JoinCodeLength),
		roomstore.WithCodeTTL(cfg.CodeTTL),
	}

	store, err := roomstore.New(cfg.MaxParticipantsPerBoard, storeOptions...)
	if err != nil {
		logger.Error("failed to initialize room store", "error", err)
		store, _ = roomstore.New(defaultMaxParticipantsPerBoard)
	}

	return &Router{
		startedAt: startedAt,
		cfg:       cfg,
		logger:    logger.With("component", "relay.http"),
		store:     store,
		websocketUpgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		},
		idGenerator:        generatePrefixedID,
		connectionsByBoard: make(map[string]map[string]*websocketClient),
		sessionByConn:      make(map[*websocket.Conn]participantSession),
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
		router.handleWebSocket(recorder, request)
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

func (router *Router) handleWebSocket(writer http.ResponseWriter, request *http.Request) {
	conn, err := router.websocketUpgrader.Upgrade(writer, request, nil)
	if err != nil {
		return
	}
	client := &websocketClient{conn: conn}
	defer router.handleSocketDisconnect(client)
	defer conn.Close()

	for {
		messageType, data, err := client.conn.ReadMessage()
		if err != nil {
			return
		}

		if messageType != websocket.TextMessage {
			router.writeSocketError(client, "", "invalid_message", "only text websocket messages are supported")
			continue
		}

		router.handleSocketMessage(client, data)
	}
}

func (router *Router) handleSocketMessage(client *websocketClient, data []byte) {
	var envelope inboundSocketEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		router.writeSocketError(client, "", "invalid_message", "message must be a valid JSON socket envelope")
		return
	}

	switch strings.TrimSpace(envelope.Type) {
	case "session.create":
		router.handleSessionCreate(client, envelope)
	case "session.join":
		router.handleSessionJoin(client, envelope)
	default:
		router.writeSocketError(client, envelope.RequestID, "invalid_message", "unsupported socket message type")
	}
}

func (router *Router) handleSessionCreate(client *websocketClient, envelope inboundSocketEnvelope) {
	if router.hasActiveSession(client) {
		router.writeSocketError(client, envelope.RequestID, "invalid_message", "connection is already attached to a session")
		return
	}

	var payload sessionCreatePayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		router.writeSocketError(client, envelope.RequestID, "invalid_message", "session.create payload is invalid JSON")
		return
	}

	payload.Nickname = strings.TrimSpace(payload.Nickname)
	payload.DeviceID = strings.TrimSpace(payload.DeviceID)
	if payload.Nickname == "" || payload.DeviceID == "" {
		router.writeSocketError(client, envelope.RequestID, "invalid_message", "session.create payload requires nickname and device_id")
		return
	}

	session, ownerActorID, err := router.createOwnerSession(payload)
	if err != nil {
		router.logger.Error("failed to create board session", "error", err)
		router.writeSocketError(client, envelope.RequestID, "internal_error", "failed to create board session")
		return
	}

	if err := router.registerConnection(client, session.BoardID, ownerActorID); err != nil {
		router.logger.Error("failed to register owner connection", "error", err)
		router.writeSocketError(client, envelope.RequestID, "internal_error", "failed to register owner session")
		return
	}

	sentAt := time.Now().UTC()
	response := outboundSocketEnvelope{
		Type:      "session.created",
		RequestID: envelope.RequestID,
		BoardID:   session.BoardID,
		ActorID:   ownerActorID,
		SentAt:    sentAt.Format(time.RFC3339Nano),
		Payload: sessionCreatedPayload{
			JoinCode:         session.JoinCode,
			Role:             "owner",
			MaxParticipants:  session.MaxParticipants,
			ExpiresInSeconds: router.cfg.CodeTTLSeconds(),
		},
	}

	if err := client.WriteJSON(response); err != nil {
		router.logger.Warn("failed to write session.created message", "error", err)
	}
}

func (router *Router) handleSessionJoin(client *websocketClient, envelope inboundSocketEnvelope) {
	if router.hasActiveSession(client) {
		router.writeSocketError(client, envelope.RequestID, "invalid_message", "connection is already attached to a session")
		return
	}

	var payload sessionJoinPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		router.writeSocketError(client, envelope.RequestID, "invalid_message", "session.join payload is invalid JSON")
		return
	}

	payload.JoinCode = strings.TrimSpace(payload.JoinCode)
	payload.Nickname = strings.TrimSpace(payload.Nickname)
	payload.DeviceID = strings.TrimSpace(payload.DeviceID)
	if payload.JoinCode == "" || payload.Nickname == "" || payload.DeviceID == "" {
		router.writeSocketError(client, envelope.RequestID, "invalid_message", "session.join payload requires join_code, nickname, and device_id")
		return
	}

	session, actorID, err := router.createGuestSession(payload)
	if err != nil {
		switch {
		case errors.Is(err, roomstore.ErrJoinCodeNotFound):
			router.writeSessionJoinRejected(client, envelope.RequestID, joinRejectedReasonInvalidCode)
		case errors.Is(err, roomstore.ErrBoardFull):
			router.writeSessionJoinRejected(client, envelope.RequestID, joinRejectedReasonBoardFull)
		case errors.Is(err, roomstore.ErrBoardNotFound):
			router.writeSessionJoinRejected(client, envelope.RequestID, joinRejectedReasonBoardUnavailable)
		default:
			router.logger.Error("failed to join board session", "error", err)
			router.writeSocketError(client, envelope.RequestID, "internal_error", "failed to join board session")
		}

		return
	}

	if err := router.registerConnection(client, session.BoardID, actorID); err != nil {
		router.logger.Error("failed to register guest connection", "error", err)
		_, _ = router.store.RemoveParticipant(session.BoardID, actorID, time.Now().UTC())
		router.writeSocketError(client, envelope.RequestID, "internal_error", "failed to register guest session")
		return
	}

	response := outboundSocketEnvelope{
		Type:      "session.joined",
		RequestID: envelope.RequestID,
		BoardID:   session.BoardID,
		ActorID:   actorID,
		SentAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Payload: sessionJoinedPayload{
			Role:         "guest",
			OwnerActorID: session.OwnerActorID,
			Participants: buildParticipantSummaries(session.Participants),
		},
	}

	if err := client.WriteJSON(response); err != nil {
		router.logger.Warn("failed to write session.joined message", "error", err)
		return
	}

	joinedParticipant, ok := findParticipantSummaryByActorID(session.Participants, actorID)
	if !ok {
		return
	}

	router.broadcastParticipantJoined(session.BoardID, actorID, joinedParticipant)
}

func (router *Router) hasActiveSession(client *websocketClient) bool {
	router.connectionMu.RLock()
	defer router.connectionMu.RUnlock()

	_, exists := router.sessionByConn[client.conn]
	return exists
}

func (router *Router) registerConnection(client *websocketClient, boardID, actorID string) error {
	router.connectionMu.Lock()
	defer router.connectionMu.Unlock()

	if _, exists := router.sessionByConn[client.conn]; exists {
		return fmt.Errorf("connection is already attached to a session")
	}

	connectionsByActor, exists := router.connectionsByBoard[boardID]
	if !exists {
		connectionsByActor = make(map[string]*websocketClient)
		router.connectionsByBoard[boardID] = connectionsByActor
	}

	connectionsByActor[actorID] = client
	router.sessionByConn[client.conn] = participantSession{
		BoardID: boardID,
		ActorID: actorID,
	}

	return nil
}

func (router *Router) handleSocketDisconnect(client *websocketClient) {
	session, ok := router.unregisterConnection(client)
	if !ok {
		return
	}

	_, err := router.store.RemoveParticipant(session.BoardID, session.ActorID, time.Now().UTC())
	if err != nil && !errors.Is(err, roomstore.ErrBoardNotFound) && !errors.Is(err, roomstore.ErrParticipantNotFound) {
		router.logger.Warn("failed to remove participant on disconnect", "error", err, "board_id", session.BoardID, "actor_id", session.ActorID)
	}

	router.broadcastParticipantLeft(session.BoardID, session.ActorID)
}

func (router *Router) unregisterConnection(client *websocketClient) (participantSession, bool) {
	router.connectionMu.Lock()
	defer router.connectionMu.Unlock()

	session, exists := router.sessionByConn[client.conn]
	if !exists {
		return participantSession{}, false
	}

	delete(router.sessionByConn, client.conn)

	connectionsByActor, exists := router.connectionsByBoard[session.BoardID]
	if !exists {
		return session, true
	}

	delete(connectionsByActor, session.ActorID)
	if len(connectionsByActor) == 0 {
		delete(router.connectionsByBoard, session.BoardID)
	}

	return session, true
}

func (router *Router) broadcastParticipantJoined(boardID, actorID string, participant participantSummaryPayload) {
	router.broadcastBoardEvent(boardID, actorID, outboundSocketEnvelope{
		Type:    "participant.joined",
		BoardID: boardID,
		ActorID: actorID,
		SentAt:  time.Now().UTC().Format(time.RFC3339Nano),
		Payload: participant,
	})
}

func (router *Router) broadcastParticipantLeft(boardID, actorID string) {
	router.broadcastBoardEvent(boardID, actorID, outboundSocketEnvelope{
		Type:    "participant.left",
		BoardID: boardID,
		ActorID: actorID,
		SentAt:  time.Now().UTC().Format(time.RFC3339Nano),
		Payload: participantLeftPayload{
			ActorID: actorID,
			Reason:  participantLeftReasonDisconnect,
		},
	})
}

func (router *Router) broadcastBoardEvent(boardID, skipActorID string, payload outboundSocketEnvelope) {
	connections := router.connectionsForBoard(boardID, skipActorID)
	for _, client := range connections {
		if err := client.WriteJSON(payload); err != nil {
			router.logger.Warn("failed to broadcast websocket event", "type", payload.Type, "board_id", boardID, "error", err)
		}
	}
}

func (router *Router) connectionsForBoard(boardID, skipActorID string) []*websocketClient {
	router.connectionMu.RLock()
	defer router.connectionMu.RUnlock()

	connectionsByActor, exists := router.connectionsByBoard[boardID]
	if !exists {
		return nil
	}

	connections := make([]*websocketClient, 0, len(connectionsByActor))
	for actorID, client := range connectionsByActor {
		if actorID == skipActorID {
			continue
		}

		connections = append(connections, client)
	}

	return connections
}

func findParticipantSummaryByActorID(participants []roomstore.Participant, actorID string) (participantSummaryPayload, bool) {
	for _, participant := range participants {
		if participant.ActorID != actorID {
			continue
		}

		return participantSummaryPayload{
			ActorID:  participant.ActorID,
			Nickname: participant.Nickname,
			Role:     string(participant.Role),
			Color:    participant.Color,
		}, true
	}

	return participantSummaryPayload{}, false
}

func (router *Router) createOwnerSession(payload sessionCreatePayload) (roomstore.BoardSession, string, error) {
	boardID, err := router.idGenerator("board")
	if err != nil {
		return roomstore.BoardSession{}, "", fmt.Errorf("generate board id: %w", err)
	}

	actorID, err := router.idGenerator("actor")
	if err != nil {
		return roomstore.BoardSession{}, "", fmt.Errorf("generate owner actor id: %w", err)
	}

	now := time.Now().UTC()
	session, err := router.store.CreateBoard(roomstore.CreateBoardParams{
		BoardID: boardID,
		Owner: roomstore.Participant{
			ActorID:  actorID,
			DeviceID: payload.DeviceID,
			Nickname: payload.Nickname,
			Role:     roomstore.RoleOwner,
			Color:    defaultOwnerColor,
		},
	}, now)
	if err != nil {
		return roomstore.BoardSession{}, "", err
	}

	return session, actorID, nil
}

func (router *Router) createGuestSession(payload sessionJoinPayload) (roomstore.BoardSession, string, error) {
	actorID, err := router.idGenerator("actor")
	if err != nil {
		return roomstore.BoardSession{}, "", fmt.Errorf("generate guest actor id: %w", err)
	}

	now := time.Now().UTC()
	session, err := router.store.JoinBoard(roomstore.JoinBoardParams{
		JoinCode: payload.JoinCode,
		Participant: roomstore.Participant{
			ActorID:  actorID,
			DeviceID: payload.DeviceID,
			Nickname: payload.Nickname,
			Role:     roomstore.RoleGuest,
			Color:    defaultGuestColor,
		},
	}, now)
	if err != nil {
		return roomstore.BoardSession{}, "", err
	}

	return session, actorID, nil
}

func buildParticipantSummaries(participants []roomstore.Participant) []participantSummaryPayload {
	summaries := make([]participantSummaryPayload, 0, len(participants))
	for _, participant := range participants {
		summaries = append(summaries, participantSummaryPayload{
			ActorID:  participant.ActorID,
			Nickname: participant.Nickname,
			Role:     string(participant.Role),
			Color:    participant.Color,
		})
	}

	return summaries
}

func (router *Router) writeSocketError(client *websocketClient, requestID, code, message string) {
	payload := outboundSocketEnvelope{
		Type:      "error",
		RequestID: requestID,
		SentAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Payload: socketErrorPayload{
			Code:    code,
			Message: message,
		},
	}

	if err := client.WriteJSON(payload); err != nil {
		router.logger.Warn("failed to write websocket error message", "error", err)
	}
}

func (router *Router) writeSessionJoinRejected(client *websocketClient, requestID, reason string) {
	payload := outboundSocketEnvelope{
		Type:      "session.join_rejected",
		RequestID: requestID,
		SentAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Payload: sessionJoinRejectedPayload{
			Reason: reason,
		},
	}

	if err := client.WriteJSON(payload); err != nil {
		router.logger.Warn("failed to write session.join_rejected message", "error", err)
	}
}

func normalizeRuntimeConfig(cfg config.Config) config.Config {
	normalized := cfg
	if normalized.MaxParticipantsPerBoard <= 0 {
		normalized.MaxParticipantsPerBoard = defaultMaxParticipantsPerBoard
	}

	if normalized.JoinCodeLength <= 0 {
		normalized.JoinCodeLength = defaultJoinCodeLength
	}

	if normalized.CodeTTL <= 0 {
		normalized.CodeTTL = defaultCodeTTL
	}

	if normalized.HeartbeatInterval <= 0 {
		normalized.HeartbeatInterval = defaultHeartbeatInterval
	}

	return normalized
}

func generatePrefixedID(prefix string) (string, error) {
	entropy := make([]byte, 8)
	if _, err := rand.Read(entropy); err != nil {
		return "", err
	}

	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(entropy)), nil
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

func (recorder *responseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := recorder.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}

	return hijacker.Hijack()
}

func (recorder *responseRecorder) Flush() {
	flusher, ok := recorder.ResponseWriter.(http.Flusher)
	if !ok {
		return
	}

	flusher.Flush()
}

func (recorder *responseRecorder) Push(target string, opts *http.PushOptions) error {
	pusher, ok := recorder.ResponseWriter.(http.Pusher)
	if !ok {
		return http.ErrNotSupported
	}

	return pusher.Push(target, opts)
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

type inboundSocketEnvelope struct {
	Type      string          `json:"type"`
	RequestID string          `json:"request_id,omitempty"`
	Payload   json.RawMessage `json:"payload"`
}

type outboundSocketEnvelope struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id,omitempty"`
	BoardID   string `json:"board_id,omitempty"`
	ActorID   string `json:"actor_id,omitempty"`
	SentAt    string `json:"sent_at,omitempty"`
	Payload   any    `json:"payload"`
}

type sessionCreatePayload struct {
	Nickname string `json:"nickname"`
	DeviceID string `json:"device_id"`
}

type sessionCreatedPayload struct {
	JoinCode         string `json:"join_code"`
	Role             string `json:"role"`
	MaxParticipants  int    `json:"max_participants"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
}

type sessionJoinPayload struct {
	JoinCode string `json:"join_code"`
	Nickname string `json:"nickname"`
	DeviceID string `json:"device_id"`
}

type sessionJoinedPayload struct {
	Role         string                      `json:"role"`
	OwnerActorID string                      `json:"owner_actor_id"`
	Participants []participantSummaryPayload `json:"participants"`
}

type sessionJoinRejectedPayload struct {
	Reason string `json:"reason"`
}

type participantSummaryPayload struct {
	ActorID  string `json:"actor_id"`
	Nickname string `json:"nickname"`
	Role     string `json:"role"`
	Color    string `json:"color"`
}

type participantLeftPayload struct {
	ActorID string `json:"actor_id"`
	Reason  string `json:"reason"`
}

type socketErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type participantSession struct {
	BoardID string
	ActorID string
}

type websocketClient struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

func (client *websocketClient) WriteJSON(payload any) error {
	client.writeMu.Lock()
	defer client.writeMu.Unlock()

	return client.conn.WriteJSON(payload)
}

const (
	defaultMaxParticipantsPerBoard = 4
	defaultJoinCodeLength          = 8
	defaultOwnerColor              = "#f97316"
	defaultGuestColor              = "#0ea5e9"
	defaultCodeTTL                 = 24 * time.Hour
	defaultHeartbeatInterval       = 25 * time.Second

	joinRejectedReasonInvalidCode      = "invalid_code"
	joinRejectedReasonBoardFull        = "board_full"
	joinRejectedReasonBoardUnavailable = "board_unavailable"
	participantLeftReasonDisconnect    = "disconnect"
)
