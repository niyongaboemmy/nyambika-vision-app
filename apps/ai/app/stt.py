"""Speech-to-text for the Voice Muse (E22, FR-AST-04).

`POST /v1/stt` takes one short recording (≤ 30 s, webm/ogg/wav) plus a RW/EN/FR language hint and
returns a transcript with a confidence. Audio is only held in memory for the request: nothing is
written to disk or logged.

Adapters (STT_PROVIDER):
- ``dev-scripted`` (default): deterministic, offline, no keys and no model download. It validates and
  measures the audio for real (container sniffing, duration, silence on WAV) but the words come from a
  fixed list of Muse phrases chosen by a hash of the audio. It is for development and tests only and
  says so (``simulated: true``); it does not recognise speech.
- ``openai-compatible``: any hosted or self-hosted service speaking the OpenAI
  ``/v1/audio/transcriptions`` API (e.g. a faster-whisper server, or a Kinyarwanda fine-tuned Whisper
  behind one). Needs STT_API_URL (+ STT_API_KEY, STT_MODEL).
"""
from __future__ import annotations

import hashlib
import math
import os
import struct
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

MAX_SECONDS = 30.0
MAX_BYTES = 2 * 1024 * 1024  # 30 s of opus at 128 kbps is ~480 KB; WAV 16 kHz mono 16-bit is ~960 KB
Lang = Literal["rw", "en", "fr"]
LANGS: tuple[Lang, ...] = ("rw", "en", "fr")

router = APIRouter()


class SttError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class Audio:
    data: bytes
    container: Literal["webm", "ogg", "wav"]
    duration_s: float | None  # None when the container doesn't say (MediaRecorder webm)
    rms: float | None  # only measurable for PCM WAV


@dataclass
class Transcript:
    text: str
    language: Lang
    confidence: float
    provider: str
    simulated: bool


class SttAdapter(Protocol):
    name: str

    def transcribe(self, audio: Audio, language: Lang | None) -> Transcript: ...


# ── Container sniffing and duration ──────────────────────────────────────────────────────────────

def sniff(data: bytes) -> Literal["webm", "ogg", "wav"]:
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    if data[:4] == b"OggS":
        return "ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    raise SttError(415, "Unsupported audio. Send webm, ogg or wav.")


