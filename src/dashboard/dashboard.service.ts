/**
 * @section imports:internals
 */

import config from "../config.ts";

/**
 * @section class
 */

export class DashboardService {
  /**
   * @section factory
   */

  public static createDefault(): DashboardService {
    const dashboardService = new DashboardService();
    return dashboardService;
  }

  /**
   * @section public:methods
   */

  public buildHtml(): string {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${config.SERVICE_NAME} Dashboard</title>
    <style>
      :root {
        --bg: #f4f2eb;
        --panel: rgba(255,255,255,0.88);
        --panel-strong: #ffffff;
        --ink: #18212b;
        --muted: #617180;
        --line: rgba(24,33,43,0.12);
        --ready: #1e8e5a;
        --training: #c98a16;
        --error: #c7413a;
        --accent: #0f766e;
        --accent-soft: rgba(15,118,110,0.1);
        --shadow: 0 18px 60px rgba(18, 24, 32, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15,118,110,0.18), transparent 28%),
          radial-gradient(circle at top right, rgba(201,138,22,0.16), transparent 32%),
          linear-gradient(180deg, #f7f3ea 0%, #eef3f1 100%);
      }
      .shell {
        max-width: 1320px;
        margin: 0 auto;
        padding: 32px 20px 64px;
      }
      .hero {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 20px;
        align-items: stretch;
      }
      .hero-card, .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 22px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
      }
      .hero-copy {
        padding: 28px;
      }
      .eyebrow {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        background: var(--accent-soft);
        color: var(--accent);
      }
      h1 {
        margin: 16px 0 12px;
        font-size: clamp(34px, 4vw, 56px);
        line-height: 0.94;
      }
      .lede {
        max-width: 60ch;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.55;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-top: 20px;
      }
      .metric {
        padding: 16px;
        border-radius: 18px;
        background: var(--panel-strong);
        border: 1px solid var(--line);
      }
      .metric-label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .metric-value {
        margin-top: 8px;
        font-size: 24px;
        font-weight: 700;
      }
      .predict-card {
        padding: 24px;
      }
      .predict-grid {
        display: grid;
        gap: 14px;
      }
      .field label {
        display: block;
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      select, button {
        width: 100%;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: var(--panel-strong);
        padding: 14px 16px;
        font: inherit;
        color: var(--ink);
      }
      button {
        cursor: pointer;
        background: linear-gradient(135deg, #0f766e, #155e75);
        color: white;
        font-weight: 700;
      }
      button:disabled {
        opacity: 0.6;
        cursor: wait;
      }
      .section {
        margin-top: 24px;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
      }
      .section-head h2 {
        margin: 0;
        font-size: 24px;
      }
      .models-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
      }
      .model-card, .result-card {
        padding: 18px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .pill.ready { background: rgba(30,142,90,0.12); color: var(--ready); }
      .pill.training { background: rgba(201,138,22,0.12); color: var(--training); }
      .pill.error { background: rgba(199,65,58,0.12); color: var(--error); }
      .pill.idle { background: rgba(24,33,43,0.08); color: var(--muted); }
      .model-meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-top: 14px;
      }
      .meta-block {
        padding: 12px;
        border-radius: 16px;
        background: var(--panel-strong);
        border: 1px solid var(--line);
      }
      .meta-title {
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .meta-value {
        margin-top: 6px;
        font-size: 16px;
        font-weight: 700;
      }
      .result-layout {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
      }
      .result-box {
        padding: 14px;
        border-radius: 16px;
        background: var(--panel-strong);
        border: 1px solid var(--line);
      }
      .result-box h3 {
        margin: 0 0 10px;
        font-size: 16px;
      }
      .result-list {
        margin: 0;
        padding-left: 18px;
        color: var(--muted);
      }
      .empty {
        color: var(--muted);
        padding: 18px;
        border-radius: 16px;
        background: rgba(255,255,255,0.55);
        border: 1px dashed var(--line);
      }
      @media (max-width: 900px) {
        .hero {
          grid-template-columns: 1fr;
        }
        .summary-grid {
          grid-template-columns: 1fr 1fr;
        }
      }
      @media (max-width: 640px) {
        .summary-grid, .model-meta, .result-layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <article class="hero-card hero-copy">
          <span class="eyebrow">Operator Dashboard</span>
          <h1>Market decisions, model state, and live prediction in one screen.</h1>
          <p class="lede">
            This service watches crypto prices and Polymarket order books, runs two short-term models, and combines them with trading costs.
            The dashboard shows whether the system is healthy, what each market model is doing, and what the service would predict right now.
          </p>
          <div class="summary-grid" id="summary-grid"></div>
        </article>
        <aside class="hero-card predict-card">
          <div class="section-head">
            <h2>Live Predict</h2>
            <span class="pill idle" id="predict-status">Ready</span>
          </div>
          <div class="predict-grid">
            <div class="field">
              <label for="asset">Asset</label>
              <select id="asset"></select>
            </div>
            <div class="field">
              <label for="window">Window</label>
              <select id="window"></select>
            </div>
            <button id="predict-button" type="button">Predict</button>
          </div>
        </aside>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Models</h2>
        </div>
        <div class="models-grid" id="models-grid"></div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Prediction Result</h2>
        </div>
        <div id="prediction-result" class="empty">Run a prediction to see the trend forecast, CLOB forecast, executable scores, vetoes, and reasons.</div>
      </section>
    </div>

    <script>
      const state = {
        appInfo: null,
        models: [],
      };

      const summaryGrid = document.getElementById("summary-grid");
      const modelsGrid = document.getElementById("models-grid");
      const predictionResult = document.getElementById("prediction-result");
      const predictButton = document.getElementById("predict-button");
      const predictStatus = document.getElementById("predict-status");
      const assetSelect = document.getElementById("asset");
      const windowSelect = document.getElementById("window");

      const formatValue = (value) => {
        if (value === null || value === undefined || value === "") {
          return "n/a";
        }
        if (typeof value === "number") {
          return Number.isFinite(value) ? value.toFixed(4) : "n/a";
        }
        return String(value);
      };

      const buildStateClass = (value) => {
        return ["ready", "training", "error", "idle"].includes(value) ? value : "idle";
      };

      const renderSummary = (statusPayload) => {
        const summaryItems = [
          { label: "Service", value: state.appInfo?.serviceName || "${config.SERVICE_NAME}" },
          { label: "Training Cycle", value: statusPayload.isTrainingCycleRunning ? "Running" : "Idle" },
          { label: "Live Snapshots", value: statusPayload.liveSnapshotCount ?? 0 },
          { label: "Latest Snapshot", value: statusPayload.latestSnapshotAt || "n/a" },
          { label: "Last Training", value: statusPayload.lastTrainingCycleAt || "n/a" },
          { label: "Markets", value: statusPayload.models.length },
        ];
        summaryGrid.innerHTML = summaryItems.map((item) => \`<div class="metric"><div class="metric-label">\${item.label}</div><div class="metric-value">\${item.value}</div></div>\`).join("");
      };

      const renderModels = (statusPayload) => {
        const options = statusPayload.models.map((model) => model.asset);
        const uniqueAssets = [...new Set(options)];
        const uniqueWindows = [...new Set(statusPayload.models.map((model) => model.window))];
        assetSelect.innerHTML = uniqueAssets.map((asset) => \`<option value="\${asset}">\${asset.toUpperCase()}</option>\`).join("");
        windowSelect.innerHTML = uniqueWindows.map((window) => \`<option value="\${window}">\${window}</option>\`).join("");
        modelsGrid.innerHTML = statusPayload.models.map((model) => \`
          <article class="panel model-card">
            <div class="section-head">
              <div>
                <h3 style="margin:0 0 6px;">\${model.modelKey}</h3>
                <div style="color:var(--muted);font-size:14px;">\${model.activeMarket?.slug || "No active market"}</div>
              </div>
              <span class="pill \${buildStateClass(model.state)}">\${model.state}</span>
            </div>
            <div class="model-meta">
              <div class="meta-block"><div class="meta-title">Trend Version</div><div class="meta-value">\${model.trendVersion}</div></div>
              <div class="meta-block"><div class="meta-title">CLOB Version</div><div class="meta-value">\${model.clobVersion}</div></div>
              <div class="meta-block"><div class="meta-title">Version Skew</div><div class="meta-value">\${model.headVersionSkew ? "Yes" : "No"}</div></div>
              <div class="meta-block"><div class="meta-title">Samples</div><div class="meta-value">\${model.trainingSampleCount}/\${model.validationSampleCount}</div></div>
              <div class="meta-block"><div class="meta-title">Latest Snapshot</div><div class="meta-value">\${model.latestSnapshotAt || "n/a"}</div></div>
              <div class="meta-block"><div class="meta-title">Last Error</div><div class="meta-value">\${model.lastError || "None"}</div></div>
            </div>
          </article>
        \`).join("");
      };

      const renderPrediction = (payload) => {
        predictionResult.className = "result-layout";
        predictionResult.innerHTML = \`
          <div class="panel result-card">
            <div class="result-layout">
              <div class="result-box">
                <h3>Trend</h3>
                <div>Predicted return: <strong>\${formatValue(payload.trend.predictedReturn)}</strong></div>
                <div>Fair UP probability: <strong>\${formatValue(payload.trend.fairUpProbability)}</strong></div>
                <div>UP / FLAT / DOWN: <strong>\${formatValue(payload.trend.probabilities.up)} / \${formatValue(payload.trend.probabilities.flat)} / \${formatValue(payload.trend.probabilities.down)}</strong></div>
              </div>
              <div class="result-box">
                <h3>CLOB</h3>
                <div>Current UP midpoint: <strong>\${formatValue(payload.clob.currentUpMid)}</strong></div>
                <div>Predicted UP midpoint: <strong>\${formatValue(payload.clob.predictedUpMid)}</strong></div>
                <div>Edge: <strong>\${formatValue(payload.clob.edge)}</strong></div>
              </div>
              <div class="result-box">
                <h3>Decision</h3>
                <div>Suggested side: <strong>\${payload.fusion.suggestedSide}</strong></div>
                <div>Should trade: <strong>\${payload.fusion.shouldTrade ? "Yes" : "No"}</strong></div>
                <div>Score UP / DOWN: <strong>\${formatValue(payload.fusion.scoreUp)} / \${formatValue(payload.fusion.scoreDown)}</strong></div>
              </div>
              <div class="result-box">
                <h3>Vetoes</h3>
                \${payload.fusion.vetoes.length === 0 ? '<div>None</div>' : '<ul class="result-list">' + payload.fusion.vetoes.map((item) => '<li>' + item + '</li>').join('') + '</ul>'}
              </div>
              <div class="result-box">
                <h3>Reasons</h3>
                \${payload.fusion.reasons.length === 0 ? '<div>None</div>' : '<ul class="result-list">' + payload.fusion.reasons.map((item) => '<li>' + item + '</li>').join('') + '</ul>'}
              </div>
            </div>
          </div>
        \`;
      };

      const refresh = async () => {
        const [appInfoResponse, modelsResponse] = await Promise.all([fetch("/"), fetch("/models")]);
        state.appInfo = await appInfoResponse.json();
        const modelsPayload = await modelsResponse.json();
        state.models = modelsPayload.models;
        renderSummary(modelsPayload);
        renderModels(modelsPayload);
      };

      predictButton.addEventListener("click", async () => {
        predictButton.disabled = true;
        predictStatus.textContent = "Running";
        predictStatus.className = "pill training";
        try {
          const response = await fetch("/predict", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ asset: assetSelect.value, window: windowSelect.value }),
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "prediction failed");
          }
          renderPrediction(payload);
          predictStatus.textContent = "Ready";
          predictStatus.className = "pill ready";
        } catch (error) {
          predictionResult.className = "empty";
          predictionResult.textContent = error instanceof Error ? error.message : "prediction failed";
          predictStatus.textContent = "Error";
          predictStatus.className = "pill error";
        } finally {
          predictButton.disabled = false;
        }
      });

      refresh().catch((error) => {
        summaryGrid.innerHTML = '<div class="empty">' + (error instanceof Error ? error.message : "dashboard failed to load") + '</div>';
      });
    </script>
  </body>
</html>`;
    return html;
  }
}
