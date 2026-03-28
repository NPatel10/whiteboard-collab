package roomstore

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

var (
	ErrBoardAlreadyExists       = errors.New("board already exists")
	ErrBoardFull                = errors.New("board is full")
	ErrBoardNotFound            = errors.New("board not found")
	ErrInvalidCodeTTL           = errors.New("code ttl must be greater than zero")
	ErrInvalidJoinCodeLength    = errors.New("join code length must be greater than zero")
	ErrInvalidMaxParticipants   = errors.New("max participants must be greater than zero")
	ErrInvalidNowFunc           = errors.New("now function is required")
	ErrJoinCodeAlreadyExists    = errors.New("join code already exists")
	ErrJoinCodeGenerationFailed = errors.New("unable to generate unique join code")
	ErrJoinCodeNotFound         = errors.New("join code not found")
	ErrParticipantAlreadyExists = errors.New("participant already exists")
	ErrParticipantNotFound      = errors.New("participant not found")
)

type ParticipantRole string

const (
	RoleOwner ParticipantRole = "owner"
	RoleGuest ParticipantRole = "guest"
)

type Participant struct {
	ActorID    string
	DeviceID   string
	Nickname   string
	Role       ParticipantRole
	Color      string
	JoinedAt   time.Time
	LastSeenAt time.Time
}

type BoardSession struct {
	BoardID         string
	JoinCode        string
	OwnerActorID    string
	Participants    []Participant
	MaxParticipants int
	CreatedAt       time.Time
	LastActivityAt  time.Time
}

type CreateBoardParams struct {
	BoardID  string
	JoinCode string
	Owner    Participant
}

type JoinBoardParams struct {
	JoinCode    string
	Participant Participant
}

type Store struct {
	mu                 sync.RWMutex
	maxParticipants    int
	joinCodeLength     int
	codeTTL            time.Duration
	now                func() time.Time
	randomSource       io.Reader
	boardIDsByJoinCode map[string]string
	boardsByID         map[string]*boardRecord
}

type boardRecord struct {
	BoardID          string
	JoinCode         string
	OwnerActorID     string
	CreatedAt        time.Time
	LastActivityAt   time.Time
	ParticipantOrder []string
	Participants     map[string]Participant
}

type Option func(*Store) error

func New(maxParticipants int, options ...Option) (*Store, error) {
	if maxParticipants <= 0 {
		return nil, ErrInvalidMaxParticipants
	}

	store := &Store{
		maxParticipants:    maxParticipants,
		joinCodeLength:     defaultJoinCodeLength,
		codeTTL:            defaultCodeTTL,
		now:                time.Now,
		randomSource:       newDefaultRandomSource(),
		boardIDsByJoinCode: make(map[string]string),
		boardsByID:         make(map[string]*boardRecord),
	}

	for _, option := range options {
		if err := option(store); err != nil {
			return nil, err
		}
	}

	return store, nil
}

