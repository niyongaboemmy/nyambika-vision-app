"""Runtime settings, read from the environment once at import."""
import os

C2PA_SIGNING_KEY = os.environ.get("C2PA_SIGNING_KEY", "dev-only-c2pa-signing-key-change-me").encode()
VTON_PROVIDER = os.environ.get("VTON_PROVIDER", "local-compositor")
MUSE_LLM = os.environ.get("MUSE_LLM") == "1"
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
MUSE_LLM_MODEL = os.environ.get("MUSE_LLM_MODEL", "claude-opus-5-5")

# Guard thresholds (AI-GD). Looks failing any of these are withheld and never billed.
GUARD_MIN_IDENTITY = float(os.environ.get("GUARD_MIN_IDENTITY", "0.97"))
GUARD_MAX_SKIN_DELTA = float(os.environ.get("GUARD_MAX_SKIN_DELTA", "0.04"))
GUARD_MIN_FIDELITY = float(os.environ.get("GUARD_MIN_FIDELITY", "0.6"))

TIER_HEIGHT = {"PREVIEW": 512, "HD": 1024}
