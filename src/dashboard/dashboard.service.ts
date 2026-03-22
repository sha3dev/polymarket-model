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
    return new DashboardService();
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
        --bg: #eef1eb;
        --surface: rgba(255, 255, 255, 0.86);
        --surface-strong: #fcfdfb;
        --surface-soft: rgba(255, 255, 255, 0.58);
        --ink: #11202a;
        --muted: #5d6a74;
        --line: rgba(17, 32, 42, 0.1);
        --line-strong: rgba(17, 32, 42, 0.18);
        --ready: #157a4d;
        --training: #ba7d19;
        --error: #be413a;
        --idle: #6d7981;
        --accent: #0e7c72;
        --accent-soft: rgba(14, 124, 114, 0.08);
        --shadow: 0 20px 50px rgba(22, 28, 36, 0.1);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(14,124,114,0.14), transparent 24%),
          radial-gradient(circle at 85% 0%, rgba(186,125,25,0.14), transparent 26%),
          linear-gradient(180deg, #f6f8f2 0%, #e9efee 100%);
      }
      .shell {
        max-width: 1560px;
        margin: 0 auto;
        padding: 16px 16px 24px;
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--line-strong);
        border-radius: 18px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
      }
      .topbar {
        display: grid;
        grid-template-columns: minmax(0, 1.6fr) minmax(360px, 0.9fr);
        gap: 12px;
        align-items: start;
      }
      .intro {
        padding: 14px 16px;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 5px 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        background: var(--accent-soft);
        color: var(--accent);
      }
      h1 {
        margin: 10px 0 4px;
        font-size: clamp(22px, 2vw, 34px);
        line-height: 1.02;
        letter-spacing: -0.03em;
      }
      .lede {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.45;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 8px;
        margin-top: 12px;
      }
      .metric {
        padding: 10px 11px;
        border-radius: 14px;
        background: var(--surface-strong);
        border: 1px solid var(--line);
      }
      .metric-label {
        color: var(--muted);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .metric-value {
        margin-top: 5px;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.15;
      }
      .predict-card {
        padding: 14px;
      }
      .predict-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 132px;
        gap: 8px;
        align-items: end;
      }
      .field label {
        display: block;
        margin-bottom: 4px;
        color: var(--muted);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      select, button {
        width: 100%;
        min-height: 40px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--surface-strong);
        padding: 10px 12px;
        font: inherit;
        color: var(--ink);
        font-size: 14px;
      }
      button {
        cursor: pointer;
        background: linear-gradient(135deg, #0f766e, #145f73);
        color: white;
        font-weight: 700;
      }
      button:disabled {
        opacity: 0.6;
        cursor: wait;
      }
      .section {
        margin-top: 12px;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        gap: 12px;
      }
      .section-head h2 {
        margin: 0;
        font-size: 14px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .section-note {
        color: var(--muted);
        font-size: 11px;
      }
      .models-shell {
        overflow: auto;
        border-radius: 18px;
      }
      .models-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .models-table th,
      .models-table td {
        padding: 9px 10px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
        white-space: nowrap;
      }
      .models-table th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: rgba(252, 253, 251, 0.96);
        color: var(--muted);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .models-table tr:last-child td {
        border-bottom: 0;
      }
      .models-table td.wrap {
        white-space: normal;
        min-width: 220px;
        max-width: 320px;
      }
      .models-table td.numeric {
        font-variant-numeric: tabular-nums;
      }
      .key {
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .subtle {
        color: var(--muted);
      }
      .stack {
        display: grid;
        gap: 2px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .pill.ready { background: rgba(30,142,90,0.12); color: var(--ready); }
      .pill.training { background: rgba(201,138,22,0.12); color: var(--training); }
      .pill.error { background: rgba(199,65,58,0.12); color: var(--error); }
      .pill.idle { background: rgba(17,32,42,0.08); color: var(--idle); }
      .result-layout {
        display: grid;
        grid-template-columns: 1.05fr 1.05fr 0.95fr 0.95fr;
        gap: 8px;
      }
      .result-box {
        padding: 11px 12px;
        border-radius: 14px;
        background: var(--surface-strong);
        border: 1px solid var(--line);
      }
      .result-box h3 {
        margin: 0 0 6px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .result-kv {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 4px 10px;
        font-size: 12px;
      }
      .result-kv span:nth-child(odd) {
        color: var(--muted);
      }
      .result-kv span:nth-child(even) {
        font-weight: 700;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .result-list {
        margin: 0;
        padding-left: 16px;
        color: var(--muted);
        font-size: 12px;
      }
      .empty {
        color: var(--muted);
        padding: 14px;
        border-radius: 14px;
        background: rgba(255,255,255,0.55);
        border: 1px dashed var(--line);
        font-size: 13px;
      }
      .mono {
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      }
      @media (max-width: 1100px) {
        .topbar {
          grid-template-columns: 1fr;
        }
        .summary-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .predict-grid {
          grid-template-columns: 1fr 1fr;
        }
        .result-layout {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 640px) {
        .shell {
          padding: 10px 10px 18px;
        }
        .summary-grid,
        .predict-grid,
        .result-layout {
          grid-template-columns: 1fr;
        }
        .intro,
        .predict-card {
          padding: 12px;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="topbar">
        <article class="panel intro">
          <span class="eyebrow">Operator Console</span>
          <h1>${config.SERVICE_NAME}</h1>
          <p class="lede">Dense live view of runtime state, head versions, training progress, active markets, and current prediction output.</p>
          <div class="summary-grid" id="summary-grid"></div>
        </article>
        <aside class="panel predict-card">
          <div class="section-head">
            <h2>Predict</h2>
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
          <div class="section-note">Trend and CLOB heads share a row so you can spot skew, freshness, versions, and validation quality at a glance.</div>
        </div>
        <div class="panel models-shell" id="models-grid"></div>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Prediction</h2>
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
        modelsGrid.innerHTML = \`
          <table class="models-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>State</th>
                <th>Trend</th>
                <th>CLOB</th>
                <th>Seq</th>
                <th>Features</th>
                <th>Samples</th>
                <th>Validation</th>
                <th>Latest</th>
                <th>Market</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              \${statusPayload.models.map((model) => \`
                <tr>
                  <td>
                    <div class="stack">
                      <span class="key mono">\${model.modelKey}</span>
                      <span class="subtle">\${model.asset.toUpperCase()} / \${model.window}</span>
                    </div>
                  </td>
                  <td>
                    <div class="stack">
                      <span class="pill \${buildStateClass(model.state)}">\${model.state}</span>
                      <span class="subtle">\${model.headVersionSkew ? "skew" : "aligned"}</span>
                    </div>
                  </td>
                  <td class="numeric">
                    <div class="stack">
                      <span>v\${model.trendVersion}</span>
                      <span class="subtle mono">\${model.trendModelKey}</span>
                    </div>
                  </td>
                  <td class="numeric">v\${model.clobVersion}</td>
                  <td class="numeric">\${model.trendSequenceLength} / \${model.clobSequenceLength}</td>
                  <td class="numeric">\${model.trendFeatureCount} / \${model.clobFeatureCount}</td>
                  <td class="numeric">\${model.trainingSampleCount} / \${model.validationSampleCount}</td>
                  <td class="wrap">
                    <div class="stack">
                      <span class="subtle">end</span>
                      <span>\${model.lastValidationWindowEnd || "n/a"}</span>
                    </div>
                  </td>
                  <td class="wrap">
                    <div class="stack">
                      <span>\${model.latestSnapshotAt || "n/a"}</span>
                      <span class="subtle">live \${model.liveSnapshotCount}</span>
                    </div>
                  </td>
                  <td class="wrap">\${model.activeMarket?.slug || "No active market"}</td>
                  <td class="wrap">\${model.lastError || "None"}</td>
                </tr>
              \`).join("")}
            </tbody>
          </table>
        \`;
      };

      const renderPrediction = (payload) => {
        predictionResult.className = "result-layout";
        predictionResult.innerHTML = \`
          <div class="panel result-box">
            <h3>Trend</h3>
            <div class="result-kv">
              <span>Predicted return</span><span>\${formatValue(payload.trend.predictedReturn)}</span>
              <span>Fair UP probability</span><span>\${formatValue(payload.trend.fairUpProbability)}</span>
              <span>UP / FLAT / DOWN</span><span>\${formatValue(payload.trend.probabilities.up)} / \${formatValue(payload.trend.probabilities.flat)} / \${formatValue(payload.trend.probabilities.down)}</span>
              <span>Chainlink fresh</span><span>\${payload.trend.isChainlinkFresh ? "yes" : "no"}</span>
            </div>
          </div>
          <div class="panel result-box">
            <h3>CLOB</h3>
            <div class="result-kv">
              <span>Current UP midpoint</span><span>\${formatValue(payload.clob.currentUpMid)}</span>
              <span>Predicted UP midpoint</span><span>\${formatValue(payload.clob.predictedUpMid)}</span>
              <span>Edge</span><span>\${formatValue(payload.clob.edge)}</span>
              <span>Book fresh</span><span>\${payload.clob.isOrderBookFresh ? "yes" : "no"}</span>
            </div>
          </div>
          <div class="panel result-box">
            <h3>Decision</h3>
            <div class="result-kv">
              <span>Suggested side</span><span>\${payload.fusion.suggestedSide}</span>
              <span>Should trade</span><span>\${payload.fusion.shouldTrade ? "yes" : "no"}</span>
              <span>Score UP</span><span>\${formatValue(payload.fusion.scoreUp)}</span>
              <span>Score DOWN</span><span>\${formatValue(payload.fusion.scoreDown)}</span>
              <span>Mode</span><span>\${payload.fusion.mode}</span>
            </div>
          </div>
          <div class="panel result-box">
            <h3>Vetoes / Reasons</h3>
            \${payload.fusion.vetoes.length === 0 ? "<div class=\\"subtle\\">No vetoes</div>" : "<ul class=\\"result-list\\">" + payload.fusion.vetoes.map((item) => "<li>" + item + "</li>").join("") + "</ul>"}
            \${payload.fusion.reasons.length === 0 ? "<div class=\\"subtle\\" style=\\"margin-top:8px;\\">No extra reasons</div>" : "<ul class=\\"result-list\\" style=\\"margin-top:8px;\\">" + payload.fusion.reasons.map((item) => "<li>" + item + "</li>").join("") + "</ul>"}
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
