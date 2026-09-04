package openwopclient

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// DefaultHostEventsPath is the documented default address of the hostEvents
// channel (events.md §Host events); a host MAY declare another under
// `heartbeat.deliveryChannel`.
const DefaultHostEventsPath = "/host/events"

// StreamEventsOptions controls a single runEvents SSE subscription.
type StreamEventsOptions struct {
	// StreamMode forwards as the `?streamMode=` query param. Empty =
	// server default ("updates"). For mixed mode, set StreamModes
	// instead — when both are non-empty StreamModes wins.
	StreamMode StreamMode
	// StreamModes forwards as a comma-separated `?streamMode=A,B` query
	// (events.md §The events channel).
	StreamModes []StreamMode
	// LastEventID forwards as the `Last-Event-ID` header; the host resumes at
	// the next sequence and never re-emits the resumption point.
	LastEventID string
	// BufferMs is the batching hint (0..5000). The host accumulates events
	// into one `event: batch` frame whose data is an array; the SDK flattens
	// it back into per-channel sends. Zero = no buffering.
	BufferMs int
}

// HostEventsOptions controls a hostEvents SSE subscription.
type HostEventsOptions struct {
	// Path is the channel address. Empty = DefaultHostEventsPath.
	Path string
	// LastEventID forwards as the `Last-Event-ID` header.
	LastEventID string
}

// StreamEvents opens a GET /runs/{runID}/events subscription and returns a
// receive-only channel that yields each parsed RunEventDoc until the host
// closes the stream (after the run's terminal event) OR ctx is cancelled.
//
// The returned cleanup func MUST be called when the caller is done
// consuming events (typically `defer cleanup()`). Cancelling ctx is
// equivalent — both tear down the underlying HTTP connection. Calling
// the cleanup func twice is safe.
//
// Errors returned synchronously from this function are connection-open
// failures (4xx/5xx, DNS, etc.). Per-frame decode errors are silently
// swallowed (forward-compat: skip non-JSON keep-alives and vendor
// extensions rather than blowing up the consumer).
func (c *OpenwopClient) StreamEvents(
	ctx context.Context,
	runID string,
	opts StreamEventsOptions,
) (<-chan RunEventDoc, func(), error) {
	q := url.Values{}
	if len(opts.StreamModes) > 0 {
		modes := make([]string, len(opts.StreamModes))
		for i, m := range opts.StreamModes {
			modes[i] = string(m)
		}
		q.Set("streamMode", strings.Join(modes, ","))
	} else if opts.StreamMode != "" {
		q.Set("streamMode", string(opts.StreamMode))
	}
	if opts.BufferMs > 0 {
		q.Set("bufferMs", strconv.Itoa(opts.BufferMs))
	}
	qs := ""
	if encoded := q.Encode(); encoded != "" {
		qs = "?" + encoded
	}
	path := "/runs/" + url.PathEscape(runID) + "/events" + qs
	return streamSSE(c, ctx, path, opts.LastEventID, decodeRunEventDoc)
}

// StreamHostEvents opens a GET /host/events subscription — the hostEvents
// channel (heartbeat messages), content-free of run data. Same channel +
// cleanup contract as StreamEvents.
func (c *OpenwopClient) StreamHostEvents(
	ctx context.Context,
	opts HostEventsOptions,
) (<-chan HostEventDoc, func(), error) {
	path := opts.Path
	if path == "" {
		path = DefaultHostEventsPath
	}
	return streamSSE(c, ctx, path, opts.LastEventID, decodeHostEventDoc)
}

func decodeRunEventDoc(raw []byte) (RunEventDoc, bool) {
	var ev RunEventDoc
	if err := json.Unmarshal(raw, &ev); err != nil {
		return ev, false
	}
	if ev.EventID == "" || ev.Type == "" {
		return ev, false
	}
	return ev, true
}

func decodeHostEventDoc(raw []byte) (HostEventDoc, bool) {
	var ev HostEventDoc
	if err := json.Unmarshal(raw, &ev); err != nil {
		return ev, false
	}
	if ev.Type == "" {
		return ev, false
	}
	return ev, true
}

// streamSSE is the shared subscribe + frame parser behind StreamEvents and
// StreamHostEvents. Each frame carries `id:`, `event:` and `data:`; `id:` is
// the sequence and is read from the document itself.
func streamSSE[T any](
	c *OpenwopClient,
	ctx context.Context,
	path string,
	lastEventID string,
	decode func([]byte) (T, bool),
) (<-chan T, func(), error) {
	endpoint := c.BaseURL + path

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, func() {}, err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	// RFC 0172 §A.3 — on every request, the subscribe included.
	req.Header.Set("OpenWOP-Version", c.ProtocolVersion())
	if lastEventID != "" {
		req.Header.Set("Last-Event-ID", lastEventID)
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, func() {}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		return nil, func() {}, newWopError(
			resp.StatusCode,
			string(body),
			parseEnvelope(body),
			resp.Header.Get("Traceparent"),
		)
	}

	out := make(chan T, 16)
	closed := false
	cleanup := func() {
		if closed {
			return
		}
		closed = true
		_ = resp.Body.Close()
	}

	go func() {
		defer close(out)
		defer cleanup()

		scanner := bufio.NewScanner(resp.Body)
		// SSE frames can carry chunks larger than the default 64KB scanner
		// buffer. Bump to 1MB to handle realistic payloads.
		buf := make([]byte, 0, 1024*1024)
		scanner.Buffer(buf, 1024*1024)

		var (
			pendingData  []string
			pendingEvent = "message"
		)

		// sendOne forwards one decoded document to the consumer channel
		// (with a context-cancel select). Skips malformed payloads.
		sendOne := func(raw []byte) {
			ev, ok := decode(raw)
			if !ok {
				return
			}
			select {
			case out <- ev:
			case <-ctx.Done():
			}
		}

		flush := func() {
			if len(pendingData) == 0 {
				pendingEvent = "message"
				return
			}
			raw := strings.Join(pendingData, "\n")
			eventType := pendingEvent
			pendingData = pendingData[:0]
			pendingEvent = "message"

			// Batched envelope — `event: batch` carries an array of documents.
			if eventType == "batch" {
				var batch []json.RawMessage
				if err := json.Unmarshal([]byte(raw), &batch); err == nil {
					for _, item := range batch {
						sendOne(item)
					}
					return
				}
				// Fall through if it parsed as something other than an array —
				// treat as a normal frame for forward-compat.
			}
			sendOne([]byte(raw))
		}

		for scanner.Scan() {
			line := strings.TrimRight(scanner.Text(), "\r")
			if line == "" {
				flush()
				continue
			}
			if strings.HasPrefix(line, ":") {
				continue // SSE comment / keep-alive
			}
			colon := strings.IndexByte(line, ':')
			var field, value string
			if colon == -1 {
				field, value = line, ""
			} else {
				field = line[:colon]
				value = line[colon+1:]
				if strings.HasPrefix(value, " ") {
					value = value[1:]
				}
			}
			switch field {
			case "data":
				pendingData = append(pendingData, value)
			case "event":
				pendingEvent = value
			}
		}
		// Flush any final unterminated frame.
		flush()
	}()

	return out, cleanup, nil
}
