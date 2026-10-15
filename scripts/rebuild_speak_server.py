#!/usr/bin/env python3.12
"""
Regenerate ~/tools/tts/speak_server.py from the data recovered out of the
compiled bytecode, plus the Mixed-voice feature that build predated.

Everything user-authored (the pronunciation dictionary, the voice tables) is
written straight out of /tmp/tts_recovered.json so no entry can be mistyped by
hand.
"""
import json

REC = json.load(open("/tmp/tts_recovered.json"))
PRON = REC["PRONUNCIATIONS"]

HEADER = '''#!/usr/bin/env python3.12
"""
HomeHub local voice daemon — neural text-to-speech, free and offline.

WHY A DAEMON: Kokoro holds an 80M-parameter model in memory and loading it
costs ~9s. Running it per request made every reply take ~15s. This process
keeps the pipeline warm, so a reply takes ~1s.

API (the bridge in bridge/shift / proxies to this):
    GET  /health -> {"ok":true,"voices":[...],"groups":{...}}
    POST /speak  {"text": "...", "voice": "mixed"} -> audio/wav bytes

MIXED VOICE: the default, and the one that matters. An Indian dish name read
by an American voice sounds wrong ("palak paneer" becomes "pause-up-paneer"),
so "mixed" speaks Indian terms in an Indian voice and the rest in a clear
English one, stitched with short gaps. Switching back to a single voice is
still available per accent in Settings.
"""

import io
import json
import re
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from kokoro import KPipeline

'''

