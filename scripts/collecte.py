#!/usr/bin/env python3
"""
Collecte des actus pour Radar.

Lit scripts/sources.json, télécharge chaque flux RSS/Atom, garde pour chaque
article uniquement : titre, source, date, extrait court (≤ 200 caractères) et lien.
Ajoute des tags par mots-clés, puis écrit un fichier JSON par catégorie dans data/.

Uniquement la bibliothèque standard de Python : rien à installer.
Lancement :  python3 scripts/collecte.py
"""

import hashlib
import html
import json
import re
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
FICHIER_SOURCES = RACINE / "scripts" / "sources.json"
DOSSIER_DATA = RACINE / "data"

LONGUEUR_EXTRAIT = 200          # droits d'auteur : extrait court seulement
ARTICLES_MAX = 300              # par catégorie
DUREE_CONSERVATION = timedelta(days=21)
USER_AGENT = "Mozilla/5.0 (compatible; RadarBot/1.0; +https://github.com/WAzyrix/radar)"

# Espaces de noms XML utilisés par les flux Atom et Dublin Core
ATOM = "{http://www.w3.org/2005/Atom}"
DC = "{http://purl.org/dc/elements/1.1/}"


# ---------------------------------------------------------------------------
# Nettoyage du texte
# ---------------------------------------------------------------------------

def texte_brut(contenu):
    """Retire les balises HTML et les espaces en trop."""
    if not contenu:
        return ""
    sans_balises = re.sub(r"<[^>]+>", " ", contenu)
    return re.sub(r"\s+", " ", html.unescape(sans_balises)).strip()


def couper(texte, longueur=LONGUEUR_EXTRAIT):
    """Coupe le texte à `longueur` caractères maximum, sans couper un mot."""
    if len(texte) <= longueur:
        return texte
    coupe = texte[: longueur - 1].rsplit(" ", 1)[0]
    return coupe.rstrip(" ,;:.-") + "…"


def sans_accents(texte):
    """'Vulnérabilité' -> 'Vulnerabilite' (pour comparer les mots-clés)."""
    decompose = unicodedata.normalize("NFD", texte)
    return "".join(c for c in decompose if unicodedata.category(c) != "Mn")


# ---------------------------------------------------------------------------
# Tags par mots-clés
# ---------------------------------------------------------------------------

def compiler_tags(tags):
    """
    Transforme la liste de mots-clés de sources.json en expressions régulières.
    Règles (pour écrire facilement ses mots-clés) :
      - "faille"  : mot entier, pluriel en s/x accepté ("failles")
      - "hack*"   : tout ce qui commence par "hack" (hacker, hacking…)
      - "IA"      : avec une majuscule, la casse compte (évite le "ai" de "j'ai")
    Les accents sont ignorés des deux côtés.
    """
    regles = {}
    for nom_tag, mots in tags.items():
        motifs_min, motifs_casse = [], []
        for mot in mots:
            prefixe = mot.endswith("*")
            mot = sans_accents(mot.rstrip("*"))
            motif = r"(?<!\w)" + re.escape(mot) + (r"\w*" if prefixe else r"[sx]?(?!\w)")
            (motifs_casse if mot != mot.lower() else motifs_min).append(motif)
        regles[nom_tag] = (
            re.compile("|".join(motifs_min), re.IGNORECASE) if motifs_min else None,
            re.compile("|".join(motifs_casse)) if motifs_casse else None,
        )
    return regles


def trouver_tags(texte, regles):
    texte = sans_accents(texte)
    return [nom for nom, (insensible, sensible) in regles.items()
            if (insensible and insensible.search(texte)) or (sensible and sensible.search(texte))]


# ---------------------------------------------------------------------------
# Lecture des flux
# ---------------------------------------------------------------------------

def telecharger(url):
    requete = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(requete, timeout=20) as reponse:
        return reponse.read()


def lire_date(valeur):
    """Accepte les deux formats courants : RSS (RFC 822) et Atom (ISO 8601)."""
    if not valeur:
        return None
    valeur = valeur.strip()
    try:
        date = parsedate_to_datetime(valeur)
    except (TypeError, ValueError):
        try:
            date = datetime.fromisoformat(valeur.replace("Z", "+00:00"))
        except ValueError:
            return None
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return date.astimezone(timezone.utc)


