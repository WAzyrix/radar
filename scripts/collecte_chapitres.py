#!/usr/bin/env python3
"""
Calendrier des chapitres de manga : data/chapitres.json (page Animés, section Scans, et
notifications « Nouveau tome ou chapitre de manga » du relais).

Sources :
  - MangaUpdates (/v1/releases/days) : les chapitres sortis ces 2 derniers jours, toutes
    séries confondues, en UNE requête. Ce sont des sorties signalées par les lecteurs : la
    plupart viennent de groupes de scans. On n'affiche ni ces groupes ni de lien vers eux :
    seulement « Officiel · MANGA Plus » quand la sortie vient d'une plateforme officielle.
  - AniList : la fiche correspondante (affiche, lien vers la fiche Radar) et ses liens
    externes « STREAMING », qui sont des plateformes officielles (MANGA Plus, Webtoon,
    Piccoma, VIZ, l'éditeur…). Pas de plateforme officielle connue : pas de lien.
  - À venir : déduit du rythme des sorties officielles de chaque série (hebdomadaire, toutes
    les 2 semaines). Ex : les séries du Weekly Shōnen Jump sortent chaque dimanche à 15 h UTC
    sur MANGA Plus (minuit au Japon).

Correspondances MangaUpdates -> AniList, liens et rythmes sont gardés d'un passage à l'autre
dans data/chapitres-series.json (le site ne le lit pas). Les mangas suivis sur le site
(data/suivis.json, scripts/collecte_suivis.py) donnent les correspondances les plus sûres.

Conditions d'utilisation de l'API MangaUpdates : citer MangaUpdates, espacer les requêtes.
Lancement : python3 scripts/collecte_chapitres.py (après collecte_suivis.py)
"""

import json
import re
import time
import urllib.error
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from collecte_anilist import anilist
from collecte_suivis import mu, normaliser

RACINE = Path(__file__).resolve().parent.parent
FICHIER = RACINE / "data" / "chapitres.json"
CACHE = RACINE / "data" / "chapitres-series.json"
SUIVIS = RACINE / "data" / "suivis.json"
PARIS = ZoneInfo("Europe/Paris")
JOUR = 86400

# Groupes MangaUpdates qui sont des plateformes ou éditeurs officiels
OFFICIELS = {
    "manga plus", "viz", "line webtoon", "webtoon", "k manga", "kodansha", "kodansha comics", "yen press",
    "seven seas", "seven seas entertainment", "azuki", "inkr", "comikey", "tapas", "tappytoon", "lezhin",
    "lezhin comics", "pocket comics", "manga up", "manga up!", "piccoma", "shonen jump plus", "square enix",
    "square enix manga", "j novel club", "mangamo", "global manga", "comic walker", "shueisha",
    "naver webtoon", "kakaopage", "kakao webtoon", "bilibili comics", "ono", "mangas io", "izneo",
}
GENRES_ADULTES = {"hentai", "adult", "smut"}
LANGUES = {"French": 0, "English": 1, "Japanese": 2}  # ordre des liens (le reste après)

RECHERCHES_ANILIST = 12   # requêtes AniList par passage (10 titres chacune)
TITRES_PAR_REQUETE = 10
FICHES_MU = 25            # séries MangaUpdates lues par passage (genres, image) quand AniList ne les connaît pas
HISTORIQUES_MU = 10       # historiques de sorties officielles lus par passage (pour « à venir »)
RECHERCHER_DE_NOUVEAU = 7 * JOUR
JOURS_GARDES = 3          # hier, avant-hier… restent affichés même quand le flux les a oubliés
HORIZON = 7               # « à venir » : les 7 prochains jours


def officiel(groupes):
    return next((g["name"] for g in groupes if normaliser(g["name"]) in OFFICIELS
                 or g["name"].lower() in OFFICIELS), None)


def numero(chapitre):
    """« 127 » -> 127.0 ; « 12-13 » -> 13.0 ; « Oneshot » -> None."""
    nombres = re.findall(r"\d+(?:\.\d+)?", str(chapitre or ""))
    return float(nombres[-1]) if nombres else None


