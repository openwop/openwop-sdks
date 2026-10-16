package openwopclient

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultHostEventsPath is the documented default address of the hostEvents
// channel (events.md §Host events); a host MAY declare another under
// `heartbeat.deliveryChannel`.
const DefaultHostEventsPath = "/host/events"

// ReconnectOptions tunes the RFC 0247 resume loop. The zero value enables it
// with the defaults: when a stream ends before the run's terminal event (a
// host's bounded close, a platform or proxy timeout, a dropped connection),
// the SDK reconnects with `Last-Event-ID` set to the last `id:` it received,
// sends `resumable=true` on every connect, and never re-sends an event.
type ReconnectOptions struct {
	// Disabled restores the pre-2.6 behaviour: one connection, no
	// `resumable` query flag, and the channel closes when that connection ends.
	Disabled bool
	// Delay is the wait before a reconnect when the host sent no `retry:`
	// field. Zero = 1s.
	Delay time.Duration
	// MaxDelay caps the exponential backoff applied to failed or empty
	// reconnects. Zero = 30s.
	MaxDelay time.Duration
	// MaxAttempts is the number of consecutive failed reconnects before the
	// stream gives up and the channel closes. Zero = 10.
	MaxAttempts int
	// OnError, when set, receives the error that ended a reconnecting stream
	// (a non-retryable status, or MaxAttempts exhausted) just before the
	// channel closes.
	OnError func(error)
}

// StreamEventsOptions controls a runEvents SSE subscription.
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
	// Reconnect tunes RFC 0247 resumption; the zero value enables it.
	Reconnect ReconnectOptions
}

// HostEventsOptions controls a hostEvents SSE subscription.
type HostEventsOptions struct {
	// Path is the channel address. Empty = DefaultHostEventsPath.
	Path string
	// LastEventID forwards as the `Last-Event-ID` header.
	LastEventID string
	// Reconnect tunes RFC 0247 resumption; the zero value enables it. The
	// channel has no terminal event, so with reconnect on the channel stays
	// open until ctx is cancelled, cleanup is called, or a reconnect fails for
	// good. The cursor is the last durable event's `id:`; ephemeral frames
	// carry none and are never redelivered.
	Reconnect ReconnectOptions
}

// StreamEvents opens a GET /runs/{runID}/events subscription and returns a
// receive-only channel that yields each parsed RunEventDoc through the run's
// terminal event OR until ctx is cancelled. With reconnect on (the default,
// RFC 0247) a stream the host ends early is resumed transparently.
//
// The returned cleanup func MUST be called when the caller is done
// consuming events (typically `defer cleanup()`). Cancelling ctx is
// equivalent — both tear down the underlying HTTP connection. Calling
// the cleanup func twice is safe.
//
// Errors returned synchronously from this function are first-connect
// failures (4xx/5xx, DNS, etc.); later reconnect failures go to
// opts.Reconnect.OnError. Per-frame decode errors are silently
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
	if !opts.Reconnect.Disabled {
		q.Set("resumable", "true")
	}
	qs := ""
	if encoded := q.Encode(); encoded != "" {
		qs = "?" + encoded
	}
	path := "/runs/" + ProjectID(runID) + "/events" + qs
	return streamSSE(c, ctx, path, opts.LastEventID, opts.Reconnect, true, decodeRunEventDoc)
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
	if !opts.Reconnect.Disabled {
		if strings.Contains(path, "?") {
			path += "&resumable=true"
		} else {
			path += "?resumable=true"
		}
	}
	return streamSSE(c, ctx, path, opts.LastEventID, opts.Reconnect, false, decodeHostEventDoc)
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

const (
	// boundedCloseFloor is the RFC 0247 §A floor: a host does not end an
	// opted-in stream early within this long of opening it. A resumed run
	// stream that closes sooner WITHOUT a frame is the events.md answer for a
	// terminal run ("close the stream without a frame"), so the stream ends.
	boundedCloseFloor = 15 * time.Second
	// quickClose: a host-events connection that closes this fast with no
	// frame counts as a failed attempt.
	quickClose = time.Second
)

var errEmptyStream = errors.New("openwop: SSE stream kept closing without data")

func isRetryableStatus(status int) bool {
	return status == 429 || status == 502 || status == 503 || status == 504
}

func isTerminalFrame(eventType string, raw []byte) bool {
	var f struct {
		Type   string `json:"type"`
		Status string `json:"status"`
	}
	if json.Unmarshal(raw, &f) != nil {
		return false
	}
	switch f.Type {
	case "run.completed", "run.failed", "run.cancelled":
		return true
	}
	return eventType == "state.snapshot" && f.Status != "" && IsTerminalRunStatus(f.Status)
}

// retryAfter reads `Retry-After` as delta-seconds or an HTTP date.
func retryAfter(h http.Header) time.Duration {
	raw := strings.TrimSpace(h.Get("Retry-After"))
	if raw == "" {
		return 0
	}
	if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
		return time.Duration(n) * time.Second
	}
	if at, err := http.ParseTime(raw); err == nil {
		if d := time.Until(at); d > 0 {
			return d
		}
	}
	return 0
}

