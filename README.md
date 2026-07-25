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

La carte, les distances, les foyers probables, le vent et le risque de fumée sont alors recalculés autour de cette ville.

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

### Indicateurs en haut de l'écran

L'application affiche :

- le nombre de **foyers probables**, avec le nombre brut de détections NASA juste en dessous ;
- le **risque de fumée** estimé pour la ville observée ;
- la distance de la détection la plus proche ;
- la vitesse du vent et une flèche indiquant le sens vers lequel l'air se déplace.

Open-Meteo fournit la direction météorologique, c'est-à-dire la direction **d'où vient** le vent. L'application inverse visuellement cette direction pour que les flèches indiquent le déplacement de l'air et des fumées potentielles.

### Couleur des détections

- 🔴 **rouge** : moins de 3 heures ;
- 🟠 **orange** : entre 3 et 12 heures ;
- 🟡 **jaune** : entre 12 et 24 heures ;
- 🔵 **bleu** : entre 24 et 72 heures.

### Points colorés

Chaque point représente une anomalie thermique repérée par les instruments satellites VIIRS ou MODIS.

Une détection peut correspondre à un incendie, mais aussi à un brûlage agricole, un site industriel ou une autre source de chaleur.

### Foyers probables

Les détections proches dans l'espace et dans le temps sont regroupées automatiquement dans le navigateur afin de rendre la carte plus compréhensible.

- le compteur principal indique le nombre de groupes probables ;
- les badges `🔥` affichent le nombre de détections regroupées ;
- un halo discret aide à repérer l'échelle générale du groupe ;
- toucher un foyer dans la carte ou dans le panneau permet de le localiser ;
- les détections isolées restent identifiées séparément.

Un **foyer probable** est une aide à la lecture, pas la confirmation officielle d'un incendie distinct.

### Contours indicatifs au zoom

Pour les groupes importants, un contour pointillé peut apparaître lorsque la carte est suffisamment zoomée. Il est calculé localement à partir des positions des détections satellites.

Ce contour ne représente **ni un périmètre officiel du feu, ni la surface réellement brûlée, ni une prévision de propagation**.

### Zones colorées par période

Selon le mode d'affichage choisi, l'application peut aussi relier des détections proches observées pendant une même période afin de montrer une tendance visuelle.

Ces zones ne représentent pas un périmètre officiel.

### Risque de fumée

L'indicateur croise notamment :

- la position des détections de moins de 24 heures ;
- leur distance par rapport à la ville ;
- leur alignement avec le vent ;
- leur fraîcheur ;
- leur puissance thermique lorsqu'elle est disponible.

Il peut afficher **Faible**, **Modéré**, **Élevé**, **Très élevé** ou **Indisponible**.

Cet indicateur est pédagogique et non officiel. Il estime si le vent peut transporter des fumées depuis les détections vers la ville, mais il ne mesure pas directement la qualité de l'air et ne prévoit pas l'évolution d'un incendie.

Le panneau de réglages fournit une explication adaptée à la situation observée ainsi que la vitesse du vent, sa provenance météorologique et les rafales estimées.

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
- aucun suivi publicitaire ou outil d'analytics ajouté par le projet ;
- aucune géolocalisation obligatoire ;
- aucune clé NASA publiée dans le code ;
- la ville, les réglages et la clé sont conservés localement dans le navigateur ;
- le regroupement des foyers et le calcul du risque de fumée sont effectués localement côté navigateur.

Effacer les données du site dans le navigateur supprimera aussi la clé enregistrée.

## Fonctionnement technique

Le projet tient dans trois fichiers à la racine du dépôt :

- `index.html` : structure de l'interface et point d'entrée GitHub Pages ;
- `style.css` : présentation responsive et thèmes clair/sombre ;
- `app.js` : données, carte, interactions et préférences locales.

Aucun serveur applicatif ni processus de compilation n'est nécessaire. Le site est publié directement avec GitHub Pages.

## Développement local

1. Clonez ou téléchargez le dépôt.
2. Servez la racine du dépôt avec un serveur HTTP local.
3. Entrez votre propre clé NASA FIRMS dans l'interface.

Par exemple : `python -m http.server 8000`, puis ouvrez `http://localhost:8000/`.

## Limites et responsabilité

EGX Incendies est un outil citoyen de visualisation et de compréhension. Il ne remplace pas :

- les alertes officielles ;
- les cartes des autorités ;
- les consignes d'évacuation ;
- les informations des pompiers et des préfectures ;
- les services d'urgence.

Les données et les interprétations automatiques peuvent être retardées, incomplètes ou erronées.

## Licence

Projet distribué sous licence MIT. Consultez le fichier `LICENSE`.
