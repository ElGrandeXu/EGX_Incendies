# EGX Incendies

EGX Incendies permet de consulter les détections thermiques repérées par satellite autour d’une ville. L’application ajoute les vents actuels et prévus ainsi qu’une trajectoire potentielle des fumées pour aider à comprendre la situation.

**[Ouvrir EGX Incendies](https://elgrandexu.github.io/EGX_Incendies/)**

> [!IMPORTANT]
> En cas de danger immédiat, appelez le **112** ou le **18**. Suivez toujours les consignes des autorités et des services de secours.

## Ce que l’application affiche

- les détections thermiques fournies par NASA FIRMS ;
- les détections proches regroupées en foyers probables ;
- la distance de la détection la plus proche ;
- le vent actuel ;
- un niveau de risque pédagogique lié aux fumées ;
- les trajectoires potentielles des fumées à `3 h`, `6 h` et `12 h` sur la carte ;
- le détail de chaque foyer probable ;
- les localités potentiellement situées dans l’axe estimé, uniquement dans le détail ;
- un thème clair et un thème sombre.

Les informations évoluent avec les données reçues. Quand l’application reste ouverte, elle les actualise toutes les 10 minutes.

## Première utilisation

Une **clé gratuite NASA FIRMS** est nécessaire. Il s’agit d’une clé d’accès aux données de détection de la NASA.

1. Ouvrez [EGX Incendies](https://elgrandexu.github.io/EGX_Incendies/).
2. Touchez l’onglet **Configuration**, en bas de l’écran.
3. Descendez jusqu’au bloc **Clé NASA FIRMS**.
4. Touchez le bouton avec un point d’interrogation.
5. Sur la [page officielle NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/map_key/), indiquez votre adresse e-mail pour demander une clé gratuite.
6. Ouvrez l’e-mail reçu, puis copiez la clé.
7. Revenez dans EGX Incendies.
8. Collez la clé dans le champ **Clé NASA FIRMS**, puis touchez **Enregistrer**.
9. Dans **Configuration**, recherchez votre ville. Sélectionnez le bon résultat, puis touchez **Utiliser cette ville**.
10. Revenez dans l’onglet **Carte**.

L’application peut revenir automatiquement à la carte après l’enregistrement de la clé. Dans ce cas, ouvrez de nouveau **Configuration** pour choisir votre ville.

La clé est gratuite. Elle reste enregistrée dans le navigateur de votre appareil, par exemple Safari, Chrome ou Edge. Elle sert uniquement à interroger NASA FIRMS et n’est pas envoyée à un serveur EGX. Si vous aviez déjà enregistré une clé, vous n’avez normalement rien à refaire.

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
- Suivez les corridors neutres, les repères `3 h`, `6 h`, `12 h` et les flèches pour lire la direction potentielle des fumées.
- Touchez un foyer, son corridor, une flèche ou un repère horaire pour ouvrir ses détails.
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

## Ajouter l’application à l’écran d’accueil

L’adresse publique reste la même. Les anciens raccourcis vers cette adresse continuent de fonctionner.

### Sur iPhone ou iPad

1. Ouvrez le site dans **Safari**.
2. Touchez **Partager**.
3. Choisissez **Sur l’écran d’accueil**.

### Sur Android

1. Ouvrez le site dans **Chrome**.
2. Ouvrez le menu du navigateur.
3. Choisissez **Ajouter à l’écran d’accueil** ou **Installer l’application**, selon le choix affiché.

Ce raccourci ouvre le site. Une connexion à Internet reste nécessaire pour charger la carte et les données récentes.

## Données et confidentialité

- **NASA FIRMS** fournit les détections thermiques.
- **Open-Meteo** fournit les informations sur le vent.
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
- L’application ne mesure pas la qualité de l’air.
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

L’application fonctionne sans serveur EGX et sans étape de compilation. GitHub Pages publie le site. Elle interroge NASA FIRMS, Open-Meteo, OpenStreetMap et Nominatim.

Pour l’ouvrir en local, servez la racine du dépôt avec un serveur HTTP. Par exemple, lancez `python -m http.server 8000`, puis ouvrez `http://localhost:8000/`.

Le banc navigateur contrôlé est conservé dans `validation/mission2-browser.cjs`. Il nécessite Node.js et Google Chrome sous Windows.

## Licence

Le projet est distribué sous licence MIT. Consultez le fichier [`LICENSE`](LICENSE).
