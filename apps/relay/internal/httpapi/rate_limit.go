package httpapi

import (
	"net"
	"strings"
	"sync"
	"time"
)

const (
	defaultSessionCreateRateLimitPerIP = 20
	defaultSessionJoinRateLimitPerIP   = 20
	defaultSessionJoinRateLimitPerCode = 10
	defaultRateLimitWindow             = time.Minute
)

type websocketRateLimits struct {
	sessionCreateByIP *fixedWindowRateLimiter
	sessionJoinByIP   *fixedWindowRateLimiter
	sessionJoinByCode *fixedWindowRateLimiter
}

func newWebsocketRateLimits(now func() time.Time) *websocketRateLimits {
	return newWebsocketRateLimitsWithConfig(
		now,
		defaultSessionCreateRateLimitPerIP,
		defaultSessionJoinRateLimitPerIP,
		defaultSessionJoinRateLimitPerCode,
		defaultRateLimitWindow,
	)
}

func newWebsocketRateLimitsWithConfig(
	now func() time.Time,
	sessionCreateByIPLimit int,
	sessionJoinByIPLimit int,
	sessionJoinByCodeLimit int,
	window time.Duration,
) *websocketRateLimits {
	return &websocketRateLimits{
		sessionCreateByIP: newFixedWindowRateLimiter(sessionCreateByIPLimit, window, now),
		sessionJoinByIP:   newFixedWindowRateLimiter(sessionJoinByIPLimit, window, now),
		sessionJoinByCode: newFixedWindowRateLimiter(sessionJoinByCodeLimit, window, now),
	}
}

func (limits *websocketRateLimits) allowSessionCreate(remoteAddr string) bool {
	if limits == nil || limits.sessionCreateByIP == nil {
		return true
	}

	return limits.sessionCreateByIP.Allow(normalizeRateLimitIP(remoteAddr))
}

func (limits *websocketRateLimits) allowSessionJoinByIP(remoteAddr string) bool {
	if limits == nil || limits.sessionJoinByIP == nil {
		return true
	}

	return limits.sessionJoinByIP.Allow(normalizeRateLimitIP(remoteAddr))
}

func (limits *websocketRateLimits) allowSessionJoinByCode(joinCode string) bool {
	if limits == nil || limits.sessionJoinByCode == nil {
		return true
	}

	return limits.sessionJoinByCode.Allow(strings.ToUpper(strings.TrimSpace(joinCode)))
}

type fixedWindowRateLimiter struct {
	mu          sync.Mutex
	limit       int
	window      time.Duration
	now         func() time.Time
	windowStart map[string]time.Time
	counts      map[string]int
}

func newFixedWindowRateLimiter(limit int, window time.Duration, now func() time.Time) *fixedWindowRateLimiter {
	if now == nil {
		now = time.Now
	}

	return &fixedWindowRateLimiter{
		limit:       limit,
		window:      window,
		now:         now,
		windowStart: make(map[string]time.Time),
		counts:      make(map[string]int),
	}
}

func (limiter *fixedWindowRateLimiter) Allow(key string) bool {
	if limiter == nil || limiter.limit <= 0 || limiter.window <= 0 {
		return true
	}

	normalizedKey := strings.TrimSpace(key)
	if normalizedKey == "" {
		normalizedKey = "unknown"
	}

	now := limiter.now().UTC()

	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	windowStart, exists := limiter.windowStart[normalizedKey]
	if !exists || now.Sub(windowStart) >= limiter.window {
		limiter.windowStart[normalizedKey] = now
		limiter.counts[normalizedKey] = 0
	}

	if limiter.counts[normalizedKey] >= limiter.limit {
		return false
	}

	limiter.counts[normalizedKey]++
	return true
}

func normalizeRateLimitIP(remoteAddr string) string {
	trimmedRemoteAddr := strings.TrimSpace(remoteAddr)
	if trimmedRemoteAddr == "" {
		return "unknown"
	}

	host, _, err := net.SplitHostPort(trimmedRemoteAddr)
	if err != nil {
		return trimmedRemoteAddr
	}

	if host == "" {
		return "unknown"
	}

	return host
}
