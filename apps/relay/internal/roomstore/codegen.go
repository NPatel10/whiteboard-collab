package roomstore

import (
	"crypto/rand"
	"fmt"
	"io"
)

const (
	defaultJoinCodeLength         = 8
	maxJoinCodeGenerationAttempts = 32
	joinCodeAlphabet              = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)

func WithJoinCodeLength(length int) Option {
	return func(store *Store) error {
		if length <= 0 {
			return ErrInvalidJoinCodeLength
		}

		store.joinCodeLength = length
		return nil
	}
}

func WithRandomSource(reader io.Reader) Option {
	return func(store *Store) error {
		if reader == nil {
			return fmt.Errorf("random source is required")
		}

		store.randomSource = reader
		return nil
	}
}

func newDefaultRandomSource() io.Reader {
	return rand.Reader
}

func generateJoinCode(reader io.Reader, length int) (string, error) {
	if length <= 0 {
		return "", ErrInvalidJoinCodeLength
	}

	randomBytes := make([]byte, length)
	if _, err := io.ReadFull(reader, randomBytes); err != nil {
		return "", fmt.Errorf("read random join code bytes: %w", err)
	}

	code := make([]byte, length)
	for index, value := range randomBytes {
		code[index] = joinCodeAlphabet[int(value)%len(joinCodeAlphabet)]
	}

	return string(code), nil
}
