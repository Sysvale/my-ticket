#!/usr/bin/env python3
"""Gera os avisos sonoros da extensão (extension/sounds/*.wav), sem dependências.

WAV mono, 16 bits, 22,05 kHz: pequenos (~20-40 KB) e tocados pela página offscreen com <audio>.
O volume é controlado na hora de tocar, então os arquivos são normalizados em 80% do pico.
"""
import math
import struct
import wave
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "extension" / "sounds"
RATE = 22050


def bell(freq, dur, decay, harmonics=((1, 1.0), (2, 0.3))):
    """Nota de sino: ataque curto e queda exponencial."""
    out = []
    for i in range(int(dur * RATE)):
        t = i / RATE
        env = min(1.0, t / 0.005) * math.exp(-t / decay)
        out.append(env * sum(a * math.sin(2 * math.pi * freq * h * t) for h, a in harmonics))
    return out


def beep(freq, dur, harmonics=((1, 1.0), (3, 0.25))):
    """Bip com envelope trapezoidal (sobe e desce em 8 ms, sem estalo)."""
    ramp = 0.008
    out = []
    for i in range(int(dur * RATE)):
        t = i / RATE
        env = min(1.0, t / ramp, (dur - t) / ramp)
        out.append(max(env, 0.0) * sum(a * math.sin(2 * math.pi * freq * h * t) for h, a in harmonics))
    return out


def mix(parts, total):
    buf = [0.0] * int(total * RATE)
    for start, samples in parts:
        i0 = int(start * RATE)
        for k, v in enumerate(samples):
            if i0 + k < len(buf):
                buf[i0 + k] += v
    return buf


def write(name, buf, peak=0.8):
    top = max(abs(x) for x in buf) or 1.0
    fade = int(0.02 * RATE)  # 20 ms de saída no fim, para não terminar com estalo
    for i in range(min(fade, len(buf))):
        buf[-1 - i] *= i / fade
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(x / top * peak * 32767)) for x in buf))
    print(f"{path.name}: {len(buf) / RATE:.2f}s, {path.stat().st_size / 1024:.0f} KB")


# Suave: duas notas de sino subindo (lá e mi).
write("chime", mix([(0.0, bell(880.0, 0.6, 0.14)), (0.16, bell(1318.5, 0.75, 0.18))], 0.95))

# Duplo bip: dois bips curtos iguais.
write("double", mix([(0.0, beep(988.0, 0.12)), (0.2, beep(988.0, 0.12))], 0.36))

# Alerta: quatro bips alternando grave/agudo, com mais harmônicos (soa mais firme).
harm = ((1, 1.0), (3, 0.35), (5, 0.15))
notes = [660.0, 880.0, 660.0, 880.0]
write("alert", mix([(i * 0.16, beep(f, 0.14, harm)) for i, f in enumerate(notes)], 0.66))
