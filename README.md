# 🔥 EGX Incendies

Une carte légère et portable pour visualiser les **détections thermiques satellites autour de Bordeaux**, en Gironde et dans les Landes.

L'application fonctionne directement dans un navigateur, sur téléphone comme sur ordinateur. Elle s'appuie sur les données publiques **NASA FIRMS** et sur un fond de carte **OpenStreetMap**.

> [!IMPORTANT]
> Cette application n'est pas un service officiel d'alerte, d'évacuation ou de secours. Une détection satellite peut correspondre à un incendie, mais aussi à un brûlage agricole, un site industriel ou une autre anomalie thermique. En cas de danger immédiat, appelez le **112** ou le **18**.

## À quoi sert l'application ?

Elle permet de :

- voir les détections thermiques récentes autour de Bordeaux ;
- distinguer les détections selon leur ancienneté ;
- choisir un rayon de 50 à 250 km ;
- consulter les dernières détections et leur distance par rapport à Bordeaux ;
- observer une tendance temporelle grâce aux zones colorées ;
- actualiser automatiquement les données toutes les 10 minutes.

Les couleurs correspondent à l'âge approximatif des détections :

- **rouge** : moins de 3 heures ;
- **orange** : entre 3 et 12 heures ;
- **jaune** : entre 12 et 24 heures ;
- **bleu** : entre 24 et 72 heures.

## Utilisation la plus simple

### 1. Ouvrir l'application

Ouvrez le fichier `index.html` dans un navigateur récent, ou utilisez la version GitHub Pages lorsque celle-ci est activée.

### 2. Regarder la carte

Dans de nombreux cas, l'application essaie d'abord d'utiliser les flux publics NASA FIRMS Europe sans demander de clé.

Vous pouvez :

- déplacer la carte avec le doigt ou la souris ;
- utiliser `+` et `−` pour zoomer ;
- utiliser le bouton `⌂` pour revenir sur Bordeaux ;
- appuyer sur `↻` pour actualiser les données ;
- choisir le rayon et la période dans **Fenêtre d'observation**.

### 3. Ajouter une clé NASA FIRMS si nécessaire

Si les données ne se chargent pas, ou si vous souhaitez utiliser directement l'API officielle NASA FIRMS :

1. Rendez-vous sur la page officielle :
   **https://firms.modaps.eosdis.nasa.gov/api/map_key/**
2. Entrez votre adresse e-mail.
3. Consultez votre boîte mail.
4. Copiez la clé reçue, appelée `MAP_KEY`.
5. Dans l'application, ouvrez **Sources et fonctionnement**.
6. Collez la clé dans le champ **Clé NASA FIRMS facultative**.
7. Appuyez sur **Utiliser cette clé**.

La clé est conservée uniquement dans la session du navigateur. Elle n'est ni publiée dans le dépôt, ni envoyée à un autre service que la NASA.

> [!CAUTION]
> Ne publiez jamais votre clé personnelle directement dans le code source, dans une capture d'écran, dans un commit GitHub ou dans un message public.

## Comprendre ce qui est affiché

### Un point coloré

Un point correspond à une anomalie thermique détectée par un satellite NASA, notamment VIIRS ou MODIS.

Cela ne signifie pas automatiquement qu'un incendie de forêt est confirmé à cet endroit.

### Une zone colorée en pointillés

La zone relie des détections proches observées pendant une même période. Elle aide à visualiser une tendance possible dans le temps.

Cette zone est une **estimation visuelle produite par l'application**. Ce n'est pas le périmètre officiel du feu et ce n'est pas une prévision de propagation.

### « Aucune détection »

Cela peut signifier :

- qu'aucune anomalie thermique n'a été détectée dans la zone choisie ;
- que le satellite n'est pas encore repassé ;
- que des nuages ou de la fumée ont limité l'observation ;
- que les données ne sont pas encore disponibles ;
- que le service NASA est temporairement inaccessible.

L'absence de point sur la carte ne garantit donc pas l'absence de danger.

## Conseils pour les familles et les personnes peu à l'aise avec l'informatique

- Gardez le rayon à **100 km** pour commencer.
- Gardez l'historique à **72 heures** afin de voir l'évolution récente.
- Regardez d'abord les points rouges et orange.
- Vérifiez l'heure de la dernière détection en haut de l'écran.
- Appuyez sur **Cadrer les feux** pour recentrer automatiquement la carte.
- En cas de doute, fiez-vous toujours aux consignes des autorités locales, des pompiers, de la préfecture et des services de secours.

## Installer l'application sur son téléphone

Aucune installation technique n'est nécessaire.

### Depuis GitHub Pages

1. Ouvrez l'adresse de l'application dans Chrome, Safari ou Firefox.
2. Sur Android : menu du navigateur → **Ajouter à l'écran d'accueil**.
3. Sur iPhone : bouton **Partager** → **Sur l'écran d'accueil**.

L'application apparaîtra alors comme un raccourci sur le téléphone.

## Utilisation hors GitHub

Le projet tient dans un seul fichier HTML.

Vous pouvez :

1. télécharger `index.html` ;
2. le copier sur une clé USB ;
3. l'envoyer à un proche ;
4. l'héberger sur n'importe quel serveur statique.

Une connexion Internet reste nécessaire pour charger la carte et les données satellites.

## Activer GitHub Pages pour ce dépôt

Dans GitHub :

1. ouvrez **Settings** ;
2. allez dans **Pages** ;
3. dans **Build and deployment**, choisissez **Deploy from a branch** ;
4. sélectionnez la branche `main` ;
5. sélectionnez le dossier `/ (root)` ;
6. cliquez sur **Save**.

Après quelques minutes, l'application sera accessible à une adresse proche de :

`https://elgrandexu.github.io/EGX_Incendies/`

## Sources

- NASA FIRMS — Fire Information for Resource Management System
- Satellites et instruments : VIIRS S-NPP, VIIRS NOAA-20, VIIRS NOAA-21 et MODIS
- Fond de carte : OpenStreetMap

## Limites et responsabilité

Cette application est un outil citoyen de visualisation et de compréhension. Elle ne remplace pas :

- les alertes officielles ;
- les cartes des autorités ;
- les consignes d'évacuation ;
- les informations des pompiers ;
- les appels aux services d'urgence.

Les données peuvent être retardées, incomplètes ou mal interprétées. N'utilisez jamais cette carte seule pour décider d'une évacuation, d'un déplacement ou d'un retour dans une zone touchée.

## Vie privée

- aucune création de compte ;
- aucun suivi publicitaire ;
- aucune géolocalisation demandée ;
- aucune clé NASA incluse dans le dépôt ;
- la clé saisie reste dans la session locale du navigateur.

## Licence

Projet distribué sous licence MIT. Consultez le fichier `LICENSE`.
