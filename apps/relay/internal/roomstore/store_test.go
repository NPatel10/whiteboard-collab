package roomstore

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestStoreCreateBoardAndLookupByJoinCode(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.March, 26, 10, 30, 0, 0, time.UTC)
	store, err := New(4, WithNowFunc(func() time.Time {
		return now
	}))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	created, err := store.CreateBoard(CreateBoardParams{
		BoardID:  "board_1",
		JoinCode: "a7f3kq9x",
		Owner: Participant{
			ActorID:  "owner_1",
			DeviceID: "device_owner_1",
			Nickname: "Owner",
			Role:     RoleOwner,
			Color:    "#f97316",
		},
	}, now)
	if err != nil {
		t.Fatalf("CreateBoard() error = %v", err)
	}

	if created.JoinCode != "A7F3KQ9X" {
		t.Fatalf("CreateBoard() join code = %q, want %q", created.JoinCode, "A7F3KQ9X")
	}

	loaded, ok := store.GetBoardByJoinCode("a7f3kq9x")
	if !ok {
		t.Fatal("GetBoardByJoinCode() returned ok = false, want true")
	}

	if loaded.BoardID != "board_1" {
		t.Fatalf("GetBoardByJoinCode() board id = %q, want %q", loaded.BoardID, "board_1")
	}

	if len(loaded.Participants) != 1 {
		t.Fatalf("GetBoardByJoinCode() participants len = %d, want 1", len(loaded.Participants))
	}

	if loaded.Participants[0].ActorID != "owner_1" {
		t.Fatalf("GetBoardByJoinCode() owner actor id = %q, want %q", loaded.Participants[0].ActorID, "owner_1")
	}
}

func TestStoreJoinBoardHonorsCapacity(t *testing.T) {
	t.Parallel()

	store, err := New(4)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	now := time.Date(2026, time.March, 26, 10, 30, 0, 0, time.UTC)
	_, err = store.CreateBoard(CreateBoardParams{
		BoardID:  "board_1",
		JoinCode: "A7F3KQ9X",
		Owner: Participant{
			ActorID:  "owner_1",
			DeviceID: "device_owner_1",
			Nickname: "Owner",
			Role:     RoleOwner,
			Color:    "#f97316",
		},
	}, now)
	if err != nil {
		t.Fatalf("CreateBoard() error = %v", err)
	}

	for index, actorID := range []string{"guest_1", "guest_2", "guest_3"} {
		joined, err := store.JoinBoard(JoinBoardParams{
			JoinCode: "A7F3KQ9X",
			Participant: Participant{
				ActorID:  actorID,
				DeviceID: "device_" + actorID,
				Nickname: "Guest " + string(rune('1'+index)),
				Role:     RoleGuest,
				Color:    "#22c55e",
			},
		}, now.Add(time.Duration(index+1)*30*time.Second))
		if err != nil {
			t.Fatalf("JoinBoard() guest %d error = %v", index+1, err)
		}

		if got, want := len(joined.Participants), index+2; got != want {
			t.Fatalf("JoinBoard() participants len = %d, want %d", got, want)
		}
	}

	_, err = store.JoinBoard(JoinBoardParams{
		JoinCode: "A7F3KQ9X",
		Participant: Participant{
			ActorID:  "guest_4",
			DeviceID: "device_guest_4",
			Nickname: "Guest 4",
			Role:     RoleGuest,
			Color:    "#38bdf8",
		},
	}, now.Add(2*time.Minute))
	if !errors.Is(err, ErrBoardFull) {
		t.Fatalf("JoinBoard() error = %v, want %v", err, ErrBoardFull)
	}
}

