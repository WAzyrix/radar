#!/usr/bin/env python3
"""
Génère les icônes PNG de l'appli (écran d'accueil, notifications) sans aucune bibliothèque :
on calcule la couleur de chaque pixel, puis on écrit le PNG "à la main" (zlib + en-têtes).

Dessin : le logo Radar (point en dégradé violet -> rose, entouré d'un anneau) sur fond sombre.
Lancement : python3 scripts/generer_icones.py
"""

import math
import struct
import zlib
from pathlib import Path

DOSSIER = Path(__file__).resolve().parent.parent / "icones"
FOND = (10, 10, 15)
VIOLET = (139, 156, 255)
ROSE = (255, 122, 182)


def ecrire_png(chemin, largeur, hauteur, pixels):
    """pixels : liste de lignes, chaque ligne = liste de (r, g, b, a)."""
    brut = b"".join(b"\x00" + bytes(c for px in ligne for c in px) for ligne in pixels)

    def bloc(type_, donnees):
        return struct.pack(">I", len(donnees)) + type_ + donnees + struct.pack(">I", zlib.crc32(type_ + donnees) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += bloc(b"IHDR", struct.pack(">IIBBBBB", largeur, hauteur, 8, 6, 0, 0, 0))  # 8 bits, RGBA
    png += bloc(b"IDAT", zlib.compress(brut, 9))
    png += bloc(b"IEND", b"")
    chemin.write_bytes(png)


def melanger(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def couverture(distance):
    """Anticrénelage : 1 à l'intérieur, 0 à l'extérieur, transition douce sur 1 pixel."""
    return max(0.0, min(1.0, 0.5 - distance))


def icone(taille, arrondi=True, marge=0.0):
    pixels = []
    centre = taille / 2
    rayon_point = taille * (0.17 - marge * 0.17)
    rayon_anneau = taille * (0.33 - marge * 0.33)
    epaisseur = max(1.5, taille * 0.035)
    rayon_coin = taille * 0.22
    for y in range(taille):
        ligne = []
        for x in range(taille):
            px, py = x + 0.5, y + 0.5
            # Fond : carré aux coins arrondis (ou plein pour l'icône "maskable")
            if arrondi:
                dx = max(abs(px - centre) - (centre - rayon_coin), 0)
                dy = max(abs(py - centre) - (centre - rayon_coin), 0)
                alpha_fond = couverture(math.hypot(dx, dy) - rayon_coin)
            else:
                alpha_fond = 1.0
            couleur = FOND
            d = math.hypot(px - centre, py - centre)
            t = max(0.0, min(1.0, (px + py) / (2 * taille)))  # dégradé en diagonale
            degrade = melanger(VIOLET, ROSE, t)
            # Anneau semi-transparent
            a = couverture(abs(d - rayon_anneau) - epaisseur / 2) * 0.45
            couleur = melanger(couleur, degrade, a)
            # Point central
            a = couverture(d - rayon_point)
            couleur = melanger(couleur, degrade, a)
            ligne.append((*couleur, round(255 * alpha_fond)))
        pixels.append(ligne)
    return pixels


def badge(taille):
    """Petite icône blanche sur fond transparent (barre d'état Android)."""
    centre = taille / 2
    pixels = []
    for y in range(taille):
        ligne = []
        for x in range(taille):
            d = math.hypot(x + 0.5 - centre, y + 0.5 - centre)
            a = max(couverture(d - taille * 0.18), couverture(abs(d - taille * 0.36) - taille * 0.04))
            ligne.append((255, 255, 255, round(255 * a)))
        pixels.append(ligne)
    return pixels


def main():
    DOSSIER.mkdir(exist_ok=True)
    for taille in (192, 512):
        ecrire_png(DOSSIER / f"icone-{taille}.png", taille, taille, icone(taille))
    # "maskable" : Android découpe l'icône en cercle/carré, le dessin doit rester au centre
    ecrire_png(DOSSIER / "icone-maskable-512.png", 512, 512, icone(512, arrondi=False, marge=0.2))
    # iPhone : fond plein (iOS arrondit lui-même les coins)
    ecrire_png(DOSSIER / "apple-touch-icon.png", 180, 180, icone(180, arrondi=False))
    ecrire_png(DOSSIER / "badge-96.png", 96, 96, badge(96))
    print("Icônes générées dans", DOSSIER)


if __name__ == "__main__":
    main()
