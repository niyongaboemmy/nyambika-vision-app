"""STT adapter contract (E22): every adapter returns the same shape; limits are enforced for all of them."""
import io
import json
import math
import struct
import wave

import httpx
import pytest

from app import stt

KEYS = {"text", "language", "confidence", "duration_s", "container", "no_speech", "provider", "simulated"}


def wav(seconds: float, amp: float = 0.3, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        n = int(seconds * rate)
        w.writeframes(b"".join(struct.pack("<h", int(amp * 32767 * math.sin(2 * math.pi * 220 * i / rate))) for i in range(n)))
    return buf.getvalue()


def ogg_opus(seconds: float) -> bytes:
    """Minimal Ogg stream: OpusHead page + one last page carrying the granule position."""
    def page(granule: int, payload: bytes) -> bytes:
        return b"OggS" + bytes([0, 0]) + struct.pack("<q", granule) + b"\0" * 12 + bytes([1, len(payload)]) + payload
    return page(0, b"OpusHead" + b"\1\1" + b"\0" * 9) + page(int(seconds * 48000), b"x" * 20)


def webm(seconds: float | None) -> bytes:
    """EBML header + Segment(unknown size) › Info › TimecodeScale + Duration (ms, float)."""
    header = b"\x1a\x45\xdf\xa3" + b"\x84" + b"webm"
    info_body = b"\x2a\xd7\xb1\x83" + (1_000_000).to_bytes(3, "big")
    if seconds is not None:
        info_body += b"\x44\x89\x84" + struct.pack(">f", seconds * 1000)
    info = b"\x15\x49\xa9\x66" + bytes([0x80 | len(info_body)]) + info_body
    segment = b"\x18\x53\x80\x67" + b"\x01\xff\xff\xff\xff\xff\xff\xff" + info + b"\x1f\x43\xb6\x75\x80"
    return header + segment


class FakeAdapter:
    name = "fake"

    def transcribe(self, audio, language):
        return stt.Transcript("hello", language or "en", 0.9, self.name, False)


def openai_adapter(handler):
    return stt.OpenAICompatibleAdapter("https://stt.example/v1", "k", "whisper-x", transport=httpx.MockTransport(handler))


@pytest.mark.parametrize("make", [lambda: stt.DevScriptedAdapter(), lambda: FakeAdapter(),
                                  lambda: openai_adapter(lambda r: httpx.Response(200, json={"text": "Ndashaka ikanzu", "language": "kinyarwanda"}))])
def test_adapter_contract(make):
    out = stt.transcribe(wav(2), "rw", adapter=make())
    assert set(out) == KEYS
    assert isinstance(out["text"], str) and out["text"]
    assert out["language"] in ("rw", "en", "fr")
    assert 0 <= out["confidence"] <= 1
    assert out["duration_s"] == pytest.approx(2, abs=0.01)
    assert out["container"] == "wav"


def test_dev_adapter_is_deterministic_and_honours_language():
    a = stt.transcribe(wav(1.5), "fr")
    b = stt.transcribe(wav(1.5), "fr")
    assert a == b
    assert a["simulated"] is True and a["provider"] == "dev-scripted"
    assert a["text"] in stt.DEV_PHRASES["fr"]
    assert stt.transcribe(wav(1.5), "rw")["text"] in stt.DEV_PHRASES["rw"]
    assert stt.transcribe(wav(1.5), "auto")["language"] == "en"


def test_silence_returns_no_speech():
    out = stt.transcribe(wav(2, amp=0.0), "en")
    assert out["no_speech"] is True and out["text"] == "" and out["confidence"] == 0


def test_limits_and_formats():
    with pytest.raises(stt.SttError) as e:
        stt.transcribe(wav(31), "en")
    assert e.value.status == 413
    with pytest.raises(stt.SttError) as e:
        stt.transcribe(b"ID3\x04" + b"\0" * 100, "en")  # mp3
    assert e.value.status == 415
    with pytest.raises(stt.SttError) as e:
        stt.transcribe(b"", "en")
    assert e.value.status == 422
    with pytest.raises(stt.SttError) as e:
        stt.transcribe(b"OggS" + b"\0" * (stt.MAX_BYTES + 1), "en")
    assert e.value.status == 413


def test_ogg_and_webm_durations():
    assert stt.transcribe(ogg_opus(4.5), "en")["duration_s"] == pytest.approx(4.5)
    assert stt.transcribe(webm(3.2), "en")["duration_s"] == pytest.approx(3.2, abs=0.01)
    with pytest.raises(stt.SttError):
        stt.transcribe(webm(45), "en")
    # MediaRecorder webm has no Duration: the client's measured length is used (and capped).
    assert stt.transcribe(webm(None), "en", client_duration_ms=2500)["duration_s"] == 2.5
    with pytest.raises(stt.SttError):
        stt.transcribe(webm(None), "en", client_duration_ms=40000)


def test_openai_adapter_request_and_confidence():
    seen = {}

    def handler(req: httpx.Request):
        seen["auth"] = req.headers.get("authorization")
        seen["url"] = str(req.url)
        seen["body"] = req.content
        return httpx.Response(200, json={"text": " Une robe ", "language": "fr",
                                         "segments": [{"start": 0, "end": 2, "avg_logprob": -0.1}]})

    out = stt.transcribe(wav(2), "fr", adapter=openai_adapter(handler))
    assert seen["url"] == "https://stt.example/v1/audio/transcriptions"
    assert seen["auth"] == "Bearer k"
    assert b'name="language"' in seen["body"] and b"whisper-x" in seen["body"]
    assert out["text"] == "Une robe" and out["language"] == "fr" and out["simulated"] is False
    assert out["confidence"] == pytest.approx(math.exp(-0.1), abs=0.001)

    def down(req):
        return httpx.Response(500, text="boom")

    with pytest.raises(stt.SttError) as e:
        stt.transcribe(wav(1), "fr", adapter=openai_adapter(down))
    assert e.value.status == 503


def test_endpoint(client):
    r = client.post("/v1/stt", files={"audio": ("a.wav", wav(1.2), "audio/wav")}, data={"language": "en"})
    assert r.status_code == 200, r.text
    assert set(r.json()) == KEYS
    r = client.post("/v1/stt", files={"audio": ("a.mp3", b"ID3" + b"\0" * 50, "audio/mpeg")}, data={"language": "en"})
    assert r.status_code == 415
    r = client.post("/v1/stt", files={"audio": ("a.webm", webm(None), "audio/webm")}, data={"language": "rw", "duration_ms": "1800"})
    assert r.status_code == 200 and r.json()["language"] == "rw" and r.json()["duration_s"] == 1.8
    json.dumps(r.json())
