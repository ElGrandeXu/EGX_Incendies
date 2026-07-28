# EGX Incendies

EGX Incendies est une carte citoyenne gratuite et open source pour suivre les incendies en quasi temps réel grâce aux détections thermiques par satellite de NASA FIRMS. Elle aide à visualiser les feux de forêt potentiels en France et en Europe autour de la ville de votre choix, avec leur distance, leur ancienneté et les foyers probables.

La carte présente aussi le vent, la direction possible des fumées et une estimation de la qualité de l’air. Elle complète l’information disponible, mais ne constitue pas une alerte incendie officielle en France ou en Europe et ne remplace jamais les autorités ou les services de secours.

> [!NOTE]
> La V2 est publiée avec trois évolutions : qualité de l’air estimée, champs MAP_KEY sans comportement de mot de passe et état explicite lorsqu’aucune détection n’est reçue.

## [Ouvrir EGX Incendies →](https://elgrandexu.github.io/EGX_Incendies/)

## Utiliser l’application en quelques minutes

1. Ouvrez [EGX Incendies](https://elgrandexu.github.io/EGX_Incendies/). Le guide de bienvenue apparaît automatiquement si aucune clé n’est enregistrée.
2. Touchez **Obtenir ma clé gratuite**. Sur la page officielle NASA FIRMS, cliquez sur **Get MAP_KEY**, saisissez votre adresse e-mail, puis récupérez la clé reçue par e-mail.
3. Revenez dans l’onglet EGX Incendies, collez la clé dans le guide, puis touchez **Enregistrer et ouvrir la carte**. L’application vérifie la clé avant de la conserver.
4. Dans **Configuration**, saisissez votre ville sous **Zone cible**, touchez **Rechercher**, choisissez le bon résultat, puis touchez **Utiliser cette ville**.
5. Si besoin, choisissez le **Rayon de détection**, l’**Historique des données** — 24, 48 ou 72 heures — et le mode d’affichage. Chaque changement est appliqué directement.

Le guide peut être fermé avec **Plus tard** ou la touche **Échap**. Il revient au prochain chargement ou lors d’une actualisation manuelle tant qu’aucune clé n’est enregistrée.

La clé reste dans le navigateur de cet appareil. Elle est envoyée directement à NASA FIRMS et jamais à un serveur EGX.

**Raccourci mobile :** sur iPhone ou iPad, ouvrez le site dans Safari, puis touchez **Partager** → **Sur l’écran d’accueil**. Sur Android, ouvrez-le dans Chrome, puis choisissez **Ajouter à l’écran d’accueil** dans le menu. Une connexion à Internet reste nécessaire.

> [!IMPORTANT]
> En cas de danger immédiat, appelez le **112** ou le **18**. Suivez toujours les consignes des autorités et des services de secours.

## Ce que l’application affiche

- les détections thermiques fournies par NASA FIRMS ;
- les détections proches regroupées en foyers probables ;
- la distance et l’ancienneté de la détection la plus proche ;
- le vent actuel ;
- la qualité de l’air estimée selon l’indice européen EAQI, sa catégorie et le ou les polluants déterminants ;
- un niveau de risque pédagogique lié aux fumées ;
- les directions possibles des fumées, représentées par des flèches sur la carte ;
- le détail de chaque foyer probable ;
- les localités potentiellement situées dans l’axe estimé, uniquement dans le détail ;
- un thème clair et un thème sombre.

Les informations évoluent avec les données reçues. Quand l’application reste ouverte, elle les actualise toutes les 10 minutes.

Une réponse valide sans détection est affichée comme un état normal : **Aucune** détection la plus proche et **Aucun signal** pour le risque fumée. Cela signifie seulement qu’aucune détection thermique récente n’est disponible dans la zone et la période choisies ; cela ne garantit pas l’absence d’incendie ou de fumée.

## Repères dans l’application

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/mobile-map.png" alt="Vue Carte mobile avec les détections, la distance, le vent et le risque lié aux fumées">
      <br><sub><strong>Carte.</strong> Les indicateurs essentiels restent visibles sous la carte.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/mobile-configuration.png" alt="Onglet Configuration avec la recherche de ville, le rayon et la période observée">
      <br><sub><strong>Configuration.</strong> Choisissez la ville, le rayon et la période observée.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/mobile-nasa-key.png" alt="Champ vide Clé NASA FIRMS avec les boutons Enregistrer et Effacer">
      <br><sub><strong>Clé NASA FIRMS.</strong> Collez la clé dans ce champ, puis touchez Enregistrer.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/mobile-info-dark-mode.png" alt="Onglet Info en thème sombre avec le bouton de changement de thème">
      <br><sub><strong>Info.</strong> Le bouton en forme de soleil ou de lune change le thème.</sub>
    </td>
  </tr>
</table>

Les captures montrent la version mobile actuelle. La clé NASA n’apparaît dans aucune image.

## Utiliser les trois onglets

### Carte

- Consultez les détections et les foyers probables.
- Lisez la distance la plus proche, le vent et le risque lié aux fumées.
- Suivez les corridors neutres et les flèches pour lire la direction potentielle des fumées, sans échéance temporelle précise.
- Utilisez la case **Fumées** sur la carte pour les afficher ou les masquer instantanément.
- Touchez un foyer, son corridor ou une flèche pour ouvrir ses détails.
- Dans le détail, consultez la tendance des vents et les localités potentiellement dans l’axe.
- Touchez **Foyers probables** pour consulter la liste.

### Configuration

- Recherchez une ville et choisissez le bon résultat.
- Modifiez le rayon de détection.
- Choisissez une période de 24, 48 ou 72 heures.
- Affichez les points, la tendance visuelle, ou les deux.
- Enregistrez ou remplacez votre clé NASA FIRMS.

Les zones colorées montrent une tendance visuelle. Elles ne représentent pas un périmètre officiel d’incendie.

### Info

- Consultez la légende et les sources.
- Retrouvez les informations de sécurité.
- Dans le bloc **À propos**, touchez le bouton en forme de lune ou de soleil pour passer du thème clair au thème sombre.

Sur ordinateur, les mêmes contenus restent accessibles dans le panneau placé à droite de la carte.

## Données et confidentialité

- **NASA FIRMS** fournit les détections thermiques.
- **Open-Meteo** fournit les informations sur le vent et distribue l’estimation de qualité de l’air.
- **CAMS** — Copernicus Atmosphere Monitoring Service — fournit les données atmosphériques modélisées utilisées par Open‑Meteo.
- **OpenStreetMap** fournit la carte et les noms des localités, via Overpass.
- **Nominatim**, un service d’OpenStreetMap, recherche les villes.

EGX Incendies ne demande aucun compte. EGX n’ajoute aucun outil de suivi publicitaire ou de mesure d’audience. Aucun renseignement personnel n’est envoyé à un serveur EGX.

La clé NASA, la ville et les préférences restent dans le navigateur de l’appareil. Si vous effacez les données du site dans le navigateur, ces réglages peuvent aussi être supprimés.

## Ce que l’application ne peut pas garantir

- Une détection thermique n’est pas toujours un incendie. Elle peut venir d’un brûlage, d’un site industriel ou d’une autre source de chaleur.
- Les satellites ne survolent pas une zone en continu.
- Les nuages, la fumée ou un retard de transmission peuvent masquer ou retarder certaines détections.
- Les foyers probables sont des regroupements automatiques. Ils ne confirment pas un incendie distinct.
- Les trajectoires de fumées sont des estimations pédagogiques fondées sur les vents prévus à 10 m. Elles ne constituent pas un modèle de dispersion, une mesure de fumée ou une prévision des flammes.
- Une localité affichée est seulement située dans l’axe géométrique estimé. Elle ne définit ni une zone de danger ni une consigne d’évacuation.
- La qualité de l’air est une estimation modélisée CAMS via Open‑Meteo, pas une mesure officielle prise sur place. Sa résolution est d’environ **11 km en Europe** et **45 km pour le modèle mondial**.
- Une mauvaise qualité de l’air ne prouve pas qu’un incendie proche en est la cause.
- L’absence de détection ne signifie pas l’absence de danger.
- L’application ne remplace ni les autorités, ni les alertes officielles, ni les services d’urgence.

## En cas d’urgence

En cas de danger immédiat :

- appelez le **112** ;
- ou appelez le **18**.

Éloignez-vous du danger si les autorités vous le demandent. Suivez les consignes officielles locales.

## Informations techniques

Le projet utilise trois fichiers à la racine du dépôt :

- `index.html` contient la structure de l’application ;
- `style.css` contient la présentation responsive et les thèmes ;
- `app.js` charge les données et gère les interactions.

Les ressources statiques sont regroupées sous `assets/` :

- `assets/manifest.webmanifest` décrit le raccourci navigateur ;
- `assets/icons/` contient le master SVG et les déclinaisons mobiles.

L’application fonctionne sans serveur EGX et sans étape de compilation. GitHub Pages publie le site. Elle interroge NASA FIRMS, Open‑Meteo Forecast, Open‑Meteo Air Quality, OpenStreetMap, Overpass et Nominatim.

Pour l’ouvrir en local, servez la racine du dépôt avec un serveur HTTP. Par exemple, lancez `python -m http.server 8000`, puis ouvrez `http://localhost:8000/`.

Le banc navigateur contrôlé est conservé dans `validation/mission2-browser.cjs`. Il nécessite Node.js 22 ou plus récent et Chrome ou Chromium. Lancez :

```sh
node validation/mission2-browser.cjs
```

Le navigateur est détecté dans les emplacements courants. Sinon, définissez la variable `CHROME_PATH`. Le banc vérifie l’intégrité de Leaflet, simule les réponses réussies, partielles et échouées des API, puis teste les parcours sur mobile, tablette et ordinateur.

Le profil reproductible de l’actualisation utilise le même navigateur, sans dépendance supplémentaire :

```sh
node validation/refresh-performance.cjs
```

Le rapport actuel, les mesures avant/après, les limites et la procédure de rollback sont consignés dans [`docs/audit-2026-07-27.md`](docs/audit-2026-07-27.md).

## Licence

Le projet est distribué sous licence MIT. Consultez le fichier [`LICENSE`](LICENSE).
