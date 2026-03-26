package roomstore

import (
	"errors"
	"testing"
	"time"
)

func TestStoreCreateBoardAndLookupByJoinCode(t *testing.T) {
	t.Parallel()

	store, err := New(4)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	now := time.Date(2026, time.March, 26, 10, 30, 0, 0, time.UTC)
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

	store, err := New(2)
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

	joined, err := store.JoinBoard(JoinBoardParams{
		JoinCode: "A7F3KQ9X",
		Participant: Participant{
			ActorID:  "guest_1",
			DeviceID: "device_guest_1",
			Nickname: "Guest 1",
			Role:     RoleGuest,
			Color:    "#22c55e",
		},
	}, now.Add(30*time.Second))
	if err != nil {
		t.Fatalf("JoinBoard() error = %v", err)
	}

	if len(joined.Participants) != 2 {
		t.Fatalf("JoinBoard() participants len = %d, want 2", len(joined.Participants))
	}

	_, err = store.JoinBoard(JoinBoardParams{
		JoinCode: "A7F3KQ9X",
		Participant: Participant{
			ActorID:  "guest_2",
			DeviceID: "device_guest_2",
			Nickname: "Guest 2",
			Role:     RoleGuest,
			Color:    "#38bdf8",
		},
	}, now.Add(time.Minute))
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