func TestStoreRejectsDuplicateJoinCodesAndRemovesParticipants(t *testing.T) {
	t.Parallel()

	store, err := New(4)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	now := time.Date(2026, time.March, 26, 10, 30, 0, 0, time.UTC)
	_, err = store.CreateBoard(CreateBoardParams{
		BoardID:  "board_1",
		JoinCode: "A7F3KQ9X",
		Owner: Participant{
			ActorID:  "owner_1",
			DeviceID: "device_owner_1",
			Nickname: "Owner",
			Role:     RoleOwner,
			Color:    "#f97316",
		},
	}, now)
	if err != nil {
		t.Fatalf("CreateBoard() error = %v", err)
	}

	_, err = store.CreateBoard(CreateBoardParams{
		BoardID:  "board_2",
		JoinCode: "A7F3KQ9X",
		Owner: Participant{
			ActorID:  "owner_2",
			DeviceID: "device_owner_2",
			Nickname: "Owner 2",
			Role:     RoleOwner,
			Color:    "#8b5cf6",
		},
	}, now)
	if !errors.Is(err, ErrJoinCodeAlreadyExists) {
		t.Fatalf("CreateBoard() error = %v, want %v", err, ErrJoinCodeAlreadyExists)
	}

	_, err = store.JoinBoard(JoinBoardParams{
		JoinCode: "A7F3KQ9X",
		Participant: Participant{
			ActorID:  "guest_1",
			DeviceID: "device_guest_1",
			Nickname: "Guest 1",
			Role:     RoleGuest,
			Color:    "#22c55e",
		},
	}, now.Add(15*time.Second))
	if err != nil {
		t.Fatalf("JoinBoard() error = %v", err)
	}

	updated, err := store.RemoveParticipant("board_1", "guest_1", now.Add(45*time.Second))
	if err != nil {
		t.Fatalf("RemoveParticipant() error = %v", err)
	}

	if len(updated.Participants) != 1 {
		t.Fatalf("RemoveParticipant() participants len = %d, want 1", len(updated.Participants))
	}

	if updated.Participants[0].ActorID != "owner_1" {
		t.Fatalf("RemoveParticipant() owner actor id = %q, want %q", updated.Participants[0].ActorID, "owner_1")
	}
}

func TestStoreRevokesJoinCodeAndBlocksFutureJoins(t *testing.T) {
	t.Parallel()

	store, err := New(4)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	now := time.Date(2026, time.March, 26, 10, 30, 0, 0, time.UTC)
	created, err := store.CreateBoard(CreateBoardParams{
		BoardID:  "board_1",
		JoinCode: "A7F3KQ9X",
		Owner: Participant{
			ActorID:  "owner_1",
			DeviceID: "device_owner_1",
			Nickname: "Owner",
			Role:     RoleOwner,
			Color:    "#f97316",
		},
	}, now)
	if err != nil {
		t.Fatalf("CreateBoard() error = %v", err)
	}

	_, err = store.JoinBoard(JoinBoardParams{
		JoinCode: created.JoinCode,
		Participant: Participant{
			ActorID:  "guest_1",
			DeviceID: "device_guest_1",
			Nickname: "Guest 1",
			Role:     RoleGuest,
			Color:    "#22c55e",
		},
	}, now.Add(15*time.Second))
	if err != nil {
		t.Fatalf("JoinBoard() error = %v", err)
	}

	revoked, err := store.RevokeJoinCode(created.BoardID, now.Add(30*time.Second))
	if err != nil {
		t.Fatalf("RevokeJoinCode() error = %v", err)
	}

	if revoked.JoinCode != "" {
		t.Fatalf("RevokeJoinCode() join code = %q, want empty", revoked.JoinCode)
	}

	if len(revoked.Participants) != 2 {
		t.Fatalf("RevokeJoinCode() participants len = %d, want 2", len(revoked.Participants))
	}

	if _, ok := store.GetBoardByJoinCode(created.JoinCode); ok {
		t.Fatal("GetBoardByJoinCode() returned ok = true, want false after revocation")
	}

	if _, err := store.JoinBoard(JoinBoardParams{
		JoinCode: created.JoinCode,
		Participant: Participant{
			ActorID:  "guest_2",
			DeviceID: "device_guest_2",
			Nickname: "Guest 2",
			Role:     RoleGuest,
			Color:    "#38bdf8",
		},
	}, now.Add(45*time.Second)); !errors.Is(err, ErrJoinCodeNotFound) {
		t.Fatalf("JoinBoard() error = %v, want %v", err, ErrJoinCodeNotFound)
	}
}

