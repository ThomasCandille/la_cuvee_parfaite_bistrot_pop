# La Cuvée Parfaite — Bistrot Pop

Mini-jeu pédagogique autour d'un classifieur Azure Machine Learning de qualité de vin rouge.

## Identité visuelle retenue

**Bistrot Pop** : Montserrat (servie via Google Fonts, avec polices locales de secours), jaune solaire `#ffd66a`, rouge tomate `#df4837`, encre `#1f2428`, fond ivoire `#fff9e9`. Aplats, bordures de 2 px et ombres franches. Le site est responsive.

Un seul CSS à modifier : `public/styles.css`. Les variables de palette du thème se trouvent vers la fin, sous « BISTROT POP FINAL ART DIRECTION ».

## Jouer sans Azure

Ouvrir le fichier `la_cuvee_parfaite_bistrot_pop_demo.html` fourni avec l'archive. Le jeu fonctionne directement en **mode découverte**, hors ligne (la police peut utiliser une police de secours), avec un modèle logistique local distinct du modèle Azure. **Une prédiction en mode découverte n'est pas une prédiction Azure.**

## Utiliser le vrai endpoint Azure ML

- Installer **Node.js 18+**.
- Copier `.env.example` en `.env` à la racine du projet.
- Compléter `AZUREML_API_KEY` avec la clé d'accès de l'endpoint, et conserver `DEMO_MODE=false`.
- Démarrer `npm start` dans le dossier du projet (aucune dépendance npm).
- Ouvrir `http://127.0.0.1:3000`.

L'endpoint préconfiguré est :
`https://wine-thomas-11050920.italynorth.inference.ml.azure.com/score`

Le navigateur n'a jamais accès à la clé : le serveur Node relaie les requêtes vers Azure ML.

## Fonctionnement

- 11 variables physico-chimiques ajustables (aucune colonne `quality`, `bon_vin` ou `Unnamed: 0` dans la requête).
- 3 recettes initiales et une sélection surprise de vins réels du dataset.
- 5 prédictions positives consécutives pour gagner ; une négative remet la série à zéro.
- Historique des dégustations et record local, conservé par le navigateur.
- `bon_vin=1` signifie « qualité d'origine ≥ 7/10 » ; le pourcentage est une probabilité estimée, **pas** une note sur 100.

## Contrat Azure

Requête envoyée par le proxy : `{"data":[{"fixed acidity":7.4, ... les 10 autres variables ...}]}`.

La réponse du `score.py` doit contenir `predictions` et idéalement `probabilites_bon_vin`. L'ancien nom `probabilites_defaut` est aussi compris.

Si Azure réclame encore `Unnamed: 0`, il faut réentraîner puis redéployer le modèle corrigé : ne pas ajouter cette colonne à l'interface.

## Sécurité

- Ne jamais publier `.env`, ni placer la clé dans `public/`.
- Un hébergement public exige des mesures supplémentaires (authentification, quotas, protection contre l'abus et coûts Azure).
- Le serveur inclut une limitation rudimentaire de 45 requêtes/minute par IP : elle ne remplace pas la sécurité de production.