def lire_flux(contenu):
    """Renvoie une liste de dicts {titre, lien, date, resume} pour un flux RSS ou Atom."""
    racine = ET.fromstring(contenu)
    articles = []

    # RSS 2.0 : <item><title/><link/><pubDate/><description/></item>
    for item in racine.iter("item"):
        articles.append({
            "titre": item.findtext("title"),
            "lien": item.findtext("link"),
            "date": item.findtext("pubDate") or item.findtext(f"{DC}date"),
            "resume": item.findtext("description"),
        })

    # Atom : <entry><title/><link href=""/><updated/><summary/></entry>
    for entree in racine.iter(f"{ATOM}entry"):
        lien = entree.find(f"{ATOM}link[@rel='alternate']") or entree.find(f"{ATOM}link")
        articles.append({
            "titre": entree.findtext(f"{ATOM}title"),
            "lien": lien.get("href") if lien is not None else None,
            "date": entree.findtext(f"{ATOM}published") or entree.findtext(f"{ATOM}updated"),
            "resume": entree.findtext(f"{ATOM}summary") or entree.findtext(f"{ATOM}content"),
        })

    return articles


def collecter_source(source, regles):
    articles = []
    for brut in lire_flux(telecharger(source["url"])):
        titre = texte_brut(brut["titre"])
        lien = (brut["lien"] or "").strip()
        date = lire_date(brut["date"])
        if not titre or not lien.startswith("http") or not date:
            continue
        resume = texte_brut(brut["resume"])
        extrait = couper(resume)
        articles.append({
            "id": hashlib.sha1(lien.encode()).hexdigest()[:12],
            "titre": titre,
            "lien": lien,
            "source": source["nom"],
            "date": date.isoformat(timespec="seconds"),
            "extrait": extrait,
            # Les tags sont cherchés dans tout le résumé (pas seulement l'extrait affiché)
            "tags": trouver_tags(f"{titre} {resume}", regles),
            **({"zone": source["zone"]} if "zone" in source else {}),
        })
    return articles


# ---------------------------------------------------------------------------
# Programme principal
# ---------------------------------------------------------------------------

def charger_existants(fichier):
    """Relit le JSON précédent : un flux en panne ne fait pas disparaître ses articles."""
    try:
        return json.loads(fichier.read_text(encoding="utf-8"))["articles"]
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        return []


def main():
    categories = json.loads(FICHIER_SOURCES.read_text(encoding="utf-8"))
    DOSSIER_DATA.mkdir(exist_ok=True)
    maintenant = datetime.now(timezone.utc)
    limite = maintenant - DUREE_CONSERVATION
    erreurs_totales = 0

    for cle, categorie in categories.items():
        regles = compiler_tags(categorie["tags"])
        fichier = DOSSIER_DATA / f"{cle}.json"

        # On part des anciens articles, puis les nouveaux écrasent les doublons (même id)
        articles = {a["id"]: a for a in charger_existants(fichier)}
        erreurs = []
        for source in categorie["sources"]:
            try:
                nouveaux = collecter_source(source, regles)
                articles.update({a["id"]: a for a in nouveaux})
                print(f"  ✓ {cle:7} {source['nom']:18} {len(nouveaux):3} articles")
            except Exception as erreur:  # un flux cassé ne doit pas bloquer les autres
                erreurs.append(source["nom"])
                print(f"  ✗ {cle:7} {source['nom']:18} ERREUR : {erreur}")

        # Tri du plus récent au plus ancien, on retire les trop vieux et les dates dans le futur
        liste = sorted(
            (a for a in articles.values()
             if limite <= datetime.fromisoformat(a["date"]) <= maintenant + timedelta(hours=1)),
            key=lambda a: a["date"], reverse=True,
        )[:ARTICLES_MAX]

        resultat = {
            "categorie": categorie["nom"],
            "maj": maintenant.isoformat(timespec="seconds"),
            "sources": [s["nom"] for s in categorie["sources"]],
            "tags": list(categorie["tags"].keys()),
            "erreurs": erreurs,
            "articles": liste,
        }
        fichier.write_text(json.dumps(resultat, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"→ data/{cle}.json : {len(liste)} articles\n")
        erreurs_totales += len(erreurs)

    # Si absolument tout a échoué, on le signale (le workflow passera en rouge)
    nb_sources = sum(len(c["sources"]) for c in categories.values())
    if erreurs_totales == nb_sources:
        raise SystemExit("Aucun flux n'a pu être lu.")


if __name__ == "__main__":
    main()
