package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"whiteboard-relay/internal/config"
	"whiteboard-relay/internal/httpapi"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil)).With("component", "relay.server")
	startedAt := time.Now().UTC()
	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load relay configuration", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.NewRouter(startedAt, cfg, logger),
		ReadHeaderTimeout: 5 * time.Second,
	}

	shutdownSignals, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info(
			"relay server starting",
			"addr",
			server.Addr,
			"max_participants_per_board",
			cfg.MaxParticipantsPerBoard,
			"join_code_length",
			cfg.JoinCodeLength,
		)

		err := server.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("relay server stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	<-shutdownSignals.Done()
	logger.Info("relay server shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("relay server shutdown failed", "error", err)
		os.Exit(1)
	}

	logger.Info("relay server stopped")
}