BODY = '''
# ---------------------------------------------------------------------------
# Voice tables
# ---------------------------------------------------------------------------

VOICES = __VOICES__

VOICE_GROUPS = __GROUPS__

# Which voice reads Indian dish names in Mixed mode.
INDIAN_VOICE = __INDIAN__

# The clear English voice used for everything else in Mixed mode.
ENGLISH_VOICE = "af_heart"

# 60ms of silence between stitched segments. Long enough to sound like a
# pause rather than a splice, short enough not to drag.
GAP_SECONDS = 0.06

PRONUNCIATIONS = __PRON__


# ---------------------------------------------------------------------------
# Text preparation
# ---------------------------------------------------------------------------

# Words that should be spoken in an Indian voice. This is deliberately NOT
# the same set as PRONUNCIATIONS: that dictionary exists to fix English
# spelling, this one exists to choose a voice. A term can need an Indian
# voice without needing respelling ("makhani"), and a multi-word dish needs
# to be matched whole or "makhani" gets split off and spoken in English.
INDIAN_PHRASES = [
    "dal makhani", "rajma chawal", "dal tadka", "chole bhature",
    "aloo gobi", "aloo methi", "palak paneer", "paneer butter masala",
    "masala chai", "garam masala", "dal fry", "jeera rice",
]

INDIAN_WORDS = [
    "dal", "daal", "makhani", "rajma", "chana", "chole", "rogan", "josh",
    "korma", "kofta", "tikka", "tandoori", "paneer", "roti", "chapati",
    "naan", "paratha", "puri", "dosa", "idli", "vada", "chutney", "raita",
    "sarson", "methi", "palak", "lauki", "torhi", "bhindi", "baingan",
    "haldi", "jeera", "cumin", "ghee", "puri", "sabudana", "besan",
    "chana", "urad", "toor", "masoor", "moong", "til", "sarson",
]

INDIAN_TERMS = sorted(set(PRONUNCIATIONS) | set(INDIAN_PHRASES) | set(INDIAN_WORDS),
                      key=len, reverse=True)


# Multi-word terms must be matched before single words, otherwise "dal
# makhani" splits and "makhani" is spoken in the English voice.
_TERM_RE = re.compile(
    r"\\b(" + "|".join(re.escape(t) for t in INDIAN_TERMS) + r")\\b", re.IGNORECASE
)

# Respelling only needs the dictionary's own keys. Matching the wider term
# list here would let a multi-word dish swallow the single-word fixes inside
# it, so "aloo gobi" would keep saying "aloo" instead of "ahloo gobi".
_PRON_RE = re.compile(
    r"\\b(" + "|".join(re.escape(t) for t in sorted(PRONUNCIATIONS, key=len, reverse=True))
    + r")\\b", re.IGNORECASE
)


def fix_pronunciation(text: str) -> str:
    """Respell Indian terms into spellings the English voice pronounces well.

    espeak says "samosa" as two syllables and "aloo" as "al-oo"; respelling
    them keeps a familiar word recognisable instead of mangled.
    """
    def sub(m: re.Match) -> str:
        found = m.group(1)
        for k, v in PRONUNCIATIONS.items():
            if k.lower() == found.lower():
                return v
        return found

    return _PRON_RE.sub(sub, text)


def indian_terms(text: str) -> bool:
    """True when this span contains an Indian dish name."""
    return bool(_TERM_RE.search(text))


def split_by_script(text: str):
    """Split into [(span, is_indian), ...] preserving order and exact text.

    Join the spans and you must get the original string back: the splitter is
    only used to choose a voice per span, never to rewrite the reply.
    """
    spans = []
    last = 0
    for m in _TERM_RE.finditer(text):
        if m.start() > last:
            spans.append((text[last:m.start()], False))
        spans.append((m.group(1), True))
        last = m.end()
    if last < len(text):
        spans.append((text[last:], False))
    return [(s, True) if ind else (s, False) for s, ind in spans if s]


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------

_pipelines = {}
_lock = threading.Lock()


def get_pipeline(voice: str):
    """One resident pipeline per voice. Loading is the expensive part."""
    with _lock:
        p = _pipelines.get(voice)
        if p is None:
            p = KPipeline(lang_code="a")
            _pipelines[voice] = p
        return p


def _render(voice: str, text: str, sr: int = 24000):
    """Render one span with one voice. Returns float samples."""
    pipeline = get_pipeline(voice)
    chunks = []
    for gs in pipeline(text, voice=voice, speed=1.0):
        audio = gs.audio if hasattr(gs, "audio") else None
        if audio is None:
            continue
        arr = np.asarray(audio, dtype=np.float32).reshape(-1)
        chunks.append(arr)
    if not chunks:
        return np.zeros(0, dtype=np.float32), sr
    return np.concatenate(chunks), sr


def _silence(n_samples: int, sr: int = 24000):
    return np.zeros(n_samples, dtype=np.float32)


def synthesise(text: str, voice: str = "mixed") -> bytes:
    """Return WAV bytes for `text` in `voice`.

    In mixed mode each span is rendered with the voice that suits it and the
    results are stitched with short gaps, so "try the dal makhani" is spoken
    with the Indian terms in an Indian voice and "try the" in a clear English
    one, in one continuous reply.
    """
    if voice != "mixed":
        # Single voice: respell every Indian term so espeak gets it right.
        samples, sr = _render(voice, fix_pronunciation(text))
        return _to_wav(samples, sr)

    # Mixed: split the ORIGINAL text. Respelling first would rewrite "aloo
    # gobi" to "ahloo gobi" and the phrase would stop matching its own voice.
    spans = split_by_script(text)
    if not spans:
        samples, sr = _render(ENGLISH_VOICE, text)
        return _to_wav(samples, sr)

    pieces = []
    sr = 24000
    gap = int(GAP_SECONDS * sr)
    for i, (span, is_indian) in enumerate(spans):
        chosen = INDIAN_VOICE if is_indian else ENGLISH_VOICE
        samples, sr = _render(chosen, span)
        if samples.size:
            pieces.append(samples)
            if i < len(spans) - 1:
                pieces.append(_silence(gap, sr))
    if not pieces:
        samples, sr = _render(ENGLISH_VOICE, text)
        return _to_wav(samples, sr)
    return _to_wav(np.concatenate(pieces), sr)


def _to_wav(samples, sr: int = 24000) -> bytes:
    """16-bit PCM WAV in memory."""
    if samples is None or len(samples) == 0:
        samples = np.zeros(int(sr * 0.1), dtype=np.float32)
    peak = float(np.max(np.abs(samples))) or 1.0
    norm = samples / max(peak, 1e-6) * 0.95
    pcm = (norm * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[tts] " + (fmt % args) + "\\n")

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", ""):
            self._json(200, {
                "ok": True,
                "voices": ["mixed"] + VOICES,
                "groups": {"Mixed (recommended)": ["mixed"], **VOICE_GROUPS},
            })
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/speak":
            self._json(404, {"error": "not_found"})
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(n) or b"{}")
            text = str(data.get("text", "")).strip()
            voice = str(data.get("voice", "mixed")) or "mixed"
            if not text:
                self._json(400, {"error": "bad_request"})
                return
            wav = synthesise(text, voice)
        except Exception as e:                      # noqa: BLE001
            sys.stderr.write("[tts] failed: %r\\n" % (e,))
            self._json(500, {"error": "synthesis_failed"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav)))
        self.end_headers()
        self.wfile.write(wav)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    # Warm the two voices Mixed mode uses, so the first reply is not slow.
    for v in (INDIAN_VOICE, ENGLISH_VOICE):
        try:
            get_pipeline(v)
        except Exception as e:                      # noqa: BLE001
            sys.stderr.write("[tts] warm %s failed: %r\\n" % (v, e))
    print("[tts] ready", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
'''

src = HEADER + BODY
for token, value in (
    ("__VOICES__", repr(REC["VOICES"])),
    ("__GROUPS__", repr(REC["VOICE_GROUPS"])),
    ("__INDIAN__", repr(REC["INDIAN_VOICE"])),
    ("__PRON__", repr(PRON)),
):
    src = src.replace(token, value)

open("/Users/adhyathmika/tools/tts/speak_server.py", "w").write(src)
print("wrote speak_server.py:", len(src), "bytes")
print("pronunciation entries:", len(PRON))