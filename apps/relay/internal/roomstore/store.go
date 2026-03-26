package roomstore

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

var (
	ErrBoardAlreadyExists       = errors.New("board already exists")
	ErrBoardFull                = errors.New("board is full")
	ErrBoardNotFound            = errors.New("board not found")
	ErrInvalidMaxParticipants   = errors.New("max participants must be greater than zero")
	ErrJoinCodeAlreadyExists    = errors.New("join code already exists")
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

func New(maxParticipants int) (*Store, error) {
	if maxParticipants <= 0 {
		return nil, ErrInvalidMaxParticipants
	}

	return &Store{
		maxParticipants:    maxParticipants,
		boardIDsByJoinCode: make(map[string]string),
		boardsByID:         make(map[string]*boardRecord),
	}, nil
}

func (store *Store) CreateBoard(params CreateBoardParams, now time.Time) (BoardSession, error) {
	if strings.TrimSpace(params.BoardID) == "" {
		return BoardSession{}, fmt.Errorf("board id is required")
	}

	joinCode := normalizeJoinCode(params.JoinCode)
	if joinCode == "" {
		return BoardSession{}, fmt.Errorf("join code is required")
	}

	owner, err := prepareParticipant(params.Owner, RoleOwner, now)
	if err != nil {
		return BoardSession{}, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	if _, exists := store.boardsByID[params.BoardID]; exists {
		return BoardSession{}, ErrBoardAlreadyExists
	}

	if _, exists := store.boardIDsByJoinCode[joinCode]; exists {
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
	store.mu.RLock()
	defer store.mu.RUnlock()

	boardID, exists := store.boardIDsByJoinCode[normalizeJoinCode(joinCode)]
	if !exists {
		return BoardSession{}, false
	}

	record := store.boardsByID[boardID]
	if record == nil {
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

func (store *Store) RemoveParticipant(boardID, actorID string, now time.Time) (BoardSession, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	record, exists := store.boardsByID[strings.TrimSpace(boardID)]
	if !exists {
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