func TestStoreGeneratesEightCharacterAlphanumericJoinCodes(t *testing.T) {
	t.Parallel()

	store, err := New(4, WithRandomSource(bytes.NewReader([]byte{0, 1, 2, 3, 4, 5, 6, 7})))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	now := time.Date(2026, time.March, 26, 10, 30, 0, 0, time.UTC)
	created, err := store.CreateBoard(CreateBoardParams{
		BoardID: "board_1",
		Owner: Participant{
			ActorID:  "owner_1",
			DeviceID: "device_owner_1",
			Nickname: "Owner",
			Role:     RoleOwner,
			Color:    "#f97316",
		},
	}, now)
	if err != nil {
		t.Fatalf("CreateBoard() error = %v", err)
	}

	if len(created.JoinCode) != 8 {
		t.Fatalf("CreateBoard() join code length = %d, want 8", len(created.JoinCode))
	}

	for _, character := range created.JoinCode {
		if !strings.ContainsRune(joinCodeAlphabet, character) {
			t.Fatalf("CreateBoard() join code = %q, found non-alphanumeric character %q", created.JoinCode, string(character))
		}
	}
}

func TestStoreRetriesJoinCodeGenerationCollisions(t *testing.T) {
	t.Parallel()

	randomBytes := append(bytes.Repeat([]byte{0}, 8), append(bytes.Repeat([]byte{0}, 8), bytes.Repeat([]byte{1}, 8)...)...)
	store, err := New(4, WithRandomSource(bytes.NewReader(randomBytes)))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	now := time.Date(2026, time.March, 26, 10, 30, 0, 0, time.UTC)
	first, err := store.CreateBoard(CreateBoardParams{
		BoardID: "board_1",
		Owner: Participant{
			ActorID:  "owner_1",
			DeviceID: "device_owner_1",
			Nickname: "Owner",
			Role:     RoleOwner,
			Color:    "#f97316",
		},
	}, now)
	if err != nil {
		t.Fatalf("CreateBoard() first error = %v", err)
	}

	second, err := store.CreateBoard(CreateBoardParams{
		BoardID: "board_2",
		Owner: Participant{
			ActorID:  "owner_2",
			DeviceID: "device_owner_2",
			Nickname: "Owner 2",
			Role:     RoleOwner,
			Color:    "#8b5cf6",
		},
	}, now.Add(time.Second))
	if err != nil {
		t.Fatalf("CreateBoard() second error = %v", err)
	}

	if first.JoinCode != "AAAAAAAA" {
		t.Fatalf("CreateBoard() first join code = %q, want %q", first.JoinCode, "AAAAAAAA")
	}

	if second.JoinCode != "BBBBBBBB" {
		t.Fatalf("CreateBoard() second join code = %q, want %q", second.JoinCode, "BBBBBBBB")
	}
}

func TestStoreExpiresBoardsBasedOnLastActivity(t *testing.T) {
	t.Parallel()

	currentNow := time.Date(2026, time.March, 26, 10, 30, 0, 0, time.UTC)
	store, err := New(4, WithCodeTTL(time.Hour), WithNowFunc(func() time.Time {
		return currentNow
	}))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	created, err := store.CreateBoard(CreateBoardParams{
		BoardID: "board_1",
		Owner: Participant{
			ActorID:  "owner_1",
			DeviceID: "device_owner_1",
			Nickname: "Owner",
			Role:     RoleOwner,
			Color:    "#f97316",
		},
	}, currentNow)
	if err != nil {
		t.Fatalf("CreateBoard() error = %v", err)
	}

	currentNow = currentNow.Add(time.Hour)

	if _, ok := store.GetBoardByJoinCode(created.JoinCode); ok {
		t.Fatal("GetBoardByJoinCode() returned ok = true, want false for expired board")
	}

	if _, err := store.JoinBoard(JoinBoardParams{
		JoinCode: created.JoinCode,
		Participant: Participant{
			ActorID:  "guest_1",
			DeviceID: "device_guest_1",
			Nickname: "Guest 1",
			Role:     RoleGuest,
			Color:    "#22c55e",
		},
	}, currentNow); !errors.Is(err, ErrJoinCodeNotFound) {
		t.Fatalf("JoinBoard() error = %v, want %v", err, ErrJoinCodeNotFound)
	}
}

