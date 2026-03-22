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
        --bg: #edf1eb;
        --surface: rgba(255,255,255,0.92);
        --surface-soft: rgba(255,255,255,0.72);
        --ink: #12212c;
        --muted: #64727c;
        --line: rgba(18,33,44,0.12);
        --ready: #1d7a4f;
        --training: #b77819;
        --waiting: #6b7280;
        --error: #c0392b;
        --accent: #0f766e;
        --shadow: 0 20px 40px rgba(16,24,32,0.1);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 28%),
          radial-gradient(circle at 85% 0%, rgba(183,120,25,0.12), transparent 26%),
          linear-gradient(180deg, #f5f8f1 0%, #e8efee 100%);
      }
      .shell {
        max-width: 1580px;
        margin: 0 auto;
        padding: 10px 12px 18px;
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 18px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(12px);
      }
      .topbar {
        padding: 10px 12px;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 4px 8px;
        background: rgba(15,118,110,0.1);
        color: var(--accent);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 8px 0 2px;
        font-size: 18px;
        line-height: 1.1;
      }
      .lede {
        margin: 0;
        font-size: 12px;
        color: var(--muted);
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 8px;
        margin-top: 10px;
      }
      .metric {
        padding: 9px 10px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: var(--surface-soft);
      }
      .metric-label {
        font-size: 10px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 800;
      }
      .metric-value {
        margin-top: 5px;
        font-size: 15px;
        font-weight: 700;
      }
      .section {
        margin-top: 10px;
        padding: 10px 12px;
      }
      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      .section-head h2 {
        margin: 0;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .section-note {
        font-size: 11px;
        color: var(--muted);
      }
      .table-shell {
        overflow: auto;
        border-radius: 14px;
        border: 1px solid var(--line);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      th, td {
        padding: 8px 9px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
        white-space: nowrap;
      }
      th {
        position: sticky;
        top: 0;
        background: rgba(255,255,255,0.95);
        color: var(--muted);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        z-index: 1;
      }
      tr:last-child td { border-bottom: 0; }
      .wrap {
        white-space: normal;
        min-width: 200px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .badge-ready { background: rgba(29,122,79,0.12); color: var(--ready); }
      .badge-training { background: rgba(183,120,25,0.14); color: var(--training); }
      .badge-waiting { background: rgba(107,114,128,0.16); color: var(--waiting); }
      .badge-error { background: rgba(192,57,43,0.14); color: var(--error); }
      .badge-manual { background: rgba(15,118,110,0.14); color: var(--accent); }
      .badge-automatic { background: rgba(18,33,44,0.1); color: var(--ink); }
      .hint {
        cursor: help;
        text-decoration: underline dotted rgba(18,33,44,0.3);
        text-underline-offset: 2px;
      }
      button {
        min-height: 34px;
        border: 1px solid transparent;
        border-radius: 10px;
        padding: 7px 11px;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        color: white;
        background: linear-gradient(135deg, #0f766e, #145f73);
        cursor: pointer;
      }
      button:disabled {
        cursor: wait;
        opacity: 0.6;
      }
      .help-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .help-card {
        padding: 10px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: var(--surface-soft);
      }
      .help-card h3 {
        margin: 0 0 6px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .help-card dl {
        margin: 0;
        display: grid;
        gap: 6px;
      }
      .help-card dt {
        font-size: 11px;
        font-weight: 700;
      }
      .help-card dd {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.35;
      }
      .muted { color: var(--muted); }
      @media (max-width: 1180px) {
        .summary-grid,
        .help-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 720px) {
        .summary-grid,
        .help-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="panel topbar">
        <div class="eyebrow">Crypto-only pipeline</div>
        <h1>${config.SERVICE_NAME}</h1>
        <p class="lede">Automatic predictions come from closed 5-minute historical blocks. Manual predictions use the latest live stream data.</p>
        <div class="summary-grid" id="summary-grid"></div>
      </section>

      <section class="panel section">
        <div class="section-head">
          <h2>Assets</h2>
          <div class="section-note">Each row shows where the training loop is, whether live prediction is ready, and the rolling hit-rate over recent resolved predictions.</div>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th><span class="hint" title="Crypto asset handled by this service.">Asset</span></th>
                <th><span class="hint" title="Current phase of the historical processing loop for this asset.">Phase</span></th>
                <th><span class="hint" title="Next historical point from which the collector will continue training after restart.">Collector Cursor</span></th>
                <th><span class="hint" title="5-minute historical block currently being processed or waited for.">Current Block</span></th>
                <th><span class="hint" title="Whether there is enough recent live data in memory to run a manual prediction now.">Live Ready</span></th>
                <th><span class="hint" title="Timestamp of the latest live snapshot received from polymarket-snapshot.">Last Live Snapshot</span></th>
                <th><span class="hint" title="How many successful remote training cycles this asset model has completed.">Training Count</span></th>
                <th><span class="hint" title="Timestamp of the latest completed training cycle for this asset.">Last Training</span></th>
                <th><span class="hint" title="Correct predictions divided by resolved predictions over the rolling recent window.">Rolling Hit Rate</span></th>
                <th><span class="hint" title="How many resolved predictions currently contribute to the rolling hit-rate.">Rolling Count</span></th>
                <th><span class="hint" title="Most recent prediction registered for this asset, whether automatic or manual.">Last Prediction</span></th>
                <th><span class="hint" title="What happened once the 30-second target window finished.">Last Result</span></th>
                <th><span class="hint" title="Latest processing error for this asset, if any.">Last Error</span></th>
                <th><span class="hint" title="Launches a manual prediction using the most recent live buffer.">Predict</span></th>
              </tr>
            </thead>
            <tbody id="asset-table-body"></tbody>
          </table>
        </div>
      </section>

      <section class="panel section">
        <div class="section-head">
          <h2>Recent Predictions</h2>
          <div class="section-note">Pending rows are waiting for 30 seconds of real outcome data before they can be scored.</div>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th><span class="hint" title="When the prediction was issued.">Time</span></th>
                <th><span class="hint" title="Crypto asset that was predicted.">Asset</span></th>
                <th><span class="hint" title="Automatic means historical block evaluation. Manual means dashboard-triggered live prediction.">Source</span></th>
                <th><span class="hint" title="Pending waits for the 30-second target to end. Resolved has a final result. Error failed before resolution.">Status</span></th>
                <th><span class="hint" title="Direction forecast produced by the model at prediction time.">Predicted</span></th>
                <th><span class="hint" title="Direction that actually happened after the 30-second target window.">Actual</span></th>
                <th><span class="hint" title="Whether the predicted direction matched the final direction.">Correct</span></th>
                <th><span class="hint" title="Model probability assigned to the price going up when the prediction was made.">Pred Up</span></th>
                <th><span class="hint" title="Model probability assigned to the price going down when the prediction was made.">Pred Down</span></th>
                <th><span class="hint" title="Final realized up value. 1 means the outcome was up, 0 means it was not.">Final Up</span></th>
                <th><span class="hint" title="Final realized down value. 1 means the outcome was down, 0 means it was not.">Final Down</span></th>
                <th><span class="hint" title="The 30-second window whose final direction decides whether the prediction was correct.">Target Window</span></th>
              </tr>
            </thead>
            <tbody id="prediction-table-body"></tbody>
          </table>
        </div>
      </section>

      <section class="panel section">
        <div class="section-head">
          <h2>Help</h2>
          <div class="section-note">Everything shown on this screen in plain language.</div>
        </div>
        <div class="help-grid">
          <article class="help-card">
            <h3>Historical Loop</h3>
            <dl>
              <dt>5-minute block</dt>
              <dd>The collector history is cut into contiguous closed windows of five minutes each. The service resumes from the last saved collector cursor after restart.</dd>
              <dt>Automatic prediction</dt>
              <dd>For each closed block, the model uses only the first 30 seconds to guess the next 30 seconds. That guess is scored before the block is used for training.</dd>
              <dt>Collector cursor</dt>
              <dd>This is the exact point from which the next historical training request will continue. It is persisted locally.</dd>
            </dl>
          </article>
          <article class="help-card">
            <h3>Manual Prediction</h3>
            <dl>
              <dt>Live ready</dt>
              <dd>There is enough recent live data in memory to build a prediction context right now.</dd>
              <dt>Predict button</dt>
              <dd>Runs a manual prediction from the latest live snapshots kept by polymarket-snapshot. The result is scored once 30 seconds have passed.</dd>
              <dt>Pending status</dt>
              <dd>The prediction has been made, but the final 30-second outcome is still in the future.</dd>
            </dl>
          </article>
          <article class="help-card">
            <h3>Prediction Values</h3>
            <dl>
              <dt>Pred Up / Pred Down</dt>
              <dd>The model-side probabilities when the prediction was issued.</dd>
              <dt>Final Up / Final Down</dt>
              <dd>The realized binary outcome after 30 seconds. One side becomes 1 and the other becomes 0.</dd>
              <dt>Rolling hit-rate</dt>
              <dd>The share of correct resolved predictions over the last 20 resolved predictions for that asset.</dd>
            </dl>
          </article>
        </div>
      </section>
    </div>

    <script>
      const state = {
        assets: [],
        isPredicting: {},
        predictions: [],
        summary: null,
      };

      const summaryGrid = document.getElementById("summary-grid");
      const assetTableBody = document.getElementById("asset-table-body");
      const predictionTableBody = document.getElementById("prediction-table-body");

      const formatDate = (value) => {
        let formattedValue = "—";
        if (typeof value === "string" && value.length > 0) {
          const parsedDate = new Date(value);
          formattedValue = Number.isNaN(parsedDate.getTime()) ? value : parsedDate.toLocaleString();
        }
        return formattedValue;
      };

      const formatPercent = (value) => {
        let formattedValue = "—";
        if (typeof value === "number") {
          formattedValue = (value * 100).toFixed(1) + "%";
        }
        return formattedValue;
      };

      const formatNumber = (value) => {
        let formattedValue = "—";
        if (typeof value === "number") {
          formattedValue = value.toFixed(3);
        }
        return formattedValue;
      };

      const escapeHtml = (value) => String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

      const buildStateBadge = (value) => {
        const normalizedValue = value === "training" || value === "predicting" ? "training" : value === "error" ? "error" : value === "waiting" ? "waiting" : "ready";
        const cssClass = "badge badge-" + normalizedValue;
        return '<span class="' + cssClass + '">' + escapeHtml(value) + "</span>";
      };

      const buildSourceBadge = (value) => {
        const cssClass = value === "manual" ? "badge badge-manual" : "badge badge-automatic";
        return '<span class="' + cssClass + '">' + escapeHtml(value) + "</span>";
      };

      const buildSummaryMetrics = () => {
        const assets = state.assets;
        const trainingCount = assets.filter((asset) => asset.state === "training" || asset.state === "predicting").length;
        const waitingCount = assets.filter((asset) => asset.state === "waiting").length;
        const liveReadyCount = assets.filter((asset) => asset.isLiveReady).length;
        const resolvedPredictions = state.predictions.filter((prediction) => prediction.status === "resolved");
        const averageHitRate = assets.length === 0 ? null : assets.reduce((sum, asset) => sum + (asset.rollingHitRate || 0), 0) / assets.length;
        const metrics = [
          { label: "Assets", value: String(assets.length) },
          { label: "Training Now", value: String(trainingCount) },
          { label: "Waiting Blocks", value: String(waitingCount) },
          { label: "Live Ready", value: String(liveReadyCount) },
          { label: "Resolved Predictions", value: String(resolvedPredictions.length) },
          { label: "Average Hit Rate", value: formatPercent(averageHitRate) },
        ];
        summaryGrid.innerHTML = metrics.map((metric) => (
          '<div class="metric"><div class="metric-label">' + escapeHtml(metric.label) + '</div><div class="metric-value">' + escapeHtml(metric.value) + "</div></div>"
        )).join("");
      };

      const renderAssets = () => {
        assetTableBody.innerHTML = state.assets.map((asset) => {
          const latestPrediction = asset.latestPrediction;
          const lastPredictionText = latestPrediction === null ? "—" : latestPrediction.predictedDirection + " @ " + formatDate(latestPrediction.issuedAt);
          const lastResultText =
            latestPrediction === null
              ? "—"
              : latestPrediction.status === "pending"
                ? "Pending"
                : latestPrediction.status === "resolved"
                  ? latestPrediction.actualDirection + " / " + (latestPrediction.isCorrect ? "correct" : "wrong")
                  : "Error";
          const buttonLabel = state.isPredicting[asset.asset] ? "Running…" : "Predict";
          const buttonDisabled = state.isPredicting[asset.asset] || !asset.isLiveReady;
          return (
            "<tr>" +
              "<td>" + escapeHtml(asset.asset.toUpperCase()) + "</td>" +
              "<td>" + buildStateBadge(asset.state) + "</td>" +
              "<td>" + escapeHtml(formatDate(asset.lastCollectorFromAt)) + "</td>" +
              "<td>" + escapeHtml((asset.currentBlockStartAt && asset.currentBlockEndAt) ? formatDate(asset.currentBlockStartAt) + " → " + formatDate(asset.currentBlockEndAt) : "—") + "</td>" +
              "<td>" + buildStateBadge(asset.isLiveReady ? "ready" : "waiting") + "</td>" +
              "<td>" + escapeHtml(formatDate(asset.lastLiveSnapshotAt)) + "</td>" +
              "<td>" + escapeHtml(String(asset.trainingCount)) + "</td>" +
              "<td>" + escapeHtml(formatDate(asset.lastTrainingAt)) + "</td>" +
              "<td>" + escapeHtml(formatPercent(asset.rollingHitRate)) + "</td>" +
              "<td>" + escapeHtml(String(asset.rollingPredictionCount)) + "</td>" +
              "<td class='wrap'>" + escapeHtml(lastPredictionText) + "</td>" +
              "<td class='wrap'>" + escapeHtml(lastResultText) + "</td>" +
              "<td class='wrap'>" + escapeHtml(asset.lastError || "—") + "</td>" +
              "<td><button data-asset='" + escapeHtml(asset.asset) + "'" + (buttonDisabled ? " disabled" : "") + ">" + escapeHtml(buttonLabel) + "</button></td>" +
            "</tr>"
          );
        }).join("");

        [...assetTableBody.querySelectorAll("button[data-asset]")].forEach((button) => {
          button.addEventListener("click", async () => {
            const asset = button.getAttribute("data-asset");
            if (asset === null) {
              return;
            }
            state.isPredicting[asset] = true;
            renderAssets();
            try {
              const response = await fetch("/predict", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ asset }),
              });
              const payload = await response.json();
              if (!response.ok) {
                throw new Error(payload.error || "prediction failed");
              }
              await refreshData();
            } catch (error) {
              alert(error instanceof Error ? error.message : "prediction failed");
            } finally {
              state.isPredicting[asset] = false;
              renderAssets();
            }
          });
        });
      };

      const renderPredictions = () => {
        predictionTableBody.innerHTML = state.predictions.map((prediction) => (
          "<tr>" +
            "<td>" + escapeHtml(formatDate(prediction.issuedAt)) + "</td>" +
            "<td>" + escapeHtml(prediction.asset.toUpperCase()) + "</td>" +
            "<td>" + buildSourceBadge(prediction.source) + "</td>" +
            "<td>" + buildStateBadge(prediction.status === "pending" ? "waiting" : prediction.status === "resolved" ? "ready" : "error") + "</td>" +
            "<td>" + escapeHtml(prediction.predictedDirection) + "</td>" +
            "<td>" + escapeHtml(prediction.actualDirection || "—") + "</td>" +
            "<td>" + escapeHtml(prediction.isCorrect === null ? "Pending" : prediction.isCorrect ? "Yes" : "No") + "</td>" +
            "<td>" + escapeHtml(formatNumber(prediction.upValueAtPrediction)) + "</td>" +
            "<td>" + escapeHtml(formatNumber(prediction.downValueAtPrediction)) + "</td>" +
            "<td>" + escapeHtml(formatNumber(prediction.upValueAtTargetEnd)) + "</td>" +
            "<td>" + escapeHtml(formatNumber(prediction.downValueAtTargetEnd)) + "</td>" +
            "<td class='wrap'>" + escapeHtml(formatDate(prediction.targetStartAt) + " → " + formatDate(prediction.targetEndAt)) + "</td>" +
          "</tr>"
        )).join("");
      };

      const refreshData = async () => {
        const [assetResponse, predictionResponse] = await Promise.all([
          fetch("/assets"),
          fetch("/predictions"),
        ]);
        const assetPayload = await assetResponse.json();
        const predictionPayload = await predictionResponse.json();
        state.assets = assetPayload.assets || [];
        state.predictions = predictionPayload.predictions || [];
        buildSummaryMetrics();
        renderAssets();
        renderPredictions();
      };

      refreshData();
      setInterval(() => {
        void refreshData();
      }, 3000);
    </script>
  </body>
</html>`;
    return html;
  }
}
