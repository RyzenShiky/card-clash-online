/**
 * Simple toast / notification
 */
let toastEl = null;

export function showNotification(message, duration = 2500) {
    if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.style.cssText = `
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: #1e293b;
            color: #f1f5f9;
            padding: 0.75rem 1.25rem;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            z-index: 9999;
            font-size: 0.9rem;
            max-width: 90%;
            text-align: center;
            transition: opacity 0.2s;
        `;
        document.body.appendChild(toastEl);
    }

    toastEl.textContent = message;
    toastEl.style.opacity = "1";

    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
        toastEl.style.opacity = "0";
    }, duration);
}
