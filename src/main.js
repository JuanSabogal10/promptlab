const MODEL_OPTIONS = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', title: 'Llama 3.2 · 1B · recomendado · ~0.9 GB VRAM' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', title: 'Llama 3.2 · 3B · más capacidad · ~2.3 GB VRAM' },
];
const $ = (id) => document.getElementById(id);
const promptEl = $('prompt');
const builtin = [
  { name: 'Claridad', checked: true, weight: 1 },
  { name: 'Directividad', checked: true, weight: 1 },
  { name: 'Especificidad', checked: true, weight: 1 },
  { name: 'Consistencia', checked: true, weight: 1 },
  { name: 'Cumplimiento de la tarea', checked: true, weight: 1 },
];
let customWeightMap = new Map();
let count = 5;
let selected = 0;
let scenarios = [];
let running = false;
let rubricUsed = [];
let inferredTaskCriteria = [];
let engine;
let loadedModelId = '';
let toastTimer;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 5000);
}

function status(message) {
  $('status').textContent = message;
}

function customNames() {
  return [...new Set($('customCriteria').value.split('\n').map((name) => name.trim()).filter(Boolean))];
}

function boundedWeight(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function selectedRubric() {
  return [
    ...builtin.filter((criterion) => criterion.checked && criterion.weight > 0),
    ...customNames().map((name) => ({ name, weight: customWeightMap.get(name) ?? 1 })).filter((criterion) => criterion.weight > 0),
  ];
}

function renderRubric() {
  $('builtinCriteria').innerHTML = builtin.map((criterion, index) => `
    <div class="criterion-control">
      <input type="checkbox" data-built-check="${index}" ${criterion.checked ? 'checked' : ''}>
      <span>${criterion.name}</span>
      <input type="number" min="0" max="100" step="0.5" value="${criterion.weight}" aria-label="Peso de ${criterion.name}" data-built-weight="${index}">
    </div>`).join('');
  $('customWeights').innerHTML = customNames().map((name) => {
    if (!customWeightMap.has(name)) customWeightMap.set(name, 1);
    return `<div class="criterion-control"><span></span><span>${esc(name)}</span><input type="number" min="0" max="100" step="0.5" value="${customWeightMap.get(name)}" aria-label="Peso de ${esc(name)}" data-custom-weight="${esc(name)}"></div>`;
  }).join('');
  document.querySelectorAll('[data-built-check]').forEach((input) => {
    input.onchange = () => { builtin[Number(input.dataset.builtCheck)].checked = input.checked; };
  });
  document.querySelectorAll('[data-built-weight]').forEach((input) => {
    input.oninput = () => { builtin[Number(input.dataset.builtWeight)].weight = boundedWeight(input.value); };
  });
  document.querySelectorAll('[data-custom-weight]').forEach((input) => {
    input.oninput = () => customWeightMap.set(input.dataset.customWeight, boundedWeight(input.value));
  });
}

function render() {
  const overall = scenarios.length ? Math.round(scenarios.reduce((sum, item) => sum + item.score, 0) / scenarios.length) : 0;
  const empty = scenarios.length === 0;
  const rubric = rubricUsed;
  $('results').innerHTML = empty
    ? `<div class="empty-state"><div class="empty-icon">✳</div><strong>${running ? 'Evaluación en curso' : 'Elige un modelo local y ejecuta la evaluación'}</strong><br>${running ? 'Se generan escenarios, respuestas completas y calificaciones de forma secuencial.' : 'Cada escenario mostrará su entrada, respuesta íntegra, nota y evidencia.'}</div>`
    : `<div class="tabs"><div class="tab active">Resumen</div><div class="tab">Dataset <span style="margin-left:5px;color:#aaa">${scenarios.length}</span></div><div class="tab">Rúbrica</div></div>
      <div class="overview"><div class="score-card"><div><div class="score-label">Puntuación global</div><div class="score-num">${overall}<span>/100</span></div></div><div class="score-tag">${overall >= 85 ? 'Buen desempeño' : overall >= 65 ? 'En observación' : 'Necesita ajustes'}</div></div>
      <div class="breakdown">${rubric.map((criterion, index) => {
        const value = Math.round(scenarios.reduce((sum, item) => sum + item.criterionScores[index].score, 0) / scenarios.length * 20);
        return `<div class="barrow"><span class="barlabel">${esc(criterion.name)} · ${criterion.weight.toFixed(1)}%</span><span class="bar"><span class="fill" style="display:block;width:${value}%"></span></span><span class="barvalue">${value}</span></div>`;
      }).join('')}</div></div>
      <div class="summary"><strong>Modelo local.</strong> ${esc($('model').selectedOptions[0]?.textContent)}. La nota final de cada escenario es el promedio ponderado normalizado de la rúbrica. Pesos usados: ${rubric.map((criterion) => `${esc(criterion.name)} ${criterion.weight.toFixed(1)}%`).join(' · ')}.</div>
      <div class="criteria"><div class="criteria-head"><span class="criteria-title">Objetivos inferidos para esta tarea</span><span class="criteria-hint">GENERADOS POR EL MODELO</span></div><p>${esc(inferredTaskCriteria.join(' · '))}</p></div>
      <div class="scenario-head"><h2>Escenarios evaluados</h2><span class="scenario-count">${scenarios.length} CASOS · COMPLETOS</span></div>
      <div class="scenario-list">${scenarios.map((item, index) => `<article class="scenario ${index === selected ? 'selected' : ''}"><button class="scenario-button" data-select="${index}"><span class="scenario-index">${String(index + 1).padStart(2, '0')}</span><span class="scenario-name">${esc(item.name)}</span><span class="scenario-kind">${esc(item.kind || 'Escenario')}</span><span class="scenario-score ${item.score >= 85 ? 'good' : item.score >= 65 ? 'mid' : 'bad'}">${item.score}</span><span style="color:#aaa;font-size:12px">${index === selected ? '⌄' : '›'}</span></button>${index === selected ? `<div class="scenario-detail"><div class="case-prompt"><b>Entrada del escenario</b><br>${esc(item.input).split('\n').join('<br>')}<br><br><b>Qué debe lograr</b><br>${esc(item.requirements)}</div><div class="answer-box"><div class="answer-top"><span class="answer-label">Respuesta completa</span><span class="model-tag">${esc($('model').selectedOptions[0]?.textContent)}</span></div><div class="answer">${esc(item.output).split('\n').join('<br>')}</div></div><div class="eval-row"><div class="eval-score"><small>Nota ponderada</small><strong>${item.score}<span style="font-size:10px;color:#999"> /100</span></strong></div><div class="explain"><strong>Por qué obtuvo esta nota.</strong> ${esc(item.explanation)}<br><b>Criterios:</b> ${rubric.map((criterion, i) => `${esc(criterion.name)} ${item.criterionScores[i].score}/5 (${criterion.weight.toFixed(1)}%)`).join(' · ')}<br><b>Evidencia:</b> <span class="evidence">${item.evidence ? `“${esc(item.evidence)}”` : 'no evidence'}</span></div></div></div>` : ''}</article>`).join('')}</div>
      <div class="footer-note"><span>La nota se calcula con los criterios y pesos usados en esta ejecución.</span><span>WEBLLM · LOCAL</span></div>`;
  document.querySelectorAll('[data-select]').forEach((button) => {
    button.addEventListener('click', () => { selected = Number(button.dataset.select); render(); });
  });
}

function initializeModelPicker() {
  const picker = $('model');
  picker.innerHTML = MODEL_OPTIONS.map((model) => `<option value="${model.id}">${model.title}</option>`).join('');
  if (!MODEL_OPTIONS.length) {
    picker.innerHTML = '<option value="">No hay modelos compatibles</option>';
    $('loadModel').disabled = true;
    $('modelHint').textContent = 'No se encontraron modelos compatibles en WebLLM';
  }
}

function updateLoadProgress(report) {
  const progress = $('modelProgressBar');
  const text = $('modelProgressText');
  text.textContent = report?.text || 'Descargando y preparando el modelo local…';
  if (Number.isFinite(report?.progress)) {
    progress.max = 1;
    progress.value = Math.max(0, Math.min(1, report.progress));
  } else {
    progress.removeAttribute('value');
  }
}

async function loadSelectedModel() {
  const modelId = $('model').value;
  if (!modelId) throw new Error('Selecciona un modelo compatible.');
  if (!('gpu' in navigator)) throw new Error('Este navegador no ofrece WebGPU. Usa una versión reciente de Chrome, Edge u otro navegador compatible en un dispositivo con GPU admitida.');
  if (!await navigator.gpu.requestAdapter()) throw new Error('WebGPU está disponible en este navegador, pero no se encontró una GPU compatible o con memoria disponible.');
  if (loadedModelId === modelId && engine) return engine;
  const button = $('loadModel');
  const runWasDisabled = $('run').disabled;
  $('modelProgress').hidden = false;
  $('modelProgressBar').removeAttribute('value');
  $('modelProgressText').textContent = 'Comprobando WebGPU e iniciando el modelo…';
  button.disabled = true;
  $('run').disabled = true;
  status('Preparando modelo local');
  try {
    const { CreateMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    const modelRecords = MODEL_OPTIONS.map(({ id }) => prebuiltAppConfig.model_list.find((model) => model.model_id === id)).filter(Boolean);
    if (!modelRecords.some((model) => model.model_id === modelId)) {
      throw new Error('El modelo elegido no está disponible en la configuración precompilada de esta versión.');
    }
    if (engine) {
      await engine.unload();
      engine = undefined;
    }
    engine = await CreateMLCEngine(modelId, {
      appConfig: { model_list: modelRecords, cacheBackend: 'cache' },
      initProgressCallback: updateLoadProgress,
    }, { context_window_size: 4096 });
    loadedModelId = modelId;
    $('modelProgressText').textContent = 'Modelo listo. Los próximos usos pueden aprovechar la caché local.';
    status('Modelo listo en este navegador');
    $('modelHint').textContent = 'Modelo cargado · inferencia en este dispositivo';
    return engine;
  } catch (error) {
    engine = undefined;
    loadedModelId = '';
    const details = error?.message || String(error);
    $('modelProgressText').textContent = `No se pudo cargar el modelo: ${details}`;
    status('No se pudo cargar el modelo');
    throw new Error(`No se pudo iniciar WebGPU. Revisa la compatibilidad del navegador y la memoria disponible. ${details}`);
  } finally {
    button.disabled = false;
    $('run').disabled = runWasDisabled;
  }
}

async function completeJson(messages, schema, maxTokens = 1024) {
  const activeEngine = await loadSelectedModel();
  const result = await activeEngine.chat.completions.create({
    messages,
    temperature: 0.2,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    stream: false,
  });
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error('El modelo no devolvió contenido.');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`El modelo no devolvió JSON válido para el formato solicitado: ${schema}. Intenta de nuevo o usa el modelo de 3B.`);
  }
}