def liens_officiels(media):
    liens, sites = [], set()
    for l in sorted(media.get("externalLinks") or [], key=lambda l: LANGUES.get(l.get("language"), 9)):
        if l.get("type") != "STREAMING" or not str(l.get("url", "")).startswith("https://") or l["site"] in sites:
            continue
        sites.add(l["site"])
        liens.append({"site": l["site"], "url": l["url"], "langue": l.get("language")})
    # En français ou en anglais de préférence ; une plateforme en VO seulement s'il n'y a rien d'autre
    lisibles = [l for l in liens if l["langue"] in ("French", "English")]
    return lisibles[:3] or liens[:1]


def fiche_anilist(media):
    return {
        "anilist": media["id"],
        "titre": media["title"]["english"] or media["title"]["romaji"],
        "image": (media.get("coverImage") or {}).get("large"),
        "couleur": (media.get("coverImage") or {}).get("color"),
        "liens": liens_officiels(media),
        "adulte": bool(media.get("isAdult")),
    }


CHAMPS = "id isAdult title{romaji english native} synonyms coverImage{large color} externalLinks{site type language url}"


def chercher_sur_anilist(series):
    """[(id MU, titre MU)] -> {id MU: fiche AniList}, si un titre correspond exactement."""
    trouves = {}
    for debut in range(0, len(series), TITRES_PAR_REQUETE):
        lot = series[debut:debut + TITRES_PAR_REQUETE]
        variables = {f"t{i}": titre for i, (_, titre) in enumerate(lot)}
        alias = " ".join(f"s{i}: Page(perPage:5){{ media(search:$t{i}, type:MANGA){{ {CHAMPS} }} }}" for i in range(len(lot)))
        data = anilist(f"query({', '.join(f'$t{i}:String' for i in range(len(lot)))}){{ {alias} }}", variables)
        time.sleep(1)
        for i, (id_mu, titre) in enumerate(lot):
            voulu = normaliser(titre).replace(" ", "")
            for m in data[f"s{i}"]["media"]:
                noms = [m["title"]["romaji"], m["title"]["english"], m["title"]["native"], *m["synonyms"]]
                if any(n and normaliser(n).replace(" ", "") == voulu for n in noms):
                    trouves[id_mu] = fiche_anilist(m)
                    break
    return trouves


def fiches_par_id(ids):
    """{id AniList: fiche} pour les mangas suivis (correspondance déjà connue)."""
    resultat = {}
    for debut in range(0, len(ids), 50):
        data = anilist(f"query($ids:[Int]){{ Page(perPage:50){{ media(id_in:$ids, type:MANGA){{ {CHAMPS} }} }} }}",
                       {"ids": ids[debut:debut + 50]})
        time.sleep(1)
        for m in data["Page"]["media"]:
            resultat[m["id"]] = fiche_anilist(m)
    return resultat


def rythme(dates):
    """Intervalle habituel (7 ou 14 jours) des dernières sorties officielles, ou None."""
    jours = sorted({date.fromisoformat(d) for d in dates})[-7:]
    ecarts = [(b - a).days for a, b in zip(jours, jours[1:])]
    if len(ecarts) < 3:
        return None
    for intervalle in (7, 14):
        if sum(1 for e in ecarts if e == intervalle) * 2 >= len(ecarts):
            return intervalle
    return None


def prevoir(serie, aujourdhui):
    """Prochaine sortie officielle attendue (dans les HORIZON jours), ou None."""
    intervalle = rythme(serie.get("officiels", []))
    if not intervalle:
        return None
    derniere = max(date.fromisoformat(d) for d in serie["officiels"])
    prochaine = derniere + timedelta(days=intervalle)
    while prochaine <= aujourdhui:
        prochaine += timedelta(days=intervalle)
    # Plus de deux rythmes sans sortie : pause, on ne devine plus
    if (prochaine - derniere).days > 2 * intervalle or (prochaine - aujourdhui).days > HORIZON:
        return None
    prevision = {"date": prochaine.isoformat(), "rythme": intervalle, "plateforme": serie.get("plateforme")}
    # MANGA Plus publie les séries du Weekly Shōnen Jump à minuit au Japon (15 h UTC la veille)
    if normaliser(serie.get("plateforme") or "") == "manga plus" and prochaine.weekday() == 6:
        prevision["heure"] = f"{prochaine.isoformat()}T15:00:00Z"
    if serie.get("dernier") is not None and float(serie["dernier"]).is_integer():
        prevision["chapitre"] = str(int(serie["dernier"]) + 1)
    return prevision


