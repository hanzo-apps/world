package world

// Streaming inference — the SSE side of the ONE completion path.
//
// chatMessagesModelStream is chatMessagesModel with "stream":true: it reads the
// upstream OpenAI-style SSE frames and hands each content delta to onDelta while
// accumulating the full output, so callers keep the exact same (content, tokens,
// error) contract and simply gain live deltas.
//
// replyExtractor solves the analyst's envelope problem: the model emits STRICT
// JSON ({"reply":"…","actions":[…],"tools":[…]}), so raw deltas are not
// user-presentable. The extractor is an incremental scanner fed those raw
// deltas; it emits ONLY the unescaped contents of the top-level "reply" string
// as it grows. Tool rounds ({"reply":"","tools":…}) therefore stream nothing,
// and a model that ignores the envelope and answers in prose streams verbatim
// (mirroring parseAnalystTurn's raw-output degrade).

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// chatMessagesModelStream runs one completion with streaming, calling onDelta
// for every content chunk. Returns the full accumulated content, the token count,
// and the gateway response id (first non-empty per-chunk id wins) so the analyst
// can key a content-free reward signal to it. A nil onDelta degrades to a plain
// buffered call semantically identical to chatMessagesModel.
func (a *AIClient) chatMessagesModelStream(ctx context.Context, s *Server, bearer, model string, messages []chatMessage, temperature float64, maxTokens int, extra map[string]string, onDelta func(string)) (string, int, string, error) {
	if strings.TrimSpace(model) == "" {
		model = a.model
	}
	reqBody, err := json.Marshal(struct {
		chatRequest
		Stream bool `json:"stream"`
	}{
		chatRequest: chatRequest{Model: model, Messages: messages, Temperature: temperature, MaxTokens: maxTokens, TopP: 0.9},
		Stream:      true,
	})
	if err != nil {
		return "", 0, "", err
	}
	cctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, a.base+"/chat/completions", bytes.NewReader(reqBody))
	if err != nil {
		return "", 0, "", err
	}
	req.Header.Set("Authorization", bearer)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	for k, v := range extra {
		req.Header.Set(k, v)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return "", 0, "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return "", resp.StatusCode, "", aiStatusError(resp.StatusCode, body)
	}

	// Some gateways answer a stream request with a plain JSON body (model or
	// route not stream-capable). Sniff the content type and degrade quietly.
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "event-stream") {
		body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
		if err != nil {
			return "", resp.StatusCode, "", err
		}
		var cr chatResponse
		if err := json.Unmarshal(body, &cr); err != nil {
			return "", resp.StatusCode, "", err
		}
		if len(cr.Choices) == 0 {
			return "", resp.StatusCode, "", fmt.Errorf("empty response")
		}
		out := strings.TrimSpace(cr.Choices[0].Message.Content)
		if onDelta != nil && out != "" {
			onDelta(out)
		}
		return out, cr.Usage.TotalTokens, cr.ID, nil
	}

	var full strings.Builder
	tokens := 0
	id := ""
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var frame struct {
			ID      string `json:"id"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *struct {
				TotalTokens int `json:"total_tokens"`
			} `json:"usage"`
		}
		if json.Unmarshal([]byte(data), &frame) != nil {
			continue // tolerate keep-alives / vendor frames
		}
		if id == "" && frame.ID != "" {
			id = frame.ID // first non-empty id wins (every chunk repeats it)
		}
		if frame.Usage != nil {
			tokens = frame.Usage.TotalTokens
		}
		for _, c := range frame.Choices {
			if c.Delta.Content != "" {
				full.WriteString(c.Delta.Content)
				if onDelta != nil {
					onDelta(c.Delta.Content)
				}
			}
		}
	}
	if err := sc.Err(); err != nil {
		// A mid-stream drop still yields whatever arrived; the caller decides.
		if full.Len() == 0 {
			return "", resp.StatusCode, "", err
		}
	}
	return strings.TrimSpace(full.String()), tokens, id, nil
}

// ── incremental "reply" extraction ───────────────────────────────────────────

// replyExtractor states.
const (
	rxSniff   = iota // deciding: JSON envelope or raw prose?
	rxSeekKey        // scanning for "reply"
	rxSeekColon
	rxSeekQuote
	rxInString // inside the reply value — emit unescaped runes
	rxDone     // reply string closed (or prose mode ended)
	rxProse    // no envelope — everything is the reply
)

// replyExtractor incrementally extracts the top-level "reply" string value from
// a streaming JSON envelope, emitting decoded text via emit. Reasoning models
// (gpt-oss, zen3-omni) write prose BEFORE the envelope — that pre-envelope text
// goes to emitThink (nil-safe) so the UI can show it as live thinking, and the
// moment a '{' appears the scanner switches to envelope mode. Feed() accepts
// arbitrary chunk boundaries (escapes and \uXXXX may split across chunks).
type replyExtractor struct {
	state     int
	emit      func(string)
	emitThink func(string)
	// key matching
	keyBuf string
	// string decoding
	esc  bool   // last byte was a backslash
	uBuf string // pending \uXXXX hex digits ("" when not in a unicode escape)
	lead int    // sniff: bytes of leading whitespace seen
}

func newReplyExtractor(emit func(string)) *replyExtractor {
	return &replyExtractor{state: rxSniff, emit: emit}
}

// Feed consumes the next raw chunk of model output.
func (x *replyExtractor) Feed(chunk string) {
	i := 0
	for i < len(chunk) {
		c := chunk[i]
		switch x.state {
		case rxSniff:
			if c == ' ' || c == '\n' || c == '\r' || c == '\t' {
				i++
				continue
			}
			if c == '{' {
				x.state = rxSeekKey
				i++
				continue
			}
			// Pre-envelope prose (a reasoning model thinking out loud) — stream
			// it as thinking until the envelope's '{' shows up.
			x.state = rxProse
		case rxProse:
			j := i
			for j < len(chunk) && chunk[j] != '{' {
				j++
			}
			if j > i && x.emitThink != nil {
				x.emitThink(chunk[i:j])
			}
			if j >= len(chunk) {
				return
			}
			x.state = rxSeekKey // envelope begins
			i = j + 1
		case rxSeekKey:
			// scan for the exact key "reply" — cheap rolling match on quoted
			// runs; the envelope contract puts reply first, so this stays
			// shallow in practice.
			if c == '"' {
				x.keyBuf = ""
				j := i + 1
				for j < len(chunk) && chunk[j] != '"' {
					x.keyBuf += string(chunk[j])
					j++
				}
				if j >= len(chunk) {
					// key name split across chunks — resume in rxKeyPartial
					x.state = rxKeyPartial
					return
				}
				if x.keyBuf == "reply" {
					x.state = rxSeekColon
				}
				i = j + 1
				continue
			}
			i++
		case rxKeyPartial:
			for i < len(chunk) && chunk[i] != '"' {
				x.keyBuf += string(chunk[i])
				i++
			}
			if i < len(chunk) { // closing quote
				if x.keyBuf == "reply" {
					x.state = rxSeekColon
				} else {
					x.state = rxSeekKey
				}
				i++
			}
		case rxSeekColon:
			if c == ':' {
				x.state = rxSeekQuote
			}
			i++
		case rxSeekQuote:
			if c == '"' {
				x.state = rxInString
			} else if c != ' ' && c != '\n' && c != '\r' && c != '\t' {
				x.state = rxSeekKey // reply wasn't a string (defensive)
			}
			i++
		case rxInString:
			if x.uBuf != "" || x.esc {
				i = x.feedEscape(chunk, i)
				continue
			}
			if c == '\\' {
				x.esc = true
				i++
				continue
			}
			if c == '"' {
				x.state = rxDone
				return
			}
			// emit the longest plain run in one call
			j := i
			for j < len(chunk) && chunk[j] != '\\' && chunk[j] != '"' {
				j++
			}
			x.emit(chunk[i:j])
			i = j
		case rxDone:
			return
		}
	}
}

// rxKeyPartial handles a key name split across chunk boundaries.
const rxKeyPartial = 100

// feedEscape consumes escape-sequence bytes (possibly across chunks).
func (x *replyExtractor) feedEscape(chunk string, i int) int {
	if x.uBuf != "" { // inside \uXXXX ("u" + collected hex)
		for i < len(chunk) && len(x.uBuf) < 5 {
			x.uBuf += string(chunk[i])
			i++
		}
		if len(x.uBuf) == 5 {
			if v, err := strconv.ParseUint(x.uBuf[1:], 16, 32); err == nil {
				x.emit(string(rune(v)))
			}
			x.uBuf = ""
		}
		return i
	}
	// x.esc: the byte after a backslash
	c := chunk[i]
	x.esc = false
	switch c {
	case 'n':
		x.emit("\n")
	case 't':
		x.emit("\t")
	case 'r':
		x.emit("\r")
	case 'u':
		x.uBuf = "u"
	case '"', '\\', '/':
		x.emit(string(c))
	default:
		x.emit(string(c))
	}
	return i + 1
}
