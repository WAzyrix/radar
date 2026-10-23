#!/usr/bin/env python3
"""
Disponibilité des animés en France sur ADN (Animation Digital Network).

ADN a une API publique (celle qu'utilise son propre site) qui donne :
  - son catalogue, avec les langues de chaque saison (VOSTFR, VF) ;
  - son calendrier, avec l'heure exacte de sortie en France de chaque épisode.

Résultat : data/adn.json, lu par le site pour afficher les heures VOSTFR/VF
et les langues disponibles saison par saison.

Le détail des saisons demande une requête par série : on ne rafraîchit à chaque
passage que les séries nouvelles, actives cette semaine, ou pas vues depuis 7 jours.

Lancement :  python3 scripts/collecte_adn.py          (passage normal)
             python3 scripts/collecte_adn.py --tout   (tout recharger)
"""

import json
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
FICHIER = RACINE / "data" / "adn.json"
API = "https://gw.api.animationdigitalnetwork.com"
ENTETES = {
    "x-target-distribution": "fr",   # catalogue français
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; RadarBot/1.0; +https://github.com/WAzyrix/radar)",
}
JOURS_CALENDRIER = 7        # on garde de J-7 à J+7
SAISONS_PAR_PASSAGE = 80    # séries dont on recharge les saisons à chaque passage
RAFRAICHIR_APRES = timedelta(days=7)
PAUSE = 0.25                # secondes entre deux requêtes, pour rester poli


def api(chemin):
    requete = urllib.request.Request(API + chemin, headers=ENTETES)
    with urllib.request.urlopen(requete, timeout=20) as reponse:
        donnees = json.load(reponse)
    time.sleep(PAUSE)
    return donnees


def lire_catalogue():
    """Toutes les séries (l'API renvoie 100 séries maximum par page)."""
    series, offset = [], 0
    while True:
        page = api(f"/show/catalog?limit=100&offset={offset}")
        series += page["shows"]
        offset += 100
        if offset >= page["total"]:
            return series


def lire_saisons(id_serie):
    """{"1": ["vf", "vostf"], "2": ["vostf"]} : langues disponibles par saison."""
    saisons = {}
    for video in api(f"/video/show/{id_serie}?limit=-1&order=asc")["videos"]:
        saisons.setdefault(video.get("season") or "1", set()).update(video.get("languages") or [])
    return {s: sorted(l) for s, l in saisons.items()}


def lire_calendrier():
    sorties = []
    aujourd_hui = date.today()
    for decalage in range(-JOURS_CALENDRIER, JOURS_CALENDRIER + 1):
        jour = aujourd_hui + timedelta(days=decalage)
        for v in api(f"/video/calendar?date={jour.isoformat()}")["videos"]:
            sorties.append({
                "serie": v["show"]["id"],
                "episode": v.get("shortNumber"),
                "saison": v.get("season") or "1",
                "date": v["releaseDate"],
                "langues": v.get("languages") or [],
                "url": v.get("url"),
            })
    return sorties


def main():
    tout_recharger = "--tout" in sys.argv
    maintenant = datetime.now(timezone.utc)

    try:
        ancien = {s["id"]: s for s in json.loads(FICHIER.read_text(encoding="utf-8"))["series"]}
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        ancien = {}

    catalogue = lire_catalogue()
    sorties = lire_calendrier()
    actives = {s["serie"] for s in sorties}
    print(f"ADN : {len(catalogue)} séries, {len(sorties)} sorties de J-{JOURS_CALENDRIER} à J+{JOURS_CALENDRIER}")

    # Quelles séries rafraîchir ? Les actives d'abord, puis les nouvelles, puis les plus anciennes
    def priorite(serie):
        precedent = ancien.get(serie["id"])
        if serie["id"] in actives:
            return (0, "")
        if not precedent:
            return (1, "")
        return (2, precedent.get("vu", ""))

    a_rafraichir = set()
    for serie in sorted(catalogue, key=priorite):
        precedent = ancien.get(serie["id"])
        perime = not precedent or maintenant - datetime.fromisoformat(precedent["vu"]) > RAFRAICHIR_APRES
        if tout_recharger or serie["id"] in actives or perime:
            a_rafraichir.add(serie["id"])
        if not tout_recharger and len(a_rafraichir) >= SAISONS_PAR_PASSAGE:
            break

    series = []
    for serie in catalogue:
        precedent = ancien.get(serie["id"], {})
        saisons, vu = precedent.get("saisons"), precedent.get("vu")
        if serie["id"] in a_rafraichir:
            try:
                saisons, vu = lire_saisons(serie["id"]), maintenant.isoformat(timespec="seconds")
            except Exception as erreur:  # une série en erreur ne bloque pas les autres
                print(f"  ✗ {serie['title']} : {erreur}")
        series.append({
            "id": serie["id"],
            "titre": serie["title"],
            "titreOriginal": serie.get("originalTitle"),
            "url": serie["url"],
            "langues": serie.get("languages") or [],
            "saisons": saisons or {},
            "vu": vu or "2000-01-01T00:00:00+00:00",
        })

    FICHIER.parent.mkdir(exist_ok=True)
    FICHIER.write_text(json.dumps({
        "maj": maintenant.isoformat(timespec="seconds"),
        "series": series,
        "sorties": sorties,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Version légère (calendrier seul) pour la vérification horaire des notifications
    (FICHIER.parent / "adn-sorties.json").write_text(json.dumps({
        "maj": maintenant.isoformat(timespec="seconds"),
        "sorties": sorties,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"→ data/adn.json : {len(series)} séries ({len(a_rafraichir)} rafraîchies), {len(sorties)} sorties (+ data/adn-sorties.json)")


if __name__ == "__main__":
    main()