def main():
    maintenant = int(time.time())
    aujourdhui = datetime.now(PARIS).date()
    try:
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        cache = {"series": {}}
    series = cache["series"]
    try:
        precedent = json.loads(FICHIER.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        precedent = {"jours": {}}
    try:
        suivis = json.loads(SUIVIS.read_text(encoding="utf-8")).get("mangas", {})
    except (FileNotFoundError, ValueError):
        suivis = {}

    # 1. Les sorties des 2 derniers jours, une entrée par série et par chapitre
    flux = mu("/releases/days?page=1&include_metadata=true")["results"]
    sorties = {}
    for r in flux:
        rec, serie = r["record"], (r.get("metadata") or {}).get("series") or {}
        if not serie.get("series_id"):
            continue
        cle = (str(serie["series_id"]), str(rec.get("chapter") or ""), str(rec.get("volume") or ""))
        s = sorties.setdefault(cle, {"date": rec["release_date"], "titre": serie.get("title") or rec["title"], "groupes": []})
        s["date"] = min(s["date"], rec["release_date"])
        s["groupes"] += rec.get("groups") or []
    print(f"MangaUpdates : {len(flux)} sorties, {len(sorties)} chapitres distincts.")

    # 2. Correspondances : d'abord les mangas suivis (sûres), puis une recherche par titre
    par_mu = {str(e["mu"]): int(i) for i, e in suivis.items() if e.get("mu")}
    a_completer = [a for m, a in par_mu.items() if m in {c[0] for c in sorties} and not series.get(m, {}).get("anilist")]
    if a_completer:
        try:
            fiches = fiches_par_id(a_completer)
            for id_mu, a in par_mu.items():
                if a in fiches:
                    series.setdefault(id_mu, {}).update(fiches[a], cherche=maintenant)
        except (urllib.error.URLError, OSError, RuntimeError) as erreur:
            print(f"AniList : mangas suivis non lus ({erreur})")

    titres = {}
    for (id_mu, _, _), s in sorties.items():
        titres.setdefault(id_mu, (s["titre"], officiel(s["groupes"])))
    a_chercher = [(m, t) for m, (t, off) in sorted(titres.items(), key=lambda x: x[1][1] is None)
                  if m not in series or (not series[m].get("anilist") and not series[m].get("mu_lu")
                                         and maintenant - series[m].get("cherche", 0) >= RECHERCHER_DE_NOUVEAU)]
    a_chercher = a_chercher[:RECHERCHES_ANILIST * TITRES_PAR_REQUETE]
    try:
        trouves = chercher_sur_anilist(a_chercher)
    except (urllib.error.URLError, OSError, RuntimeError) as erreur:
        print(f"AniList : recherche interrompue ({erreur})")
        trouves, a_chercher = {}, []
    for id_mu, _ in a_chercher:
        series.setdefault(id_mu, {})["cherche"] = maintenant
        if id_mu in trouves:
            series[id_mu].update(trouves[id_mu])

    # 3. Pas sur AniList : la fiche MangaUpdates (genres pour écarter les séries pour adultes, image)
    lues = 0
    for id_mu in titres:
        e = series.get(id_mu, {})
        if e.get("anilist") or e.get("mu_lu") or not e.get("cherche") or lues >= FICHES_MU:
            continue
        lues += 1
        try:
            fiche = mu(f"/series/{id_mu}")
        except (urllib.error.URLError, OSError, ValueError) as erreur:
            print(f"MangaUpdates : série {id_mu} illisible ({erreur})")
            continue
        genres = {g["genre"].lower() for g in fiche.get("genres") or []}
        image = ((fiche.get("image") or {}).get("url") or {}).get("thumb")
        e.update(mu_lu=maintenant, titre=fiche.get("title"), adulte=bool(genres & GENRES_ADULTES),
                 image=image if str(image or "").startswith("https://") else None)
        series[id_mu] = e

    # 4. Sorties officielles : on les retient (rythme), en lisant une fois l'historique des nouvelles séries
    for (id_mu, chapitre, _), s in sorties.items():
        plateforme = officiel(s["groupes"])
        if not plateforme:
            continue
        e = series.setdefault(id_mu, {})
        e["plateforme"] = plateforme
        e["officiels"] = sorted(set(e.get("officiels", [])) | {s["date"]})[-12:]
        if numero(chapitre) is not None and numero(chapitre) >= (e.get("dernier") or 0):
            e["dernier"] = numero(chapitre)
    historiques = 0
    for id_mu, e in series.items():
        if not e.get("plateforme") or e.get("historique_lu") or historiques >= HISTORIQUES_MU:
            continue
        historiques += 1
        try:
            passe = mu("/releases/search", {"search": id_mu, "search_type": "series", "perpage": 40, "orderby": "date"})["results"]
        except (urllib.error.URLError, OSError, ValueError) as erreur:
            print(f"MangaUpdates : historique de {id_mu} illisible ({erreur})")
            continue
        dates = [r["record"]["release_date"] for r in passe if officiel(r["record"].get("groups") or [])]
        e["officiels"] = sorted(set(e.get("officiels", [])) | set(dates))[-12:]
        e["historique_lu"] = maintenant

    # 5. Le calendrier : jours récents (gardés d'un passage à l'autre) + à venir
    def entree(id_mu, chapitre, volume, s):
        e = series.get(id_mu, {})
        return {
            "mu": int(id_mu), "titre": e.get("titre") or s["titre"], "chapitre": chapitre or None, "tome": volume or None,
            "officiel": officiel(s["groupes"]), "anilist": e.get("anilist"), "image": e.get("image"),
            "couleur": e.get("couleur"), "liens": e.get("liens", []),
        }

    limite = (aujourdhui - timedelta(days=JOURS_GARDES)).isoformat()
    jours = {j: l for j, l in precedent.get("jours", {}).items() if j >= limite}
    nouveaux = {}
    for (id_mu, chapitre, volume), s in sorties.items():
        e = series.get(id_mu, {})
        # Séries pour adultes, ou pas encore identifiées (on ne sait pas si elles le sont) : pas affichées
        if e.get("adulte") or not (e.get("anilist") or e.get("mu_lu")):
            continue
        nouveaux.setdefault(s["date"], []).append(entree(id_mu, chapitre, volume, s))
    for j, liste in nouveaux.items():
        if j >= limite:
            # Le flux est la référence pour ses jours : il remplace l'ancienne liste (fiches à jour)
            connus = {(x["mu"], x["chapitre"]) for x in liste}
            jours[j] = liste + [x for x in jours.get(j, []) if (x["mu"], x["chapitre"]) not in connus]
    for liste in jours.values():
        liste.sort(key=lambda x: (x["officiel"] is None, x["anilist"] is None, normaliser(x["titre"])))

    avenir = []
    for id_mu, e in series.items():
        if e.get("adulte") or not e.get("plateforme"):
            continue
        prevision = prevoir(e, aujourdhui)
        if prevision:
            avenir.append({"mu": int(id_mu), "titre": e.get("titre"), "anilist": e.get("anilist"), "image": e.get("image"),
                           "couleur": e.get("couleur"), "liens": e.get("liens", []), **prevision})
    avenir.sort(key=lambda x: (x.get("heure") or x["date"], normaliser(x["titre"] or "")))

    resultat = {
        "genere": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "jours": dict(sorted(jours.items())),
        "avenir": avenir,
    }
    FICHIER.write_text(json.dumps(resultat, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    connues = sum(1 for m in titres if series.get(m, {}).get("anilist"))
    print(f"Chapitres : {sum(map(len, jours.values()))} affichés sur {len(jours)} jours, {len(avenir)} à venir ; "
          f"{connues}/{len(titres)} séries reliées à AniList ({len(trouves)} nouvelles), {lues} fiches et "
          f"{historiques} historiques MangaUpdates lus.")


if __name__ == "__main__":
    main()
