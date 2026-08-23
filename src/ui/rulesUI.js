/**
 * Custom Rule Creator modal
 */
import {
    DEFAULT_RULES,
    FEATURED_PRESETS,
    saveRulePreset,
    loadRulePreset
} from "../multiplayer/ruleCodes.js";
import { showNotification } from "./notificationUI.js";

/**
 * @returns {Promise<object|null>} selected rules or null if cancel
 */
export function openRulesCreator(user, handlers = {}) {
    return new Promise((resolve) => {
        const existing = document.getElementById("rules-modal");
        if (existing) existing.remove();

        let rules = { ...DEFAULT_RULES };

        const modal = document.createElement("div");
        modal.id = "rules-modal";
        modal.className = "profile-modal-overlay";
        modal.innerHTML = `
      <div class="profile-modal-card" style="max-width:440px">
        <header class="profile-modal-header">
          <h2>Custom Rules</h2>
          <button type="button" class="btn btn-secondary rules-close">✕</button>
        </header>
        <div class="profile-modal-body">
          <div class="rules-featured">
            ${FEATURED_PRESETS.map(
                (p) =>
                    `<button type="button" class="btn btn-secondary rules-preset" data-code="${p.code}">${p.label}</button>`
            ).join("")}
          </div>
          <label class="profile-field"><span>Rule Code (load)</span>
            <div style="display:flex;gap:0.4rem">
              <input id="rules-code-input" placeholder="CC-XXXXX" maxlength="12" />
              <button type="button" class="btn btn-secondary" id="rules-load">Load</button>
            </div>
          </label>
          <div class="rules-toggles" id="rules-toggles"></div>
          <label class="profile-field"><span>Turn timer (sec)</span>
            <input id="rules-timer" type="number" min="10" max="120" value="${rules.turnTimer}" />
          </label>
          <label class="profile-field"><span>Target score</span>
            <input id="rules-score" type="number" min="100" max="2000" step="50" value="${rules.targetScore}" />
          </label>
        </div>
        <footer class="profile-modal-footer">
          <button type="button" class="btn btn-secondary rules-cancel">Cancel</button>
          <button type="button" class="btn btn-accent" id="rules-save-code">Save Code</button>
          <button type="button" class="btn btn-primary" id="rules-apply">Use Rules</button>
        </footer>
      </div>
    `;
        document.body.appendChild(modal);

        const toggles = [
            ["drawStacking", "Stacking +2/+4"],
            ["sevenSwap", "7 Swap Hands"],
            ["zeroRotation", "0 Rotate"],
            ["forcePlay", "Force Play"],
            ["challengeDraw", "Challenge +4"],
            ["callLastCard", "Call UNO"],
            ["jumpIn", "Jump In"]
        ];

        const togglesEl = modal.querySelector("#rules-toggles");
        const renderToggles = () => {
            togglesEl.innerHTML = toggles
                .map(
                    ([k, label]) => `
            <label class="rules-check">
              <input type="checkbox" data-rule="${k}" ${rules[k] ? "checked" : ""} />
              ${label}
            </label>`
                )
                .join("");
            togglesEl.querySelectorAll("input").forEach((inp) => {
                inp.addEventListener("change", () => {
                    rules[inp.dataset.rule] = inp.checked;
                });
            });
        };
        renderToggles();

        const finish = (val) => {
            modal.remove();
            resolve(val);
            handlers.onClose?.();
        };

        modal.querySelector(".rules-close")?.addEventListener("click", () => finish(null));
        modal.querySelector(".rules-cancel")?.addEventListener("click", () => finish(null));
        modal.addEventListener("click", (e) => {
            if (e.target === modal) finish(null);
        });

        modal.querySelectorAll(".rules-preset").forEach((btn) => {
            btn.addEventListener("click", () => {
                const p = FEATURED_PRESETS.find((x) => x.code === btn.dataset.code);
                if (p) {
                    rules = { ...DEFAULT_RULES, ...p.rules };
                    modal.querySelector("#rules-timer").value = rules.turnTimer;
                    modal.querySelector("#rules-score").value = rules.targetScore;
                    renderToggles();
                    showNotification("Preset: " + p.label);
                }
            });
        });

        modal.querySelector("#rules-load")?.addEventListener("click", async () => {
            const code = modal.querySelector("#rules-code-input")?.value;
            const preset = await loadRulePreset(code);
            if (!preset) {
                showNotification("Kode tidak ditemukan");
                return;
            }
            rules = { ...DEFAULT_RULES, ...preset.rules };
            modal.querySelector("#rules-timer").value = rules.turnTimer;
            modal.querySelector("#rules-score").value = rules.targetScore;
            renderToggles();
            showNotification("Loaded " + preset.code);
        });

        modal.querySelector("#rules-save-code")?.addEventListener("click", async () => {
            if (!user) return;
            rules.turnTimer = Number(modal.querySelector("#rules-timer")?.value) || 30;
            rules.targetScore = Number(modal.querySelector("#rules-score")?.value) || 500;
            try {
                const saved = await saveRulePreset(user.uid, rules, "My Rules");
                showNotification("Saved: " + saved.code);
                const inp = modal.querySelector("#rules-code-input");
                if (inp) inp.value = saved.code;
            } catch (e) {
                showNotification(e.message || "Gagal save");
            }
        });

        modal.querySelector("#rules-apply")?.addEventListener("click", () => {
            rules.turnTimer = Number(modal.querySelector("#rules-timer")?.value) || 30;
            rules.targetScore = Number(modal.querySelector("#rules-score")?.value) || 500;
            finish(rules);
        });
    });
}
