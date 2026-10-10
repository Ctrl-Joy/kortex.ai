"""Retail barcode validation (EAN-13, EAN-8, UPC-A, UPC-E)."""

from __future__ import annotations


def _gs1_check_digit(body: str) -> int:
    total = 0
    for i, ch in enumerate(reversed(body)):
        total += int(ch) * (3 if i % 2 == 0 else 1)
    return (10 - total % 10) % 10


def upce_to_upca(upce: str) -> str | None:
    """Expand an 8-digit UPC-E code to its 12-digit UPC-A equivalent."""
    if len(upce) != 8 or not upce.isdigit() or upce[0] not in "01":
        return None
    ns, d, check = upce[0], upce[1:7], upce[7]
    last = d[5]
    if last in "012":
        body = f"{ns}{d[0]}{d[1]}{last}0000{d[2]}{d[3]}{d[4]}"
    elif last == "3":
        body = f"{ns}{d[0]}{d[1]}{d[2]}00000{d[3]}{d[4]}"
    elif last == "4":
        body = f"{ns}{d[0]}{d[1]}{d[2]}{d[3]}00000{d[4]}"
    else:
        body = f"{ns}{d[0]}{d[1]}{d[2]}{d[3]}{d[4]}0000{last}"
    return body + check


def classify(code: str) -> str | None:
    """Return the symbology name if the code has a valid GS1 check digit."""
    if not code.isdigit():
        return None
    if len(code) == 13 and _gs1_check_digit(code[:-1]) == int(code[-1]):
        return "EAN-13"
    if len(code) == 12 and _gs1_check_digit(code[:-1]) == int(code[-1]):
        return "UPC-A"
    if len(code) == 8:
        if _gs1_check_digit(code[:-1]) == int(code[-1]):
            return "EAN-8"
        upca = upce_to_upca(code)
        if upca and _gs1_check_digit(upca[:-1]) == int(upca[-1]):
            return "UPC-E"
    return None


def is_valid(code: str) -> bool:
    return classify(code) is not None


def normalise(code: str) -> str:
    return "".join(ch for ch in code.strip() if not ch.isspace())


def with_check_digit(body: str) -> str:
    return body + str(_gs1_check_digit(body))