func (store *Store) CreateBoard(params CreateBoardParams, now time.Time) (BoardSession, error) {
	if strings.TrimSpace(params.BoardID) == "" {
		return BoardSession{}, fmt.Errorf("board id is required")
	}

	joinCode := normalizeJoinCode(params.JoinCode)
	owner, err := prepareParticipant(params.Owner, RoleOwner, now)
	if err != nil {
		return BoardSession{}, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	if _, exists := store.boardsByID[params.BoardID]; exists {
		return BoardSession{}, ErrBoardAlreadyExists
	}

	if joinCode == "" {
		joinCode, err = store.generateUniqueJoinCodeLocked()
		if err != nil {
			return BoardSession{}, err
		}
	} else if _, exists := store.boardIDsByJoinCode[joinCode]; exists {
		return BoardSession{}, ErrJoinCodeAlreadyExists
	}

	record := &boardRecord{
		BoardID:          params.BoardID,
		JoinCode:         joinCode,
		OwnerActorID:     owner.ActorID,
		CreatedAt:        now.UTC(),
		LastActivityAt:   now.UTC(),
		ParticipantOrder: []string{owner.ActorID},
		Participants: map[string]Participant{
			owner.ActorID: owner,
		},
	}

	store.boardsByID[params.BoardID] = record
	store.boardIDsByJoinCode[joinCode] = params.BoardID

	return snapshotBoard(record, store.maxParticipants), nil
}

func (store *Store) GetBoardByJoinCode(joinCode string) (BoardSession, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()

	boardID, exists := store.boardIDsByJoinCode[normalizeJoinCode(joinCode)]
	if !exists {
		return BoardSession{}, false
	}

	record := store.boardsByID[boardID]
	if record == nil {
		return BoardSession{}, false
	}

	if store.isExpired(record, store.now().UTC()) {
		store.deleteBoardLocked(record.BoardID)
		return BoardSession{}, false
	}

	return snapshotBoard(record, store.maxParticipants), true
}

func (store *Store) JoinBoard(params JoinBoardParams, now time.Time) (BoardSession, error) {
	joinCode := normalizeJoinCode(params.JoinCode)
	if joinCode == "" {
		return BoardSession{}, fmt.Errorf("join code is required")
	}

	participant, err := prepareParticipant(params.Participant, RoleGuest, now)
	if err != nil {
		return BoardSession{}, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	boardID, exists := store.boardIDsByJoinCode[joinCode]
	if !exists {
		return BoardSession{}, ErrJoinCodeNotFound
	}

	record := store.boardsByID[boardID]
	if record == nil {
		return BoardSession{}, ErrBoardNotFound
	}

	if store.isExpired(record, now.UTC()) {
		store.deleteBoardLocked(record.BoardID)
		return BoardSession{}, ErrJoinCodeNotFound
	}

	if len(record.ParticipantOrder) >= store.maxParticipants {
		return BoardSession{}, ErrBoardFull
	}

	if _, exists := record.Participants[participant.ActorID]; exists {
		return BoardSession{}, ErrParticipantAlreadyExists
	}

	record.Participants[participant.ActorID] = participant
	record.ParticipantOrder = append(record.ParticipantOrder, participant.ActorID)
	record.LastActivityAt = now.UTC()

	return snapshotBoard(record, store.maxParticipants), nil
}

func (store *Store) RevokeJoinCode(boardID string, now time.Time) (BoardSession, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	record, exists := store.boardsByID[strings.TrimSpace(boardID)]
	if !exists {
		return BoardSession{}, ErrBoardNotFound
	}

	if store.isExpired(record, now.UTC()) {
		store.deleteBoardLocked(record.BoardID)
		return BoardSession{}, ErrBoardNotFound
	}

	if record.JoinCode == "" {
		return BoardSession{}, ErrJoinCodeNotFound
	}

	delete(store.boardIDsByJoinCode, record.JoinCode)
	record.JoinCode = ""
	record.LastActivityAt = now.UTC()

	return snapshotBoard(record, store.maxParticipants), nil
}

func (store *Store) RemoveParticipant(boardID, actorID string, now time.Time) (BoardSession, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	record, exists := store.boardsByID[strings.TrimSpace(boardID)]
	if !exists {
		return BoardSession{}, ErrBoardNotFound
	}

	if store.isExpired(record, now.UTC()) {
		store.deleteBoardLocked(record.BoardID)
		return BoardSession{}, ErrBoardNotFound
	}

	if _, exists := record.Participants[strings.TrimSpace(actorID)]; !exists {
		return BoardSession{}, ErrParticipantNotFound
	}

	delete(record.Participants, actorID)
	record.ParticipantOrder = removeValue(record.ParticipantOrder, actorID)
	record.LastActivityAt = now.UTC()

	return snapshotBoard(record, store.maxParticipants), nil
}

func (store *Store) TouchBoard(boardID string, now time.Time) (BoardSession, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	record, exists := store.boardsByID[strings.TrimSpace(boardID)]
	if !exists {
		return BoardSession{}, ErrBoardNotFound
	}

	if store.isExpired(record, now.UTC()) {
		store.deleteBoardLocked(record.BoardID)
		return BoardSession{}, ErrBoardNotFound
	}

	record.LastActivityAt = now.UTC()

	return snapshotBoard(record, store.maxParticipants), nil
}

func (store *Store) PruneExpired(now time.Time) []string {
	store.mu.Lock()
	defer store.mu.Unlock()

	expiredBoardIDs := make([]string, 0)
	for boardID, record := range store.boardsByID {
		if !store.isExpired(record, now.UTC()) {
			continue
		}

		expiredBoardIDs = append(expiredBoardIDs, boardID)
		store.deleteBoardLocked(boardID)
	}

	return expiredBoardIDs
}

func normalizeJoinCode(joinCode string) string {
	return strings.ToUpper(strings.TrimSpace(joinCode))
}

func prepareParticipant(participant Participant, expectedRole ParticipantRole, now time.Time) (Participant, error) {
	if strings.TrimSpace(participant.ActorID) == "" {
		return Participant{}, fmt.Errorf("actor id is required")
	}

	if strings.TrimSpace(participant.DeviceID) == "" {
		return Participant{}, fmt.Errorf("device id is required")
	}

	if strings.TrimSpace(participant.Nickname) == "" {
		return Participant{}, fmt.Errorf("nickname is required")
	}

	if participant.Role == "" {
		participant.Role = expectedRole
	}

	if participant.Role != expectedRole {
		return Participant{}, fmt.Errorf("participant role must be %s", expectedRole)
	}

	participant.ActorID = strings.TrimSpace(participant.ActorID)
	participant.DeviceID = strings.TrimSpace(participant.DeviceID)
	participant.Nickname = strings.TrimSpace(participant.Nickname)
	participant.Color = strings.TrimSpace(participant.Color)

	if participant.JoinedAt.IsZero() {
		participant.JoinedAt = now.UTC()
	}

	if participant.LastSeenAt.IsZero() {
		participant.LastSeenAt = now.UTC()
	}

	return participant, nil
}

func snapshotBoard(record *boardRecord, maxParticipants int) BoardSession {
	participants := make([]Participant, 0, len(record.ParticipantOrder))
	for _, actorID := range record.ParticipantOrder {
		participant, exists := record.Participants[actorID]
		if !exists {
			continue
		}

		participants = append(participants, participant)
	}

	return BoardSession{
		BoardID:         record.BoardID,
		JoinCode:        record.JoinCode,
		OwnerActorID:    record.OwnerActorID,
		Participants:    participants,
		MaxParticipants: maxParticipants,
		CreatedAt:       record.CreatedAt,
		LastActivityAt:  record.LastActivityAt,
	}
}

func removeValue(values []string, target string) []string {
	filtered := values[:0]
	for _, value := range values {
		if value == target {
			continue
		}

		filtered = append(filtered, value)
	}

	return filtered
}

func (store *Store) generateUniqueJoinCodeLocked() (string, error) {
	for attempt := 0; attempt < maxJoinCodeGenerationAttempts; attempt++ {
		joinCode, err := generateJoinCode(store.randomSource, store.joinCodeLength)
		if err != nil {
			return "", err
		}

		if _, exists := store.boardIDsByJoinCode[joinCode]; exists {
			continue
		}

		return joinCode, nil
	}

	return "", ErrJoinCodeGenerationFailed
}

func (store *Store) isExpired(record *boardRecord, now time.Time) bool {
	return now.Sub(record.LastActivityAt) >= store.codeTTL
}

func (store *Store) deleteBoardLocked(boardID string) {
	record, exists := store.boardsByID[boardID]
	if !exists {
		return
	}

	delete(store.boardsByID, boardID)
	delete(store.boardIDsByJoinCode, record.JoinCode)
}
