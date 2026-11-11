from .base import VTONProvider, VTONResult
from .local_compositor import LocalCompositor
from .routed import RoutedVTON

_PROVIDERS: dict[str, VTONProvider] = {"local-compositor": LocalCompositor(), "routed": RoutedVTON()}


def get_provider(name: str) -> VTONProvider:
    try:
        return _PROVIDERS[name]
    except KeyError as exc:
        raise ValueError(f"Unknown VTON provider '{name}'. Available: {sorted(_PROVIDERS)}") from exc


def registry() -> list[dict]:
    return [entry for p in _PROVIDERS.values() for entry in p.models()]


__all__ = ["VTONProvider", "VTONResult", "get_provider", "registry"]