func TestStoreTouchBoardRefreshesExpiryWindow(t *testing.T) {
	t.Parallel()

	currentNow := time.Date(2026, time.March, 26, 10, 30, 0, 0, time.UTC)
	store, err := New(4, WithCodeTTL(time.Hour), WithNowFunc(func() time.Time {
		return currentNow
	}))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	created, err := store.CreateBoard(CreateBoardParams{
		BoardID: "board_1",
		Owner: Participant{
			ActorID:  "owner_1",
			DeviceID: "device_owner_1",
			Nickname: "Owner",
			Role:     RoleOwner,
			Color:    "#f97316",
		},
	}, currentNow)
	if err != nil {
		t.Fatalf("CreateBoard() error = %v", err)
	}

	touchedAt := currentNow.Add(50 * time.Minute)
	touched, err := store.TouchBoard(created.BoardID, touchedAt)
	if err != nil {
		t.Fatalf("TouchBoard() error = %v", err)
	}

	if !touched.LastActivityAt.Equal(touchedAt) {
		t.Fatalf("TouchBoard() last activity = %v, want %v", touched.LastActivityAt, touchedAt)
	}

	currentNow = currentNow.Add(80 * time.Minute)
	if _, ok := store.GetBoardByJoinCode(created.JoinCode); !ok {
		t.Fatal("GetBoardByJoinCode() returned ok = false, want true after touch refresh")
	}

	currentNow = currentNow.Add(31 * time.Minute)
	if _, ok := store.GetBoardByJoinCode(created.JoinCode); ok {
		t.Fatal("GetBoardByJoinCode() returned ok = true, want false after refreshed ttl elapsed")
	}
}

func TestStorePruneExpiredRemovesOnlyExpiredBoards(t *testing.T) {
	t.Parallel()

	currentNow := time.Date(2026, time.March, 26, 10, 30, 0, 0, time.UTC)
	store, err := New(4, WithCodeTTL(time.Hour), WithNowFunc(func() time.Time {
		return currentNow
	}))
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	expiredBoard, err := store.CreateBoard(CreateBoardParams{
		BoardID: "board_expired",
		Owner: Participant{
			ActorID:  "owner_1",
			DeviceID: "device_owner_1",
			Nickname: "Owner",
			Role:     RoleOwner,
			Color:    "#f97316",
		},
	}, currentNow)
	if err != nil {
		t.Fatalf("CreateBoard() expired board error = %v", err)
	}

	activeBoard, err := store.CreateBoard(CreateBoardParams{
		BoardID: "board_active",
		Owner: Participant{
			ActorID:  "owner_2",
			DeviceID: "device_owner_2",
			Nickname: "Owner 2",
			Role:     RoleOwner,
			Color:    "#8b5cf6",
		},
	}, currentNow.Add(30*time.Minute))
	if err != nil {
		t.Fatalf("CreateBoard() active board error = %v", err)
	}

	prunedBoardIDs := store.PruneExpired(currentNow.Add(89 * time.Minute))
	if len(prunedBoardIDs) != 1 || prunedBoardIDs[0] != expiredBoard.BoardID {
		t.Fatalf("PruneExpired() board ids = %v, want [%s]", prunedBoardIDs, expiredBoard.BoardID)
	}

	if _, ok := store.GetBoardByJoinCode(expiredBoard.JoinCode); ok {
		t.Fatal("GetBoardByJoinCode() returned ok = true, want false for pruned board")
	}

	currentNow = currentNow.Add(89 * time.Minute)
	if _, ok := store.GetBoardByJoinCode(activeBoard.JoinCode); !ok {
		t.Fatal("GetBoardByJoinCode() returned ok = false, want true for active board")
	}
}
