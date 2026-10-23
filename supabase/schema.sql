-- =========================================================
-- Radar V3 : comptes et groupe de potes (Supabase / PostgreSQL)
--
-- À exécuter UNE fois dans Supabase : SQL Editor → New query → coller → Run.
--
-- Sécurité : la clé "anon" du site est publique, donc TOUT passe par les règles RLS
-- (Row Level Security) ci-dessous. Une règle dit, pour chaque ligne, qui peut la lire
-- ou l'écrire. auth.uid() = l'identifiant de la personne connectée.
-- =========================================================

-- ---------- Tables ----------

-- Profil visible par les membres de mes groupes
create table public.profils (
  id uuid primary key references auth.users on delete cascade,
  pseudo text not null check (char_length(pseudo) between 2 and 24),
  avatar text not null default '🎮' check (char_length(avatar) <= 8),
  cree_le timestamptz not null default now()
);

-- Code perso (lien avec le relais Cloudflare et les notifications) : visible par soi seul.
-- Séparé de "profils" car RLS protège des lignes entières, pas des colonnes.
create table public.codes (
  id uuid primary key references auth.users on delete cascade,
  code text not null check (code ~ '^[a-f0-9]{32}$')
);

create table public.groupes (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(nom) between 2 and 40),
  -- code d'invitation à partager (12 caractères aléatoires)
  invitation text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  cree_par uuid not null references auth.users on delete cascade,
  cree_le timestamptz not null default now()
);

create table public.membres (
  groupe_id uuid not null references public.groupes on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  rejoint_le timestamptz not null default now(),
  primary key (groupe_id, user_id)
);

-- Copie de "Ma liste", pour que mes potes voient ce que je suis
create table public.listes (
  user_id uuid primary key references auth.users on delete cascade,
  items jsonb not null default '[]',
  maj bigint not null default 0
);

create table public.recommandations (
  id bigint generated always as identity primary key,
  de uuid not null references auth.users on delete cascade,
  a uuid not null references auth.users on delete cascade,
  item jsonb not null,
  message text check (char_length(message) <= 280),
  vue boolean not null default false,
  cree_le timestamptz not null default now()
);
create index on public.recommandations (a, cree_le desc);

-- ---------- Fonctions utilitaires ----------
-- "security definer" : la fonction s'exécute avec les droits de son créateur,
-- ce qui permet de consulter "membres" sans boucler sur ses propres règles RLS.

-- Suis-je membre de ce groupe ?
create function public.est_membre(g uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from membres where groupe_id = g and user_id = auth.uid());
$$;

-- Cette personne est-elle dans un de mes groupes ?
create function public.partage_un_groupe(autre uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from membres m1 join membres m2 on m1.groupe_id = m2.groupe_id
    where m1.user_id = auth.uid() and m2.user_id = autre
  );
$$;

-- Créer un groupe (et en devenir membre) en une seule opération
create function public.creer_groupe(nom_groupe text) returns public.groupes
language plpgsql security definer set search_path = public as $$
declare g groupes;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  insert into groupes (nom, cree_par) values (trim(nom_groupe), auth.uid()) returning * into g;
  insert into membres (groupe_id, user_id) values (g.id, auth.uid());
  return g;
end $$;

-- Rejoindre un groupe avec son code d'invitation
create function public.rejoindre_groupe(code_invitation text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select id into g from groupes where invitation = lower(trim(code_invitation));
  if g is null then raise exception 'Invitation inconnue'; end if;
  insert into membres (groupe_id, user_id) values (g, auth.uid()) on conflict do nothing;
  return g;
end $$;

-- ---------- Règles de sécurité (RLS) ----------
alter table public.profils enable row level security;
alter table public.codes enable row level security;
alter table public.groupes enable row level security;
alter table public.membres enable row level security;
alter table public.listes enable row level security;
alter table public.recommandations enable row level security;

-- Profils : je vois le mien et ceux de mes potes ; je ne modifie que le mien
create policy "profils_lire" on public.profils for select using (id = auth.uid() or public.partage_un_groupe(id));
create policy "profils_creer" on public.profils for insert with check (id = auth.uid());
create policy "profils_modifier" on public.profils for update using (id = auth.uid()) with check (id = auth.uid());

-- Codes : uniquement le mien
create policy "codes_moi" on public.codes for all using (id = auth.uid()) with check (id = auth.uid());

-- Groupes : je vois ceux dont je suis membre ; le créateur peut le supprimer
-- (la création passe par la fonction creer_groupe)
create policy "groupes_lire" on public.groupes for select using (public.est_membre(id));
create policy "groupes_supprimer" on public.groupes for delete using (cree_par = auth.uid());

-- Membres : je vois les membres de mes groupes ; je peux quitter un groupe
create policy "membres_lire" on public.membres for select using (public.est_membre(groupe_id));
create policy "membres_quitter" on public.membres for delete using (user_id = auth.uid());

-- Listes : la mienne en écriture ; celles de mes potes en lecture
create policy "listes_lire" on public.listes for select using (user_id = auth.uid() or public.partage_un_groupe(user_id));
create policy "listes_creer" on public.listes for insert with check (user_id = auth.uid());
create policy "listes_modifier" on public.listes for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Recommandations : je vois celles que j'envoie ou reçois ; je n'en envoie qu'à mes potes ;
-- je marque comme "vues" celles que je reçois
create policy "reco_lire" on public.recommandations for select using (de = auth.uid() or a = auth.uid());
create policy "reco_envoyer" on public.recommandations for insert with check (de = auth.uid() and public.partage_un_groupe(a));
create policy "reco_marquer_vue" on public.recommandations for update using (a = auth.uid()) with check (a = auth.uid());
