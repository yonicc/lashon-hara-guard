"""Language routing for the gate - the ONE home, used by serve_modal.py and oracle/server.py.

Hebrew-only text is scored by the Hebrew model alone (v2 behaviour, unchanged).
Text containing Latin letters is ALSO scored by the multilingual model and the
gate returns the MAX of both. The gate is recall-first, so the second model can
only add escalations: no message ever scores lower than with the Hebrew model
alone (docs/31). Unset second model (LHG_GATE_RUN_ML empty) = single-model gate.
"""
import re

_LATIN = re.compile(r"[A-Za-z]")


def uses_second_model(text: str) -> bool:
    return bool(_LATIN.search(text))


def combine(p_he: float, p_ml):
    """p_ml is None when the second model was not asked."""
    return p_he if p_ml is None else max(p_he, p_ml)


def run_label(run: str, run_ml: str, used_ml: bool) -> str:
    return f"{run}+{run_ml}" if used_ml else run
