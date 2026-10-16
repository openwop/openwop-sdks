package openwopclient

// RFC 0247 — resumable SSE streams. A host may end an opted-in stream before
// the run's terminal event, and platforms end long streams regardless. The
// SDK must resume with `Last-Event-ID` = the last `id:` it received, honour
// `retry:`, never re-send an event, and stop at the terminal event.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"
)

// step is one scripted connect: a status (0 = 200) plus a body, or drop to
// hang up mid-stream without a clean end.
type step struct {
	status  int
	body    string
	headers map[string]string
	drop    bool
}

type scriptedServer struct {
	*httptest.Server
	mu   sync.Mutex
	seen []*http.Request
}

func newScripted(t *testing.T, steps []step) *scriptedServer {
	t.Helper()
	s := &scriptedServer{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.seen = append(s.seen, r.Clone(context.Background()))
		n := len(s.seen)
		s.mu.Unlock()
		if n > len(steps) {
			t.Errorf("unexpected connect #%d", n)
			w.WriteHeader(500)
			return
		}
		st := steps[n-1]
		for k, v := range st.headers {
			w.Header().Set(k, v)
		}
		if st.status != 0 && st.status != 200 {
			w.WriteHeader(st.status)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if st.drop {
			// Promise more bytes than are sent: the client sees an unexpected EOF.
			w.Header().Set("Content-Length", "1000")
			_, _ = w.Write([]byte(st.body))
			return
		}
		_, _ = w.Write([]byte(st.body))
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *scriptedServer) lastIDs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, len(s.seen))
	for i, r := range s.seen {
		out[i] = r.Header.Get("Last-Event-ID")
	}
	return out
}

func (s *scriptedServer) connects() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.seen)
}

func evFrame(seq int, typ string) string {
	doc, _ := json.Marshal(map[string]any{"eventId": fmt.Sprintf("e%d", seq), "runId": "t/r1", "type": typ, "payload": map[string]any{}, "timestamp": "t", "sequence": seq, "schemaVersion": 1})
	return fmt.Sprintf("id: %d\nevent: %s\ndata: %s\n\n", seq, typ, doc)
}

var fast = ReconnectOptions{Delay: time.Millisecond, MaxDelay: 4 * time.Millisecond, MaxAttempts: 3}

func collectRun(t *testing.T, srv *scriptedServer, opts StreamEventsOptions) []string {
	t.Helper()
	client, _ := NewClient(srv.URL, "k")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	events, cleanup, err := client.StreamEvents(ctx, "t/r1", opts)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	var out []string
	for ev := range events {
		out = append(out, fmt.Sprintf("%d:%s", ev.Sequence, ev.Type))
	}
	if ctx.Err() != nil {
		t.Fatal("stream did not end on its own")
	}
	return out
}

func TestStreamEventsResumesWithLastIDHonoursRetryNoDuplicates(t *testing.T) {
	srv := newScripted(t, []step{
		{body: "retry: 5\n\n" + evFrame(0, "run.started") + evFrame(1, "node.started")},
		{body: evFrame(1, "node.started") + evFrame(2, "node.completed")}, // re-sent resumption point is guarded
		{body: evFrame(3, "run.completed")},
	})
	start := time.Now()
	got := collectRun(t, srv, StreamEventsOptions{Reconnect: fast})
	want := []string{"0:run.started", "1:node.started", "2:node.completed", "3:run.completed"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("events %v, want %v", got, want)
	}
	if ids := srv.lastIDs(); !reflect.DeepEqual(ids, []string{"", "1", "2"}) {
		t.Fatalf("Last-Event-ID per connect %q", ids)
	}
	for _, r := range srv.seen {
		if r.URL.Query().Get("resumable") != "true" {
			t.Fatalf("connect without resumable=true: %s", r.URL)
		}
	}
	if time.Since(start) < 9*time.Millisecond {
		t.Fatal("the host's retry: 5 was not honoured")
	}
}

func TestStreamEventsResumesFromCallerIDAndBatchID(t *testing.T) {
	batch := `id: 6` + "\nevent: batch\ndata: " + `[{"eventId":"e5","type":"node.started","sequence":5},{"eventId":"e6","type":"node.started","sequence":6}]` + "\n\n"
	srv := newScripted(t, []step{{body: batch}, {body: evFrame(7, "run.failed")}})
	got := collectRun(t, srv, StreamEventsOptions{LastEventID: "4", Reconnect: fast})
	if !reflect.DeepEqual(got, []string{"5:node.started", "6:node.started", "7:run.failed"}) {
		t.Fatalf("events %v", got)
	}
	if ids := srv.lastIDs(); !reflect.DeepEqual(ids, []string{"4", "6"}) {
		t.Fatalf("Last-Event-ID per connect %q", ids)
	}
}

func TestStreamEventsEndsWhenTerminalRunResumeClosesAtOnce(t *testing.T) {
	srv := newScripted(t, []step{{body: evFrame(0, "run.started")}, {body: ": keep-alive\n\n"}})
	if got := collectRun(t, srv, StreamEventsOptions{Reconnect: fast}); !reflect.DeepEqual(got, []string{"0:run.started"}) {
		t.Fatalf("events %v", got)
	}
	if srv.connects() != 2 {
		t.Fatalf("connects %d", srv.connects())
	}
}

