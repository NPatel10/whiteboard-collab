package roomstore

import "time"

const defaultCodeTTL = 24 * time.Hour

func WithCodeTTL(ttl time.Duration) Option {
	return func(store *Store) error {
		if ttl <= 0 {
			return ErrInvalidCodeTTL
		}

		store.codeTTL = ttl
		return nil
	}
}

func WithNowFunc(now func() time.Time) Option {
	return func(store *Store) error {
		if now == nil {
			return ErrInvalidNowFunc
		}

		store.now = now
		return nil
	}
}
