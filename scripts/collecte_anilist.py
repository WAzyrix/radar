#!/usr/bin/env python3
"""
Pré-génère les données AniList de l'accueil et du calendrier : data/anilist.json.

AniList limite chaque adresse IP à 30 requêtes par minute (90 hors "mode dégradé"),
puis bloque une minute. Avec ce fichier, l'accueil et le calendrier de la page Animés
n'appellent plus AniList du tout : le navigateur lit le JSON (régénéré toutes les heures
par GitHub Actions). S'il est trop vieux ou absent, le site interroge AniList comme avant.

Contenu :
  - tendances : les 20 animés en tendance ;
  - saison : les 20 mieux notés de la saison en cours ;
  - calendrier : tous les épisodes diffusés d'avant-hier à J+7 (minuit, heure de Paris),
    assez large pour les jours affichés (hier -> J+5) dans tous les fuseaux d'Europe.

Les champs demandés sont les mêmes que dans js/api/animes.js (CHAMPS_CARTE, calendrierDuJour) :
si on en change un, changer l'autre.

Lancement : python3 scripts/collecte_anilist.py
"""

import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

RACINE = Path(__file__).resolve().parent.parent
FICHIER = RACINE / "data" / "anilist.json"
API = "https://graphql.anilist.co"
PARIS = ZoneInfo("Europe/Paris")
ENTETES = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; RadarBot/1.0; +https://github.com/WAzyrix/radar)",
}

CHAMPS_CARTE = "id title{romaji english} coverImage{extraLarge large color} averageScore format seasonYear episodes genres status"
CHAMPS_EPISODE = "episode airingAt media{ id isAdult popularity episodes title{romaji english native} synonyms coverImage{large color} }"
PAGES_PAR_REQUETE = 4   # pages de 50 épisodes regroupées en une seule requête (alias GraphQL)
MAX_PAGES = 16          # garde-fou : 800 épisodes sur 9 jours


def anilist(query, variables, essai=1):
    corps = json.dumps({"query": query, "variables": variables}).encode()
    requete = urllib.request.Request(API, data=corps, headers=ENTETES, method="POST")
    try:
        with urllib.request.urlopen(requete, timeout=30) as reponse:
            donnees = json.load(reponse)
    except urllib.error.HTTPError as erreur:
        # Trop de requêtes : on attend le temps demandé, une seule fois
        if erreur.code == 429 and essai < 2:
            time.sleep(min(int(erreur.headers.get("Retry-After") or 60), 90) + 1)
            return anilist(query, variables, essai + 1)
        raise
    if donnees.get("errors") or not donnees.get("data"):
        raise RuntimeError(f"AniList : {donnees.get('errors')}")
    time.sleep(1)  # pour rester poli
    return donnees["data"]


def saison_actuelle(maintenant):
    return ["WINTER", "SPRING", "SUMMER", "FALL"][(maintenant.month - 1) // 3], maintenant.year


def tendances_et_saison(maintenant):
    saison, annee = saison_actuelle(maintenant)
    data = anilist(f"""query($saison:MediaSeason, $annee:Int){{
      tendances: Page(perPage:20){{ media(type:ANIME, sort:TRENDING_DESC, isAdult:false){{ {CHAMPS_CARTE} bannerImage description }} }}
      saison: Page(perPage:20){{ media(type:ANIME, season:$saison, seasonYear:$annee, sort:SCORE_DESC, isAdult:false, popularity_greater:3000){{ {CHAMPS_CARTE} }} }}
    }}""", {"saison": saison, "annee": annee})
    return data["tendances"]["media"], {"nom": saison, "annee": annee, "medias": data["saison"]["media"]}


def calendrier(de, a):
    """Épisodes avec de <= airingAt < a, plusieurs pages par requête grâce aux alias."""
    episodes, page = [], 1
    while page <= MAX_PAGES:
        alias = " ".join(
            f"p{page + i}: Page(page:{page + i}, perPage:50){{ pageInfo{{ hasNextPage }} "
            f"airingSchedules(airingAt_greater:$a, airingAt_lesser:$b, sort:TIME){{ {CHAMPS_EPISODE} }} }}"
            for i in range(PAGES_PAR_REQUETE)
        )
        data = anilist(f"query($a:Int, $b:Int){{ {alias} }}", {"a": de - 1, "b": a})
        suite = False
        for i in range(PAGES_PAR_REQUETE):
            bloc = data[f"p{page + i}"]
            episodes += bloc["airingSchedules"]
            suite = bloc["pageInfo"]["hasNextPage"]
            if not suite:
                break
        if not suite:
            break
        page += PAGES_PAR_REQUETE
    # Les épisodes pour adultes ne sont jamais affichés : inutile de les publier
    return [e for e in episodes if not e["media"]["isAdult"]]


def main():
    maintenant = datetime.now(PARIS)
    minuit = maintenant.replace(hour=0, minute=0, second=0, microsecond=0)
    de = int((minuit - timedelta(days=2)).timestamp())
    a = int((minuit + timedelta(days=8)).timestamp())

    tendances, saison = tendances_et_saison(maintenant)
    episodes = calendrier(de, a)

    resultat = {
        "genere": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tendances": tendances,
        "saison": saison,
        "calendrier": {"de": de, "a": a, "episodes": episodes},
    }
    FICHIER.parent.mkdir(exist_ok=True)
    FICHIER.write_text(json.dumps(resultat, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"AniList : {len(tendances)} tendances, {len(saison['medias'])} de la saison, {len(episodes)} épisodes.")


if __name__ == "__main__":
    main()
