package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultAddr                    = ":8080"
	defaultMaxParticipantsPerBoard = 4
	defaultJoinCodeLength          = 8
	defaultCodeTTLSeconds          = 24 * 60 * 60
	defaultHeartbeatIntervalSecs   = 25
)

type Config struct {
	Addr                    string
	MaxParticipantsPerBoard int
	JoinCodeLength          int
	CodeTTL                 time.Duration
	HeartbeatInterval       time.Duration
}

func Load() (Config, error) {
	maxParticipantsPerBoard, err := getIntEnv(
		"RELAY_MAX_PARTICIPANTS_PER_BOARD",
		defaultMaxParticipantsPerBoard,
	)
	if err != nil {
		return Config{}, err
	}

	joinCodeLength, err := getIntEnv("RELAY_JOIN_CODE_LENGTH", defaultJoinCodeLength)
	if err != nil {
		return Config{}, err
	}

	codeTTLSeconds, err := getIntEnv("RELAY_CODE_TTL_SECONDS", defaultCodeTTLSeconds)
	if err != nil {
		return Config{}, err
	}

	heartbeatIntervalSecs, err := getIntEnv(
		"RELAY_HEARTBEAT_INTERVAL_SECONDS",
		defaultHeartbeatIntervalSecs,
	)
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		Addr:                    getStringEnv("RELAY_ADDR", defaultAddr),
		MaxParticipantsPerBoard: maxParticipantsPerBoard,
		JoinCodeLength:          joinCodeLength,
		CodeTTL:                 time.Duration(codeTTLSeconds) * time.Second,
		HeartbeatInterval:       time.Duration(heartbeatIntervalSecs) * time.Second,
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func (cfg Config) Validate() error {
	switch {
	case cfg.Addr == "":
		return fmt.Errorf("RELAY_ADDR must not be empty")
	case cfg.MaxParticipantsPerBoard <= 0:
		return fmt.Errorf("RELAY_MAX_PARTICIPANTS_PER_BOARD must be greater than 0")
	case cfg.JoinCodeLength <= 0:
		return fmt.Errorf("RELAY_JOIN_CODE_LENGTH must be greater than 0")
	case cfg.CodeTTL <= 0:
		return fmt.Errorf("RELAY_CODE_TTL_SECONDS must be greater than 0")
	case cfg.HeartbeatInterval <= 0:
		return fmt.Errorf("RELAY_HEARTBEAT_INTERVAL_SECONDS must be greater than 0")
	default:
		return nil
	}
}

func (cfg Config) CodeTTLSeconds() int {
	return int(cfg.CodeTTL.Seconds())
}

func (cfg Config) HeartbeatIntervalSeconds() int {
	return int(cfg.HeartbeatInterval.Seconds())
}

func getStringEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	return value
}

func getIntEnv(key string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}

	parsedValue, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer: %w", key, err)
	}

	return parsedValue, nil
}
