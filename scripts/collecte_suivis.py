#!/usr/bin/env python3
"""
Œuvres suivies sur le site : data/suivis.json, lu par la vérification horaire du relais.

Pourquoi ici et pas dans le relais ? AniList et MangaUpdates refusent les requêtes venant de
Cloudflare (AniList : 403 « You have been manually blocked », MangaUpdates : 403, constaté le
25/10/2026). GitHub Actions, lui, y a accès. Le relais lit donc ce fichier (et data/anilist.json
pour les épisodes) au lieu d'appeler ces API.

Le relais lance ce workflow toutes les heures en passant les identifiants AniList suivis
(entrées "animes" et "mangas" du workflow : des nombres séparés par des virgules, aucun code perso).
Sans eux (run planifié, push, bouton « Run workflow »), on reprend ceux du fichier précédent.

Contenu :
  animes : { id: { debut, suites: [{ id, debut, titre }] } }
           debut = date de début comparable (20240315) ; suites = relations SEQUEL vers un animé
  mangas : { id: { mu, tomes, chapitre, vu } }
           série MangaUpdates, dernier tome et dernier chapitre, date de la dernière lecture

Lancement : SUIVIS_ANIMES=21,16498 SUIVIS_MANGAS=30013 python3 scripts/collecte_suivis.py
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from collecte_anilist import ENTETES, anilist

RACINE = Path(__file__).resolve().parent.parent
FICHIER = RACINE / "data" / "suivis.json"
MU = "https://api.mangaupdates.com/v1"
LOT = 50                 # œuvres par page AniList
PAGES_PAR_REQUETE = 4    # pages regroupées en une requête (alias GraphQL)
MAX_IDS = 3000           # garde-fou
RELIRE_MANGA = 6 * 3600  # une série MangaUpdates est relue au plus toutes les 6 h
RECHERCHER_DE_NOUVEAU = 24 * 3600  # manga introuvable : nouvel essai le lendemain
MAX_REQUETES_MU = 60     # par passage (MangaUpdates n'a pas de limite publiée : on reste sobre)


def ids_depuis(variable, anciens):
    """Identifiants passés par le relais ("1,2,3"), sinon ceux du fichier précédent."""
    texte = os.environ.get(variable, "").strip()
    if not texte:
        return sorted(int(i) for i in anciens)
    if not re.fullmatch(r"\d{1,9}(,\d{1,9})*", texte):
        sys.exit(f"{variable} invalide : uniquement des nombres séparés par des virgules")
    return sorted({int(i) for i in texte.split(",")})[:MAX_IDS]


def date_debut(d):
    return d["year"] * 10000 + (d.get("month") or 1) * 100 + (d.get("day") or 1) if d and d.get("year") else None


def par_lots(ids, champs, type_media):
    """Fiches AniList de tous ces identifiants, 4 pages de 50 par requête."""
    lots = [ids[i:i + LOT] for i in range(0, len(ids), LOT)]
    medias = []
    for debut in range(0, len(lots), PAGES_PAR_REQUETE):
        alias = " ".join(
            f"l{n}: Page(perPage:{LOT}){{ media(id_in:[{','.join(map(str, lot))}], type:{type_media}){{ {champs} }} }}"
            for n, lot in enumerate(lots[debut:debut + PAGES_PAR_REQUETE])
        )
        data = anilist(f"query{{ {alias} }}", {})
        for bloc in data.values():
            medias += bloc["media"]
    return medias


def suites_des_animes(ids):
    champs = ("id startDate{year month day} relations{ edges{ relationType "
              "node{ id type startDate{year month day} title{romaji english} } } }")
    resultat = {}
    for m in par_lots(ids, champs, "ANIME"):
        resultat[str(m["id"])] = {
            "debut": date_debut(m["startDate"]),
            "suites": [
                {"id": e["node"]["id"], "debut": date_debut(e["node"]["startDate"]),
                 "titre": e["node"]["title"]["english"] or e["node"]["title"]["romaji"]}
                for e in m["relations"]["edges"]
                if e["relationType"] == "SEQUEL" and e["node"]["type"] == "ANIME"
            ],
        }
    return resultat


# ---------- MangaUpdates ----------
def normaliser(texte):
    sans_accents = "".join(c for c in unicodedata.normalize("NFD", texte or "") if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", sans_accents.lower()).strip()


def mu(chemin, corps=None):
    requete = urllib.request.Request(
        MU + chemin, data=json.dumps(corps).encode() if corps else None, method="POST" if corps else "GET",
        headers={**ENTETES, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(requete, timeout=30) as reponse:
        donnees = json.load(reponse)
    time.sleep(1)  # pour rester poli
    return donnees


def chercher_serie(titres):
    """Série MangaUpdates correspondant au manga (mêmes règles que l'ancienne recherche du relais)."""
    resultats = mu("/series/search", {"search": titres[0], "perpage": 15})["results"]
    # On écarte les doujinshis, anthologies, romans… et on préfère un titre identique
    candidats = [r["record"] for r in resultats
                 if r["record"].get("type") in ("Manga", "Manhwa", "Manhua")
                 and not re.search(r"\bdj\b|anthology|\(novel\)", r["record"]["title"], re.I)]
    voulus = {normaliser(t) for t in titres}
    choisi = next((r for r in candidats if normaliser(r["title"]) in voulus), candidats[0] if candidats else None)
    return choisi["series_id"] if choisi else None


def mangas_suivis(ids, anciens, maintenant):
    resultat = {str(i): anciens[str(i)] for i in ids if str(i) in anciens}
    requetes = 0

    # 1. Série MangaUpdates des nouveaux mangas (titres demandés à AniList, en une fois)
    a_chercher = [i for i in ids
                  if not resultat.get(str(i), {}).get("mu")
                  and maintenant - resultat.get(str(i), {}).get("vu", 0) >= RECHERCHER_DE_NOUVEAU]
    if a_chercher:
        for m in par_lots(a_chercher, "id title{romaji english native} synonyms", "MANGA"):
            if requetes >= MAX_REQUETES_MU:
                break
            titres = [t for t in (m["title"]["romaji"], m["title"]["english"], *m["synonyms"]) if t]
            requetes += 1
            try:
                serie = chercher_serie(titres) if titres else None
            except (urllib.error.URLError, OSError, KeyError, ValueError) as erreur:
                print(f"MangaUpdates : recherche de {titres[:1]} impossible ({erreur})")
                continue
            resultat[str(m["id"])] = {"mu": serie, "tomes": None, "chapitre": None, "vu": 0 if serie else maintenant}

    # 2. Dernier tome et dernier chapitre, des moins récemment lus aux plus récents
    a_relire = sorted((e["vu"], i) for i, e in resultat.items() if e.get("mu") and maintenant - e["vu"] >= RELIRE_MANGA)
    for _, i in a_relire:
        if requetes >= MAX_REQUETES_MU:
            break
        requetes += 1
        try:
            serie = mu(f"/series/{resultat[i]['mu']}")
        except (urllib.error.URLError, OSError, ValueError) as erreur:
            print(f"MangaUpdates : série {resultat[i]['mu']} illisible ({erreur})")
            continue
        tomes = re.search(r"(\d+)\s+Volumes?", serie.get("status") or "", re.I)
        resultat[i].update({
            "tomes": int(tomes.group(1)) if tomes else None,
            "chapitre": int(serie["latest_chapter"]) if serie.get("latest_chapter") else None,
            "vu": maintenant,
        })
    return resultat, requetes


def main():
    try:
        ancien = json.loads(FICHIER.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        ancien = {"animes": {}, "mangas": {}}
    ids_animes = ids_depuis("SUIVIS_ANIMES", ancien["animes"])
    ids_mangas = ids_depuis("SUIVIS_MANGAS", ancien["mangas"])
    maintenant = int(time.time())

    # Si AniList échoue, on garde les données précédentes de ces œuvres (le relais réessaiera)
    try:
        animes = suites_des_animes(ids_animes) if ids_animes else {}
    except (urllib.error.URLError, OSError, RuntimeError) as erreur:
        print(f"AniList : suites non lues ({erreur}), données précédentes gardées")
        animes = {str(i): ancien["animes"][str(i)] for i in ids_animes if str(i) in ancien["animes"]}
    try:
        mangas, requetes_mu = mangas_suivis(ids_mangas, ancien["mangas"], maintenant)
    except (urllib.error.URLError, OSError, RuntimeError) as erreur:
        print(f"Mangas : non lus ({erreur}), données précédentes gardées")
        mangas, requetes_mu = {str(i): ancien["mangas"][str(i)] for i in ids_mangas if str(i) in ancien["mangas"]}, 0

    resultat = {
        "genere": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "animes": animes,
        "mangas": mangas,
    }
    FICHIER.parent.mkdir(exist_ok=True)
    FICHIER.write_text(json.dumps(resultat, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    trouves = sum(1 for m in mangas.values() if m.get("mu"))
    print(f"Suivis : {len(animes)}/{len(ids_animes)} animés, {trouves}/{len(ids_mangas)} mangas trouvés "
          f"sur MangaUpdates ({requetes_mu} requêtes MangaUpdates).")


if __name__ == "__main__":
    main()