async function completeText(messages, maxTokens = 1200) {
  const activeEngine = await loadSelectedModel();
  const result = await activeEngine.chat.completions.create({
    messages,
    temperature: 0.2,
    max_tokens: maxTokens,
    stream: false,
  });
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('El modelo no devolvió contenido.');
  return content;
}

function setBusy(busy) {
  running = busy;
  $('run').disabled = busy;
  $('loadModel').disabled = busy;
  $('model').disabled = busy;
  $('minus').disabled = busy;
  $('plus').disabled = busy;
  document.querySelectorAll('.rubric-editor input, #customCriteria').forEach((element) => { element.disabled = busy; });
}

async function runEvaluation() {
  if (!promptEl.value.trim()) { promptEl.focus(); toast('Escribe un prompt para iniciar.'); return; }
  const chosen = selectedRubric();
  if (!chosen.length) { toast('Selecciona al menos un criterio con peso mayor que cero.'); return; }
  if (new Set(chosen.map((criterion) => criterion.name.toLocaleLowerCase())).size !== chosen.length) {
    toast('Cada criterio debe tener un nombre único; revisa los criterios propios.');
    return;
  }
  const totalWeight = chosen.reduce((sum, criterion) => sum + criterion.weight, 0);
  rubricUsed = chosen.map((criterion) => ({ ...criterion, weight: criterion.weight / totalWeight * 100 }));
  const criteriaPrompt = rubricUsed.map((criterion) => `- ${criterion.name} (peso normalizado ${criterion.weight.toFixed(1)}%; puntúa de 1 a 5)`).join('\n');
  const button = $('run');
  setBusy(true);
  scenarios = [];
  selected = 0;
  inferredTaskCriteria = [];
  render();
  try {
    status('Generando dataset');
    button.querySelector('span').textContent = 'Generando escenarios…';
    const dataset = await completeJson([
      { role: 'system', content: 'Eres un diseñador de evaluaciones de prompts. Responde solo como objeto JSON. Crea escenarios diversos y realistas para probar el objetivo del prompt; incluye caso típico, variación, datos faltantes o límite cuando tenga sentido. Las entradas deben ser mensajes de usuario utilizables directamente con el prompt original. Infiere requisitos concretos de la tarea. El objeto debe tener taskCriteria como lista de cadenas y scenarios como lista de objetos name, kind, input y requirements.' },
      { role: 'user', content: `PROMPT A EVALUAR:\n${promptEl.value}\n\nCrea exactamente ${count} escenarios. Devuelve el objeto JSON solicitado.` },
    ], 'dataset');
    if (!Array.isArray(dataset.scenarios) || dataset.scenarios.length !== count) {
      throw new Error(`El modelo generó ${dataset.scenarios?.length || 0} escenarios; se solicitaron ${count}. Vuelve a intentarlo.`);
    }
    inferredTaskCriteria = Array.isArray(dataset.taskCriteria) ? dataset.taskCriteria : [];
    for (let index = 0; index < dataset.scenarios.length; index += 1) {
      const scenario = dataset.scenarios[index];
      status(`Respondiendo escenario ${index + 1}/${count}`);
      button.querySelector('span').textContent = `Escenario ${index + 1}/${count}…`;
      const answer = await completeText([
        { role: 'system', content: promptEl.value },
        { role: 'user', content: scenario.input },
      ], 1200);
      status(`Evaluando escenario ${index + 1}/${count}`);
      button.querySelector('span').textContent = `Calificando ${index + 1}/${count}…`;
      const scored = await completeJson([
        { role: 'system', content: `Evalúa de forma estricta y justa, usando evidencia visible y requisitos. Devuelve un objeto JSON con criterionScores (lista de {name, score}), explanation (explicación breve) y evidence (fragmento breve, exacto, copiado de la respuesta; si no hay evidencia relevante, escribe exactamente "no evidence"). Incluye TODOS los criterios siguientes una sola vez, con su nombre exacto. No añadas criterios, no omitas criterios y no devuelvas nota global. Cada score debe ser entero de 1 a 5; 5 es excelente.\n${criteriaPrompt}` },
        { role: 'user', content: `PROMPT EVALUADO:\n${promptEl.value}\n\nREQUISITOS DEL ESCENARIO:\n${scenario.requirements}\n\nENTRADA:\n${scenario.input}\n\nRESPUESTA COMPLETA:\n${answer}` },
      ], 'evaluación', 900);
      const received = new Map((Array.isArray(scored.criterionScores) ? scored.criterionScores : [])
        .map((item) => [String(item.name || '').trim().toLocaleLowerCase(), item.score]));
      const missing = rubricUsed.filter((criterion) => !received.has(criterion.name.toLocaleLowerCase()));
      if (missing.length) throw new Error(`Faltan criterios seleccionados en el escenario ${index + 1}: ${missing.map((criterion) => criterion.name).join(', ')}. Prueba con el modelo de 3B.`);
      const invalid = rubricUsed.filter((criterion) => {
        const value = received.get(criterion.name.toLocaleLowerCase());
        return value === null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value));
      });
      if (invalid.length) throw new Error(`El modelo no devolvió una puntuación válida de 1 a 5 para: ${invalid.map((criterion) => criterion.name).join(', ')}.`);
      const criterionScores = rubricUsed.map((criterion) => ({
        name: criterion.name,
        score: Math.max(1, Math.min(5, Number(received.get(criterion.name.toLocaleLowerCase())))),
      }));
      const score = Math.round(criterionScores.reduce((sum, item, criterionIndex) => (
        sum + (item.score / 5 * 100) * rubricUsed[criterionIndex].weight
      ), 0) / 100);
      scenarios.push({ ...scenario, output: answer, score, criterionScores, explanation: scored.explanation, evidence: scored.evidence });
      selected = scenarios.length - 1;
      render();
    }
    status('Evaluación local completa');
    toast(`Evaluación terminada: ${scenarios.length} escenarios.`);
  } catch (error) {
    status('Evaluación incompleta');
    toast(error.message || 'Ocurrió un error durante la evaluación.');
    if (scenarios.length) render();
    else $('results').innerHTML = `<div class="empty-state"><strong>No se pudo completar la evaluación</strong><br>${esc(error.message)}</div>`;
  } finally {
    setBusy(false);
    button.querySelector('span').textContent = 'Generar evaluación';
  }
}