// streamSSE is the shared subscribe + frame parser behind StreamEvents and
// StreamHostEvents. Each frame carries `id:`, `event:` and `data:`; the last
// `id:` received is the resume cursor (RFC 0247).
func streamSSE[T any](
	c *OpenwopClient,
	parent context.Context,
	path string,
	lastEventID string,
	policy ReconnectOptions,
	runStream bool,
	decode func([]byte) (T, bool),
) (<-chan T, func(), error) {
	endpoint := c.BaseURL + path
	ctx, cancel := context.WithCancel(parent)
	cleanup := sync.OnceFunc(cancel)

	connect := func(cursor string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "text/event-stream")
		req.Header.Set("Cache-Control", "no-cache")
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
		// RFC 0172 §A.3 — on every request, the subscribe included.
		req.Header.Set("OpenWOP-Version", c.ProtocolVersion())
		req.Header.Set("OpenWOP-Client-Version", c.ClientVersion())
		if cursor != "" {
			req.Header.Set("Last-Event-ID", cursor)
		}
		resp, err := c.httpClient().Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			return resp, newWopError(
				resp.StatusCode,
				string(body),
				parseEnvelope(body),
				resp.Header.Get("Traceparent"),
			)
		}
		return resp, nil
	}

	// The first connect fails fast, exactly as before RFC 0247.
	resp, err := connect(lastEventID)
	if err != nil {
		cleanup()
		return nil, func() {}, err
	}

	delay := policy.Delay
	if delay <= 0 {
		delay = time.Second
	}
	maxDelay := policy.MaxDelay
	if maxDelay <= 0 {
		maxDelay = 30 * time.Second
	}
	maxAttempts := policy.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 10
	}

	out := make(chan T, 16)
	go func() {
		defer close(out)
		defer cleanup()

		cursor := lastEventID
		retry := delay
		failures := 0
		maxSequence := -1 // duplicate guard behind the exclusive cursor

		// read consumes one connection. It reports the frames seen, whether
		// the terminal event arrived, and a read error (nil on a clean close).
		read := func(body io.ReadCloser) (frames int, terminal bool, readErr error) {
			defer body.Close()
			scanner := bufio.NewScanner(body)
			// SSE frames can carry chunks larger than the default 64KB scanner
			// buffer. Bump to 1MB to handle realistic payloads.
			buf := make([]byte, 0, 1024*1024)
			scanner.Buffer(buf, 1024*1024)

			var (
				pendingData  []string
				pendingEvent = "message"
				pendingID    *string
			)

			// sendOne forwards one decoded document to the consumer channel
			// (with a context-cancel select). Skips malformed payloads and
			// documents already sent on an earlier connection.
			sendOne := func(eventType string, raw []byte) bool {
				frames++
				if runStream {
					var s struct {
						Sequence *int `json:"sequence"`
					}
					if json.Unmarshal(raw, &s) == nil && s.Sequence != nil {
						if *s.Sequence <= maxSequence {
							return true
						}
						maxSequence = *s.Sequence
					}
					if isTerminalFrame(eventType, raw) {
						terminal = true
					}
				}
				ev, ok := decode(raw)
				if !ok {
					return true
				}
				select {
				case out <- ev:
					return true
				case <-ctx.Done():
					return false
				}
			}

			flush := func() bool {
				if pendingID != nil {
					cursor = *pendingID
					pendingID = nil
				}
				if len(pendingData) == 0 {
					pendingEvent = "message"
					return true
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
							if !sendOne(eventType, item) {
								return false
							}
						}
						return true
					}
					// Fall through if it parsed as something other than an array —
					// treat as a normal frame for forward-compat.
				}
				if !json.Valid([]byte(raw)) {
					return true // non-JSON frame (vendor extension)
				}
				return sendOne(eventType, []byte(raw))
			}

			for scanner.Scan() {
				line := strings.TrimRight(scanner.Text(), "\r")
				if line == "" {
					if !flush() || terminal {
						return frames, terminal, nil
					}
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
				case "id":
					if !strings.ContainsRune(value, 0) {
						v := value
						pendingID = &v
					}
				case "retry":
					if ms, err := strconv.Atoi(value); err == nil && ms >= 0 {
						retry = time.Duration(ms) * time.Millisecond
					}
				}
			}
			// Flush any final unterminated frame.
			flush()
			return frames, terminal, scanner.Err()
		}

		for {
			opened := time.Now()
			frames, terminal, failure := read(resp.Body)
			if terminal || ctx.Err() != nil || policy.Disabled {
				return
			}
			var wait, retryAfterNext time.Duration
			for {
				// The connection ended without the terminal event.
				lived := time.Since(opened)
				if failure == nil && frames == 0 {
					if runStream && lived < boundedCloseFloor {
						return
					}
					if !runStream && lived < quickClose {
						failure = errEmptyStream
					}
				}
				wait = retry
				if failure == nil || frames > 0 {
					failures = 0
				} else {
					failures++
					if failures > maxAttempts {
						if policy.OnError != nil {
							policy.OnError(failure)
						}
						return
					}
					if wait <= 0 {
						wait = time.Millisecond
					}
					for i := 1; i < failures && wait < maxDelay; i++ {
						wait *= 2
					}
					if wait > maxDelay {
						wait = maxDelay
					}
				}
				if retryAfterNext > wait {
					wait = retryAfterNext
				}
				retryAfterNext = 0
				select {
				case <-time.After(wait):
				case <-ctx.Done():
					return
				}
				opened = time.Now()
				frames = 0
				next, err := connect(cursor)
				if err == nil {
					resp = next
					break
				}
				if ctx.Err() != nil {
					return
				}
				var wopErr *WopError
				if errors.As(err, &wopErr) && !isRetryableStatus(wopErr.Status) {
					if policy.OnError != nil {
						policy.OnError(err)
					}
					return
				}
				if next != nil {
					retryAfterNext = retryAfter(next.Header)
				}
				failure = err
			}
		}
	}()

	return out, cleanup, nil
}
