package tooling

import (
	"encoding/json"
	"testing"
)

func LogMetadata(t *testing.T, value interface{}) {
	t.Helper()

	jsonValue, err := json.Marshal(value)
	if err != nil {
		t.Errorf("Failed to encode value: %v", err)
		return
	}
	t.Logf("--- META: %s", string(jsonValue))
}

func LogVersion(t *testing.T) {
	LogMetadata(t, struct {
		Version string `json:"version"`
	}{
		Version: Version,
	})
}

func LogJobURL(t *testing.T) {
	LogMetadata(t, struct {
		JobURL string `json:"job_url"`
	}{
		JobURL: JobURL,
	})
}