$('minus').onclick = () => { count = Math.max(2, count - 1); $('count').textContent = count; };
$('plus').onclick = () => { count = Math.min(20, count + 1); $('count').textContent = count; };
promptEl.addEventListener('input', () => { $('charCount').textContent = `${promptEl.value.length} caracteres`; });
$('charCount').textContent = `${promptEl.value.length} caracteres`;
$('customCriteria').addEventListener('input', renderRubric);
$('loadModel').addEventListener('click', async () => {
  try { await loadSelectedModel(); toast('Modelo listo para evaluar.'); }
  catch (error) { toast(error.message || 'No se pudo cargar el modelo.'); }
});
$('model').addEventListener('change', () => {
  if (loadedModelId && loadedModelId !== $('model').value) {
    loadedModelId = '';
    status('Modelo pendiente de carga');
    $('modelHint').textContent = 'Al cambiar de modelo, habrá que inicializarlo';
    $('modelProgress').hidden = true;
  }
});
$('run').addEventListener('click', runEvaluation);
$('reset').addEventListener('click', () => {
  promptEl.value = '';
  promptEl.dispatchEvent(new Event('input'));
  scenarios = [];
  selected = 0;
  inferredTaskCriteria = [];
  status(engine ? 'Modelo local listo' : 'Modelo pendiente de carga');
  render();
  toast('Prompt restablecido.');
});
initializeModelPicker();
renderRubric();
render();
if (!('gpu' in navigator)) {
  status('WebGPU no disponible');
  $('modelHint').textContent = 'Este navegador no admite WebGPU';
  $('modelProgressText').textContent = 'Usa un navegador actualizado con soporte WebGPU y una GPU compatible.';
}