def _wav(data: bytes) -> tuple[float, float | None]:
    pos, fmt, rate, channels, bits, frames = 12, None, 0, 1, 16, None
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt " and len(body) >= 16:
            fmt, channels, rate, _, _, bits = struct.unpack("<HHIIHH", body[:16])
        elif cid == b"data":
            frames = body
            break
        pos += 8 + size + (size & 1)
    if not rate or frames is None:
        raise SttError(422, "Broken WAV file")
    bytes_per_frame = max(1, channels * bits // 8)
    duration = len(frames) / (rate * bytes_per_frame)
    rms = None
    if fmt == 1 and bits == 16 and frames:
        n = len(frames) // 2
        step = max(1, n // 20000)  # sample ≤ 20k points, enough for a level estimate
        samples = struct.unpack(f"<{n}h", frames[: n * 2])[::step]
        rms = math.sqrt(sum(s * s for s in samples) / len(samples)) / 32768
    return duration, rms


def _ogg(data: bytes) -> float | None:
    last = data.rfind(b"OggS")
    if last < 0 or last + 14 > len(data):
        return None
    granule = struct.unpack("<q", data[last + 6:last + 14])[0]
    if granule <= 0:
        return None
    if b"OpusHead" in data[:200]:
        return granule / 48000  # Opus granule positions are always at 48 kHz
    v = data.find(b"\x01vorbis")
    if v >= 0 and v + 16 <= len(data):
        rate = struct.unpack("<I", data[v + 12:v + 16])[0]
        return granule / rate if rate else None
    return None


def _ebml_id(data: bytes, pos: int) -> tuple[int, int]:
    first = data[pos]
    length = 1
    mask = 0x80
    while length <= 4 and not first & mask:
        mask >>= 1
        length += 1
    return int.from_bytes(data[pos:pos + length], "big"), length


def _ebml_size(data: bytes, pos: int) -> tuple[int | None, int]:
    first = data[pos]
    length = 1
    mask = 0x80
    while length <= 8 and not first & mask:
        mask >>= 1
        length += 1
    value = first & (mask - 1)
    for b in data[pos + 1:pos + length]:
        value = (value << 8) | b
    unknown = value == (1 << (7 * length)) - 1
    return (None if unknown else value), length


def _webm(data: bytes) -> float | None:
    """Segment › Info › Duration × TimecodeScale. MediaRecorder output usually omits Duration."""
    scale, duration = 1_000_000, None
    pos, end = 0, min(len(data), 64 * 1024)
    containers = {0x18538067, 0x1549A966}  # Segment, Info: descend into these
    try:
        while pos < end:
            eid, il = _ebml_id(data, pos)
            size, sl = _ebml_size(data, pos + il)
            body = pos + il + sl
            if eid in containers:
                pos = body
                continue
            if size is None:
                break
            if eid == 0x2AD7B1:
                scale = int.from_bytes(data[body:body + size], "big")
            elif eid == 0x4489:
                duration = struct.unpack(">f" if size == 4 else ">d", data[body:body + size])[0]
            elif eid == 0x1F43B675:  # Cluster: Info is behind us
                break
            pos = body + size
    except (IndexError, struct.error):
        return None
    return duration * scale / 1e9 if duration else None


def load(data: bytes, client_duration_ms: int | None = None) -> Audio:
    if not data:
        raise SttError(422, "Empty recording")
    if len(data) > MAX_BYTES:
        raise SttError(413, "Recording too large. Keep it under 30 seconds.")
    container = sniff(data)
    rms = None
    if container == "wav":
        duration, rms = _wav(data)
    elif container == "ogg":
        duration = _ogg(data)
    else:
        duration = _webm(data)
    if duration is None and client_duration_ms:
        duration = client_duration_ms / 1000
    if duration is not None and duration > MAX_SECONDS + 0.5:
        raise SttError(413, f"Recording is {duration:.0f} s. Voice requests are limited to 30 seconds.")
    return Audio(data=data, container=container, duration_s=round(duration, 2) if duration else None, rms=rms)


# ── Adapters ─────────────────────────────────────────────────────────────────────────────────────

DEV_PHRASES: dict[Lang, list[str]] = {
    "en": [
        "I need a dress for a wedding on Saturday under 50,000",
        "Something in kitenge for church on Sunday",
        "A smart outfit for the office, blue, under 40,000",
        "A traditional mushanana for a gusaba ceremony",
    ],
    "rw": [
        "Ndashaka ikanzu y'ubukwe ku wa gatandatu munsi ya 50,000",
        "Ndashaka imyenda ya kitenge yo kujya mu rusengero",
        "Ndashaka umushanana wo mu gusaba",
    ],
    "fr": [
        "Je cherche une robe pour un mariage samedi à moins de 50 000",
        "Une tenue en kitenge pour l'église dimanche",
        "Une tenue de bureau bleue à moins de 40 000",
    ],
}
SILENCE_RMS = 0.004


class DevScriptedAdapter:
    """Deterministic offline stand-in. Real audio checks, scripted words (see module docstring)."""

    name = "dev-scripted"

    def transcribe(self, audio: Audio, language: Lang | None) -> Transcript:
        lang: Lang = language or "en"
        if audio.rms is not None and audio.rms < SILENCE_RMS:
            return Transcript("", lang, 0.0, self.name, True)
        digest = hashlib.sha256(audio.data).digest()
        phrases = DEV_PHRASES[lang]
        text = phrases[digest[0] % len(phrases)]
        return Transcript(text, lang, 0.62, self.name, True)


class OpenAICompatibleAdapter:
    """Hosted / self-hosted Whisper-style service (OpenAI `/v1/audio/transcriptions` contract)."""

    name = "openai-compatible"

    def __init__(self, url: str, key: str | None, model: str, transport: httpx.BaseTransport | None = None):
        self.url = url.rstrip("/")
        self.key = key
        self.model = model
        self.transport = transport

    def transcribe(self, audio: Audio, language: Lang | None) -> Transcript:
        mime = {"webm": "audio/webm", "ogg": "audio/ogg", "wav": "audio/wav"}[audio.container]
        data = {"model": self.model, "response_format": "verbose_json", "temperature": "0"}
        if language:
            data["language"] = language
            # Domain prompt nudges recognition towards Muse vocabulary (WER target ≤ 12%, plan §9.3).
            data["prompt"] = "Nyambika fashion: ubukwe, gusaba, gukwa, kitenge, mushanana, imigongo, RWF"
        headers = {"authorization": f"Bearer {self.key}"} if self.key else {}
        try:
            with httpx.Client(timeout=30, transport=self.transport) as client:
                res = client.post(f"{self.url}/audio/transcriptions", data=data, headers=headers,
                                  files={"file": (f"muse.{audio.container}", audio.data, mime)})
        except httpx.HTTPError as exc:
            raise SttError(503, f"Speech service unreachable: {exc.__class__.__name__}") from exc
        if res.status_code >= 400:
            raise SttError(503, f"Speech service error {res.status_code}")
        body = res.json()
        text = str(body.get("text", "")).strip()
        detected = str(body.get("language", language or "en"))[:2].lower()
        lang: Lang = detected if detected in LANGS else (language or "en")  # type: ignore[assignment]
        segments = body.get("segments") or []
        if segments:
            # avg_logprob per segment → probability, weighted by segment length
            total = sum(max(0.01, s.get("end", 0) - s.get("start", 0)) for s in segments)
            conf = sum(math.exp(min(0.0, s.get("avg_logprob", -1.0))) * max(0.01, s.get("end", 0) - s.get("start", 0))
                       for s in segments) / total
        else:
            conf = 0.8 if text else 0.0
        return Transcript(text, lang, round(conf, 3), self.name, False)


def get_adapter() -> SttAdapter:
    provider = os.environ.get("STT_PROVIDER", "dev-scripted")
    if provider == "openai-compatible":
        url = os.environ.get("STT_API_URL")
        if not url:
            raise SttError(503, "STT_API_URL is not set")
        return OpenAICompatibleAdapter(url, os.environ.get("STT_API_KEY"), os.environ.get("STT_MODEL", "whisper-1"))
    return DevScriptedAdapter()


def transcribe(data: bytes, language: str | None, client_duration_ms: int | None = None,
               adapter: SttAdapter | None = None) -> dict:
    hint: Lang | None = language if language in LANGS else None  # type: ignore[assignment]
    audio = load(data, client_duration_ms)
    t = (adapter or get_adapter()).transcribe(audio, hint)
    return {
        "text": t.text,
        "language": t.language,
        "confidence": t.confidence,
        "duration_s": audio.duration_s,
        "container": audio.container,
        "no_speech": not t.text,
        "provider": t.provider,
        "simulated": t.simulated,
    }


@router.post("/v1/stt")
async def stt(audio: UploadFile = File(...), language: str = Form("auto"), duration_ms: int | None = Form(None)):
    """Speech-to-text (E22). Audio is read into memory, transcribed and dropped; never stored."""
    data = await audio.read(MAX_BYTES + 1)
    try:
        return transcribe(data, language, duration_ms)
    except SttError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc
    finally:
        del data