func TestStreamEventsEndsAtTerminalSnapshot(t *testing.T) {
	snap := func(st string) string {
		return "id: 2\nevent: state.snapshot\ndata: {\"runId\":\"t/r1\",\"status\":\"" + st + "\"}\n\n"
	}
	srv := newScripted(t, []step{{body: snap("running")}, {body: snap("completed")}})
	collectRun(t, srv, StreamEventsOptions{StreamMode: "values", Reconnect: fast})
	if srv.connects() != 2 {
		t.Fatalf("connects %d", srv.connects())
	}
}

func TestStreamEventsRetriesDropAnd503(t *testing.T) {
	srv := newScripted(t, []step{
		{body: evFrame(0, "run.started")},
		{body: evFrame(0, "run.started")[:5], drop: true},
		{status: 503, headers: map[string]string{"Retry-After": "0"}},
		{body: evFrame(1, "run.cancelled")},
	})
	if got := collectRun(t, srv, StreamEventsOptions{Reconnect: fast}); !reflect.DeepEqual(got, []string{"0:run.started", "1:run.cancelled"}) {
		t.Fatalf("events %v", got)
	}
	if ids := srv.lastIDs(); !reflect.DeepEqual(ids, []string{"", "0", "0", "0"}) {
		t.Fatalf("Last-Event-ID per connect %q", ids)
	}
}

func TestStreamEventsStopsOnNonRetryableStatus(t *testing.T) {
	srv := newScripted(t, []step{{body: evFrame(0, "run.started")}, {status: 403}})
	var gotErr error
	opts := fast
	opts.OnError = func(err error) { gotErr = err }
	collectRun(t, srv, StreamEventsOptions{Reconnect: opts})
	if we, ok := gotErr.(*WopError); !ok || we.Status != 403 {
		t.Fatalf("OnError got %v", gotErr)
	}
	if srv.connects() != 2 {
		t.Fatalf("connects %d", srv.connects())
	}
}

func TestStreamEventsGivesUpAfterMaxAttempts(t *testing.T) {
	srv := newScripted(t, []step{{body: evFrame(0, "run.started")}, {status: 503}, {status: 503}, {status: 503}, {status: 503}})
	var gotErr error
	opts := fast
	opts.OnError = func(err error) { gotErr = err }
	collectRun(t, srv, StreamEventsOptions{Reconnect: opts})
	if gotErr == nil || srv.connects() != 5 {
		t.Fatalf("err %v after %d connects", gotErr, srv.connects())
	}
}

func TestStreamEventsFirstConnectFailsFast(t *testing.T) {
	srv := newScripted(t, []step{{status: 503}})
	client, _ := NewClient(srv.URL, "k")
	if _, _, err := client.StreamEvents(context.Background(), "t/r1", StreamEventsOptions{Reconnect: fast}); err == nil {
		t.Fatal("first-connect 503 must be returned synchronously")
	}
	if srv.connects() != 1 {
		t.Fatalf("connects %d", srv.connects())
	}
}

func TestStreamEventsDisabledKeepsOneConnectionAndNoFlag(t *testing.T) {
	srv := newScripted(t, []step{{body: evFrame(0, "run.started")}})
	collectRun(t, srv, StreamEventsOptions{Reconnect: ReconnectOptions{Disabled: true}})
	if srv.connects() != 1 || srv.seen[0].URL.Query().Has("resumable") {
		t.Fatalf("connects %d, url %s", srv.connects(), srv.seen[0].URL)
	}
}

func TestStreamEventsCleanupStopsReconnecting(t *testing.T) {
	srv := newScripted(t, []step{{body: evFrame(0, "run.started")}})
	client, _ := NewClient(srv.URL, "k")
	events, cleanup, err := client.StreamEvents(context.Background(), "t/r1", StreamEventsOptions{Reconnect: ReconnectOptions{Delay: time.Hour}})
	if err != nil {
		t.Fatal(err)
	}
	<-events
	cleanup()
	for range events {
	}
	if srv.connects() != 1 {
		t.Fatalf("connects %d", srv.connects())
	}
}

func TestStreamHostEventsResumesFromLastDurableID(t *testing.T) {
	host := func(id, typ string) string {
		f := ""
		if id != "" {
			f = "id: " + id + "\n"
		}
		return f + "event: " + typ + "\ndata: {\"type\":\"" + typ + "\",\"payload\":{}}\n\n"
	}
	srv := newScripted(t, []step{
		{body: host("h-1", "heartbeat.evaluated") + host("", "host-test.ephemeral")},
		{body: ""},
		{body: host("h-2", "heartbeat.stateChanged")},
	})
	client, _ := NewClient(srv.URL, "k")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	events, cleanup, err := client.StreamHostEvents(ctx, HostEventsOptions{Reconnect: fast})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for ev := range events {
		got = append(got, ev.Type)
		if len(got) == 3 {
			cleanup()
		}
	}
	if !reflect.DeepEqual(got, []string{"heartbeat.evaluated", "host-test.ephemeral", "heartbeat.stateChanged"}) {
		t.Fatalf("events %v", got)
	}
	if ids := srv.lastIDs(); !reflect.DeepEqual(ids, []string{"", "h-1", "h-1"}) {
		t.Fatalf("Last-Event-ID per connect %q", ids)
	}
	if srv.seen[0].URL.Path != "/host/events" || srv.seen[0].URL.Query().Get("resumable") != "true" {
		t.Fatalf("subscribe url %s", srv.seen[0].URL)
	}
}
