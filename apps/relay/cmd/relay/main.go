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

	"whiteboard-relay/internal/httpapi"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	startedAt := time.Now().UTC()

	server := &http.Server{
		Addr:              envOrDefault("RELAY_ADDR", ":8080"),
		Handler:           httpapi.NewRouter(startedAt),
		ReadHeaderTimeout: 5 * time.Second,
	}

	shutdownSignals, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("relay server starting", "addr", server.Addr)

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

func envOrDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}
