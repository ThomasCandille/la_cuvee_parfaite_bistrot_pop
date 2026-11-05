/* La Cuvée Parfaite — jeu front-end. Les clés Azure ne transitent jamais vers ce script. */
(() => {
  'use strict';

  const GOAL = 5;
  const DATA = window.CUVEE_DATA;
  const SEEDS = DATA.samples;
  const GROUPS = [
    {
      label: 'Structure & acidité', description: 'Ce qui façonne le caractère du vin.', icon: '◈', className: '',
      features: [
        ['fixed acidity', 'Acidité fixe', 'g/L', 4.6, 15.9, 0.1, 'Acides non volatils : la structure de base.'],
        ['volatile acidity', 'Acidité volatile', 'g/L', 0.12, 1.58, 0.01, 'Une acidité excessive peut nuire à l’équilibre.'],
        ['citric acid', 'Acide citrique', 'g/L', 0, 1, 0.01, 'Contribue à la sensation de fraîcheur.'],
        ['pH', 'Potentiel hydrogène (pH)', '', 2.74, 4.01, 0.01, 'Plus le pH est bas, plus le vin est acide.']
      ]
    },
    {
      label: 'Corps & équilibre', description: 'La texture et la composition de la cuvée.', icon: '◉', className: 'green',
      features: [
        ['residual sugar', 'Sucre résiduel', 'g/L', 0.9, 15.5, 0.1, 'Sucres restant après la fermentation.'],
        ['density', 'Densité', 'g/cm³', 0.99007, 1.00369, 0.00001, 'Mesure physique liée à la composition du vin.'],
        ['alcohol', 'Alcool', '% vol.', 8.4, 14.9, 0.1, 'Teneur en alcool du vin rouge.'],
        ['sulphates', 'Sulfates', 'g/L', 0.33, 2, 0.01, 'Composés liés à la stabilité du vin.']
      ]
    },
    {
      label: 'Stabilité & conservation', description: 'Les mesures qui aident à préserver le vin.', icon: '✦', className: 'gold',
      features: [
        ['chlorides', 'Chlorures', 'g/L', 0.012, 0.611, 0.001, 'Teneur en sels chlorures.'],
        ['free sulfur dioxide', 'SO₂ libre', 'mg/L', 1, 72, 1, 'Soufre libre disponible pour la protection.'],
        ['total sulfur dioxide', 'SO₂ total', 'mg/L', 6, 289, 1, 'Ensemble du dioxyde de soufre présent.']
      ]
    }
  ];
  const FEATURES = GROUPS.flatMap(g => g.features);
  const $ = id => document.getElementById(id);
  const el = {
    features: $('feature-groups'), modeBadge: $('mode-badge'), modeLabel: $('mode-label'),
    modeNote: $('demo-note'), modeNoteText: $('demo-note-text'),
    draft: $('draft-status'), prediction: $('predict-button'), predictionLabel: $('predict-button-label'),
    value: $('probability-value'), probLabel: $('probability-label'), wine: $('glass-wine'),
    verdict: $('verdict-block'), verdictSymbol: $('verdict-symbol'), verdictTitle: $('verdict-title'), verdictText: $('verdict-text'),
    progress: $('progress-circles'), progressLabel: $('progress-label'),
    attempts: $('stat-attempts'), streak: $('stat-streak'), best: $('stat-best'),
    history: $('history-items'), historyCount: $('history-count'), toast: $('toast')
  };
  const storageKey = 'cuvee-parfaite-record-v1';
  let best = 0;
  try { best = Math.max(0, Number(localStorage.getItem(storageKey)) || 0); } catch (_) { /* Navigation privée */ }
  const state = {
    mode: 'demo', values: { ...SEEDS[1] }, attempts: 0, streak: 0, best,
    history: [], lastFingerprint: null, lastResult: null, activeRecipe: 0, busy: false
  };
  let toastTimer = null;

  function decimals(step) {
    const part = String(step).split('.')[1];
    return part ? part.length : 0;
  }
  function fmt(value, step) { return Number(value).toFixed(decimals(step)); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function percent(value, min, max) { return 100 * (value - min) / (max - min); }
  function fingerprint() { return JSON.stringify(FEATURES.map(([key]) => state.values[key])); }

  function renderFeatures() {
    el.features.innerHTML = GROUPS.map(group => `
      <section class="feature-group" aria-label="${group.label}">
        <div class="feature-heading">
          <div class="feature-title-group"><span class="group-icon ${group.className}" aria-hidden="true">${group.icon}</span><div><h3>${group.label}</h3><p>${group.description}</p></div></div>
          <span class="group-count">${group.features.length} paramètres</span>
        </div>
        <div class="parameters-grid">${group.features.map(([key, title, unit, min, max, step, description]) => {
          const i = FEATURES.findIndex(feature => feature[0] === key);
          return `<div class="parameter" data-feature="${i}">
            <div class="parameter-header">
              <div><label for="range-${i}" class="parameter-name">${title}</label><span class="parameter-code">${key}</span></div>
              <div class="parameter-entry"><input aria-label="Valeur : ${title}" type="number" id="number-${i}" min="${min}" max="${max}" step="${step}" value="${fmt(state.values[key], step)}" inputmode="decimal"><span class="parameter-unit">${unit}</span></div>
            </div>
            <input id="range-${i}" class="parameter-range" aria-label="Ajuster ${title}" type="range" min="${min}" max="${max}" step="${step}" value="${state.values[key]}">
            <div class="parameter-bottom"><span>${fmt(min, step)}</span><span>${fmt(max, step)}</span></div>
            <div class="parameter-description">${description}</div>
          </div>`;
        }).join('')}</div>
      </section>`).join('');

    FEATURES.forEach(([key, , , min, max, step], i) => {
      const range = $(`range-${i}`);
      const number = $(`number-${i}`);
      const apply = raw => {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return;
        const rounded = Number(clamp(parsed, min, max).toFixed(decimals(step)));
        state.values[key] = rounded;
        range.value = String(rounded);
        number.value = fmt(rounded, step);
        updateFill(range, rounded, min, max);
        markChanged();
      };
      range.addEventListener('input', () => apply(range.value));
      number.addEventListener('change', () => apply(number.value));
      number.addEventListener('blur', () => { number.value = fmt(state.values[key], step); });
      updateFill(range, state.values[key], min, max);
    });
  }
  function updateFill(range, value, min, max) { range.style.setProperty('--fill', `${percent(value, min, max)}%`); }

  function setProfile(profile, recipeIndex = -1) {
    for (const [key, , , min, max, step] of FEATURES) {
      const n = Number(profile[key]);
      state.values[key] = Number(clamp(n, min, max).toFixed(decimals(step)));
    }
    FEATURES.forEach(([key, , , min, max, step], i) => {
      $(`range-${i}`).value = String(state.values[key]);
      $(`number-${i}`).value = fmt(state.values[key], step);
      updateFill($(`range-${i}`), state.values[key], min, max);
    });
    markChanged();
    state.activeRecipe = recipeIndex;
    syncRecipes();
  }

  function syncRecipes() {
    document.querySelectorAll('.recipe-button').forEach(button => {
      const isSelected = Number(button.dataset.recipe) === state.activeRecipe;
      button.classList.toggle('active', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });
  }

  function markChanged() {
    state.activeRecipe = -1;
    syncRecipes();
    el.draft.textContent = state.lastFingerprint === null ? 'Prête à déguster' : 'Recette à tester';
    el.draft.classList.toggle('changed', state.lastFingerprint !== null);
    if (state.lastResult) {
      state.lastResult = null;
      renderVerdict(null);
    }
  }

  function showToast(message, timeout = 3200) {
    el.toast.textContent = message;
    el.toast.classList.add('active');
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('active'), timeout);
  }

  function renderMode() {
    const live = state.mode === 'azure';
    el.modeBadge.classList.toggle('live', live);
    el.modeBadge.classList.toggle('demo', !live);
    el.modeLabel.textContent = live ? 'Azure ML connecté' : 'Mode découverte';
    el.modeNote.classList.toggle('live-note', live);
    el.modeNoteText.textContent = live
      ? 'Mode connecté : chaque dégustation interroge réellement ton endpoint Azure ML via le serveur sécurisé.'
      : 'Mode démonstration : un modèle local distinct simule les dégustations. Ajoute ta clé Azure au serveur pour utiliser ton vrai endpoint.';
  }

  async function detectMode() {
    if (location.protocol === 'file:') { renderMode(); return; }
    try {
      const response = await fetch('/api/status', { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error('Statut indisponible');
      const data = await response.json();
      state.mode = data.mode === 'azure' ? 'azure' : 'demo';
    } catch (_) { state.mode = 'demo'; }
    renderMode();
  }

  function demoPredict(values) {
    // Pipeline local pédagogique : StandardScaler + LogisticRegression, entraîné séparément sur le CSV fourni.
    // L'endpoint Azure peut renvoyer d'autres résultats : ce mode est toujours signalé comme distinct.
    const { keys, means, scales, coefs, intercept } = DATA.model;
    let z = intercept;
    keys.forEach((key, i) => { z += ((values[key] - means[i]) / scales[i]) * coefs[i]; });
    const probability = 1 / (1 + Math.exp(-z));
    return { prediction: probability >= 0.5 ? 1 : 0, probability, mode: 'demo' };
  }

  async function azurePredict(values) {
    const response = await fetch('/api/predict', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [values] }),
      signal: AbortSignal.timeout(35000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.erreur) throw new Error(body.erreur || `Azure a répondu HTTP ${response.status}.`);
    if (![0, 1].includes(Number(body.prediction))) throw new Error('Le modèle ne renvoie pas une classe binaire valide.');
    return { prediction: Number(body.prediction), probability: typeof body.probability === 'number' ? body.probability : null, mode: 'azure' };
  }

  async function predict() {
    if (state.busy) return;
    const submitted = fingerprint();
    if (state.lastFingerprint === submitted) {
      showToast('Modifie au moins un paramètre pour présenter une nouvelle cuvée.');
      return;
    }
    state.busy = true;
    el.prediction.disabled = true;
    el.prediction.classList.add('loading');
    el.predictionLabel.textContent = 'Dégustation en cours…';
    try {
      const values = { ...state.values };
      const result = state.mode === 'azure'
        ? await azurePredict(values)
        : await new Promise(resolve => setTimeout(() => resolve(demoPredict(values)), 530));
      if (!Number.isFinite(result.probability)) result.probability = null;
      const previousStreak = state.streak;
      state.attempts += 1;
      state.streak = result.prediction === 1 ? state.streak + 1 : 0;
      state.best = Math.max(state.best, state.streak);
      try { localStorage.setItem(storageKey, String(state.best)); } catch (_) { /* Pas de stockage : ce n'est pas bloquant. */ }
      state.lastFingerprint = submitted;
      state.lastResult = result;
      state.history.unshift({ index: state.attempts, ...result });
      if (state.history.length > 5) state.history.pop();
      renderStats();
      renderVerdict(result);
      el.draft.textContent = 'Dégustation terminée';
      el.draft.classList.remove('changed');
      if (state.streak >= GOAL && previousStreak < GOAL) {
        $('result-visual').classList.add('win-flash');
        setTimeout(() => $('result-visual').classList.remove('win-flash'), 2300);
        showToast('🏆 Grand cru légendaire ! 5 bonnes cuvées consécutives : défi réussi !', 6800);
      } else if (result.prediction === 1) {
        showToast(state.streak === 1 ? 'Premier grand cru ! Il en reste quatre.' : `Bravo ! ${state.streak} bons vins d’affilée.`);
      } else {
        showToast('Cuvée non validée : la série repart à zéro. Tu peux faire mieux !');
      }
    } catch (error) {
      showToast(error.message || 'La dégustation n’a pas abouti.', 6800);
      el.verdict.classList.remove('good', 'bad');
      el.verdictTitle.textContent = 'Impossible de contacter le modèle';
      el.verdictText.textContent = error.message || 'Vérifie le serveur et le déploiement Azure.';
      el.verdictSymbol.textContent = '!';
    } finally {
      state.busy = false;
      el.prediction.disabled = false;
      el.prediction.classList.remove('loading');
      el.predictionLabel.textContent = "Faire déguster à l'IA";
    }
  }

  function renderStats() {
    el.attempts.textContent = state.attempts;
    el.streak.textContent = state.streak;
    el.best.textContent = state.best;
    el.progressLabel.textContent = `${Math.min(state.streak, GOAL)} / ${GOAL}`;
    el.progress.innerHTML = Array.from({ length: GOAL }, (_, i) => {
      const complete = i < state.streak;
      const next = i === state.streak && state.streak < GOAL;
      return `<div class="progress-step ${complete ? 'done' : ''} ${next ? 'next' : ''}" aria-label="Cuvée ${i + 1} ${complete ? 'validée' : 'à réaliser'}">${complete ? '✓' : i + 1}</div>`;
    }).join('');
    el.historyCount.textContent = `${state.attempts} vin${state.attempts > 1 ? 's' : ''}`;
    if (state.history.length === 0) {
      el.history.innerHTML = '<p class="empty-history">Les premières notes de dégustation apparaîtront ici.</p>';
    } else {
      el.history.innerHTML = state.history.map(item => `
        <div class="history-item ${item.prediction === 1 ? 'good' : 'bad'}">
          <span class="history-icon">${item.prediction === 1 ? '✓' : '×'}</span>
          <span class="wine-name">Cuvée n°${item.index} · ${item.prediction === 1 ? 'Grand cru' : 'À retravailler'}</span>
          <span class="wine-percent">${item.probability === null ? '—' : `${Math.round(item.probability * 100)} %`}</span>
        </div>`).join('');
    }
  }

  function renderVerdict(result) {
    el.verdict.classList.remove('good', 'bad');
    if (!result) {
      el.value.textContent = '—';
      el.probLabel.textContent = 'En attente';
      el.wine.setAttribute('y', '90');
      el.wine.setAttribute('height', '40');
      el.verdictSymbol.textContent = '✧';
      el.verdictTitle.textContent = 'Le jury attend ta cuvée';
      el.verdictText.textContent = state.lastFingerprint === null
        ? 'Ajuste les paramètres, puis lance ta première dégustation.'
        : 'Recette modifiée. Lance une nouvelle dégustation pour obtenir un verdict.';
      return;
    }
    const good = result.prediction === 1;
    const probability = result.probability;
    el.verdict.classList.add(good ? 'good' : 'bad');
    el.verdictSymbol.textContent = good ? '✓' : '×';
    el.verdictTitle.textContent = good
      ? (state.streak >= GOAL ? 'Défi remporté : maître de chai !' : 'Grand cru validé !')
      : 'Cette cuvée ne passe pas le jury';
    el.verdictText.textContent = good
      ? `${state.streak} réussite${state.streak > 1 ? 's' : ''} consécutive${state.streak > 1 ? 's' : ''}. Modifie ta recette pour en créer une autre.`
      : 'Le modèle prédit une qualité inférieure à 7/10. La série retombe à zéro.';
    el.value.textContent = probability === null ? '—' : `${Math.round(probability * 100)}%`;
    el.probLabel.textContent = probability === null ? 'Probabilité indisponible' : 'Probabilité de bon vin';
    if (probability !== null) {
      const height = Math.round(5 + probability * 92);
      const y = 119 - height;
      el.wine.setAttribute('y', String(y));
      el.wine.setAttribute('height', String(height));
    }
  }

  function resetChallenge() {
    state.attempts = 0;
    state.streak = 0;
    state.history = [];
    state.lastResult = null;
    state.lastFingerprint = null;
    renderStats();
    renderVerdict(null);
    el.draft.textContent = 'Prête à déguster';
    el.draft.classList.remove('changed');
    showToast('Nouveau défi lancé. Ton meilleur record est conservé !');
  }

  function wireEvents() {
    $('predict-button').addEventListener('click', predict);
    $('reset-button').addEventListener('click', resetChallenge);
    $('randomize-button').addEventListener('click', () => {
      const current = fingerprint();
      const candidates = SEEDS.filter(profile => JSON.stringify(FEATURES.map(([key]) => profile[key])) !== current);
      const chosen = candidates[Math.floor(Math.random() * candidates.length)] || SEEDS[0];
      setProfile(chosen);
      showToast('Nouvelle cuvée chargée à partir d’une observation réelle.');
    });
    document.querySelectorAll('.recipe-button').forEach(button => {
      button.addEventListener('click', () => {
        const i = Number(button.dataset.recipe);
        const indexes = [1, 2, 0];
        setProfile(SEEDS[indexes[i]], i);
      });
    });
    const dialog = $('rules-dialog');
    $('rules-button').addEventListener('click', () => dialog.showModal());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  }

  renderFeatures();
  syncRecipes();
  renderStats();
  renderVerdict(null);
  wireEvents();
  detectMode();
})();
