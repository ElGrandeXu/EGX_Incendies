# 🔥 EGX Incendies

Carte citoyenne, gratuite et mobile-first pour consulter les **détections thermiques satellites récentes autour de la ville de votre choix**.

👉 Application : **https://elgrandexu.github.io/EGX_Incendies/**

> [!IMPORTANT]
> Cette application n'est pas un service officiel d'alerte, d'évacuation ou de secours. En cas de danger immédiat, appelez le **112** ou le **18** et suivez les consignes des autorités locales.

## Démarrage rapide — 3 étapes

### 1. Obtenir une clé gratuite NASA FIRMS

Rendez-vous sur la page officielle :

**https://firms.modaps.eosdis.nasa.gov/api/map_key/**

1. Entrez votre adresse e-mail.
2. Ouvrez le message envoyé par la NASA.
3. Copiez la clé appelée `MAP_KEY`.

### 2. Ouvrir l'application

Accédez à :

**https://elgrandexu.github.io/EGX_Incendies/**

L'application fonctionne sur téléphone, tablette et ordinateur, sans installation.

### 3. Enregistrer la clé

1. Ouvrez le menu **☰ Réglages**.
2. Collez la clé dans **Clé NASA FIRMS**.
3. Appuyez sur **Enregistrer**.

La clé reste enregistrée uniquement dans le navigateur de l'appareil utilisé. Elle n'est pas incluse dans le dépôt GitHub.

> [!CAUTION]
> Ne publiez jamais votre clé dans un commit, une capture d'écran ou un message public.

## Utiliser la carte

### Changer de ville

1. Ouvrez **☰ Réglages**.
2. Saisissez une ville : `Marseille`, `Nice`, `Madrid`, etc.
3. Appuyez sur **Rechercher**.
4. Sélectionnez le bon résultat.
5. Appuyez sur **Utiliser cette ville**.

La carte, les distances et le vent sont alors recalculés autour de cette ville.

### Modifier la zone observée

Dans **Zone observée**, choisissez :

- un rayon de **50, 100, 150 ou 250 km** ;
- un historique de **24, 48 ou 72 heures**.

### Se déplacer sur la carte

- glissez avec le doigt ou la souris pour vous déplacer ;
- utilisez `+` et `−` pour zoomer ;
- utilisez `⌂` pour revenir sur la ville sélectionnée ;
- utilisez `↻` pour actualiser les données.

Les données sont également actualisées automatiquement toutes les 10 minutes lorsque l'application reste ouverte.

## Comprendre les informations affichées

### Couleur des détections

- 🔴 **rouge** : moins de 3 heures ;
- 🟠 **orange** : entre 3 et 12 heures ;
- 🟡 **jaune** : entre 12 et 24 heures ;
- 🔵 **bleu** : entre 24 et 72 heures.

### Points colorés

Chaque point représente une anomalie thermique repérée par les instruments satellites VIIRS ou MODIS.

Une détection peut correspondre à un incendie, mais aussi à un brûlage agricole, un site industriel ou une autre source de chaleur.

### Zones colorées en pointillés

Elles relient des détections proches observées pendant une même période afin de montrer une tendance visuelle.

Elles ne représentent **ni un périmètre officiel, ni une prévision de propagation**.

### Indicateurs en haut de l'écran

L'application affiche :

- le nombre de détections dans la zone choisie ;
- l'âge de la détection la plus récente ;
- la distance de la détection la plus proche ;
- la vitesse et la direction du vent actuel.

Le panneau de réglages précise également les rafales estimées.

## « Aucune détection » ne signifie pas « aucun danger »

L'absence de point peut signifier :

- qu'aucune anomalie thermique n'a été détectée ;
- que le satellite n'est pas encore repassé ;
- que les nuages ou la fumée ont limité l'observation ;
- que les données sont retardées ;
- qu'un service distant est temporairement indisponible.

Ne prenez jamais une décision d'évacuation ou de retour dans une zone touchée uniquement à partir de cette carte.

## Ajouter l'application à l'écran d'accueil

### Android

Dans Chrome : menu `⋮` → **Ajouter à l'écran d'accueil**.

### iPhone ou iPad

Dans Safari : **Partager** → **Sur l'écran d'accueil**.

L'application apparaîtra comme un raccourci, mais une connexion Internet reste nécessaire pour charger la carte et les données.

## Données et services utilisés

- **NASA FIRMS** : détections thermiques VIIRS S-NPP, VIIRS NOAA-20, VIIRS NOAA-21 et MODIS ;
- **OpenStreetMap** : fond cartographique ;
- **Leaflet** : navigation fluide sur la carte ;
- **Nominatim / OpenStreetMap** : recherche des villes ;
- **Open-Meteo** : vent actuel, direction et rafales.

## Vie privée

- aucun compte utilisateur ;
- aucun suivi publicitaire ajouté par le projet ;
- aucune géolocalisation obligatoire ;
- aucune clé NASA publiée dans le code ;
- la ville, les réglages et la clé sont conservés localement dans le navigateur.

Effacer les données du site dans le navigateur supprimera aussi la clé enregistrée.

## Fonctionnement technique

Le projet tient dans un unique fichier `index.html` : HTML, CSS et JavaScript côté navigateur.

Aucun serveur applicatif ni processus de compilation n'est nécessaire. Le site est publié directement avec GitHub Pages.

## Développement local

1. Clonez ou téléchargez le dépôt.
2. Ouvrez `index.html` dans un navigateur récent.
3. Entrez votre propre clé NASA FIRMS dans l'interface.

Certaines API peuvent appliquer des règles réseau ou de sécurité différentes lorsque le fichier est ouvert directement depuis le disque. Pour reproduire exactement GitHub Pages, servez le dossier avec un petit serveur HTTP local.

## Limites et responsabilité

EGX Incendies est un outil citoyen de visualisation et de compréhension. Il ne remplace pas :

- les alertes officielles ;
- les cartes des autorités ;
- les consignes d'évacuation ;
- les informations des pompiers et des préfectures ;
- les services d'urgence.

Les données peuvent être retardées, incomplètes ou mal interprétées.

## Licence

Projet distribué sous licence MIT. Consultez le fichier `LICENSE`.
