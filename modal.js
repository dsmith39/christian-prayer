/**
 * modal.js
 * --------
 * Accessible modal dialog helper built on the native <dialog> element.
 * Replaces window.confirm() / one-off custom dialogs with a single
 * consistent, stylable, keyboard-friendly pattern.
 *
 * Exposes a single global: `Modal`.
 *   Modal.confirmModal({ title, body, confirmText, cancelText, danger }) -> Promise<boolean>
 *   Modal.formModal({ title, description, fields, submitText, cancelText, danger }) -> Promise<object|null>
 *
 * Depends on Icons (icons.js) for the close button glyph and Session
 * (session.js) for escapeHtml — load both before this file.
 */
const Modal = (function () {
  /**
   * Builds and mounts a fresh <dialog class="modal"> with a header
   * (title + close button) and an empty body/actions area ready to fill.
   *
   * @param {string} title
   * @returns {{ dialog: HTMLDialogElement, body: HTMLElement, actions: HTMLElement }}
   */
  function buildDialogShell(title) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";

    dialog.innerHTML = `
      <div class="modal-inner">
        <div class="modal-head">
          <h2>${Session.escapeHtml(title)}</h2>
          <button type="button" class="modal-close" aria-label="Close">
            ${Icons.icon("x", {})}
          </button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-actions"></div>
      </div>
    `;

    document.body.appendChild(dialog);
    return {
      dialog,
      body: dialog.querySelector(".modal-body"),
      actions: dialog.querySelector(".modal-actions"),
    };
  }

  /** Removes the dialog from the DOM and restores focus to whatever opened it. */
  function teardown(dialog, previouslyFocused) {
    dialog.close();
    dialog.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
  }

  /**
   * Shows a Confirm/Cancel dialog and resolves true/false with the user's choice.
   *
   * @param {{ title: string, body: string, confirmText?: string, cancelText?: string, danger?: boolean }} opts
   * @returns {Promise<boolean>}
   */
  function confirmModal(opts) {
    const {
      title,
      body,
      confirmText = "Confirm",
      cancelText = "Cancel",
      danger = false,
    } = opts;

    return new Promise((resolve) => {
      const previouslyFocused = document.activeElement;
      const { dialog, body: bodyEl, actions } = buildDialogShell(title);
      bodyEl.innerHTML = `<p>${Session.escapeHtml(body)}</p>`;

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "secondary";
      cancelBtn.textContent = cancelText;

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = danger ? "danger" : "";
      confirmBtn.textContent = confirmText;

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);

      function finish(result) {
        teardown(dialog, previouslyFocused);
        resolve(result);
      }

      cancelBtn.addEventListener("click", () => finish(false));
      confirmBtn.addEventListener("click", () => finish(true));
      dialog.querySelector(".modal-close").addEventListener("click", () => finish(false));
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });

      dialog.showModal();
      confirmBtn.focus();
    });
  }

  /**
   * Renders a single form field's markup based on its `type`.
   * @param {object} field
   * @returns {string}
   */
  function renderField(field) {
    const {
      name,
      label,
      type = "text",
      value = "",
      required = false,
      maxLength,
      rows = 3,
      options = [],
      checked = false,
    } = field;

    const id = `modal-field-${name}`;
    const attrs = [
      required ? "required" : "",
      typeof maxLength === "number" ? `maxlength="${maxLength}"` : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (type === "textarea") {
      return `
        <label for="${id}">${Session.escapeHtml(label)}
          <textarea id="${id}" name="${name}" rows="${rows}" ${attrs}>${Session.escapeHtml(value)}</textarea>
        </label>
      `;
    }

    if (type === "select") {
      const optionsHtml = options
        .map(
          (opt) =>
            `<option value="${Session.escapeHtml(opt.value)}" ${opt.value === value ? "selected" : ""}>${Session.escapeHtml(opt.label)}</option>`
        )
        .join("");
      return `
        <label for="${id}">${Session.escapeHtml(label)}
          <select id="${id}" name="${name}">${optionsHtml}</select>
        </label>
      `;
    }

    if (type === "checkbox") {
      return `
        <label for="${id}" class="checkbox-row">
          <input id="${id}" name="${name}" type="checkbox" ${checked ? "checked" : ""} />
          ${Session.escapeHtml(label)}
        </label>
      `;
    }

    return `
      <label for="${id}">${Session.escapeHtml(label)}
        <input id="${id}" name="${name}" type="${type}" value="${Session.escapeHtml(value)}" ${attrs} />
      </label>
    `;
  }

  /**
   * Shows a form dialog built from a declarative field list.
   * Resolves with an object of { [fieldName]: value } on submit, or null on cancel.
   *
   * @param {{ title: string, description?: string, fields: object[], submitText?: string, cancelText?: string, danger?: boolean }} opts
   * @returns {Promise<object|null>}
   */
  function formModal(opts) {
    const {
      title,
      description = "",
      fields,
      submitText = "Save",
      cancelText = "Cancel",
      danger = false,
    } = opts;

    return new Promise((resolve) => {
      const previouslyFocused = document.activeElement;
      const { dialog, body: bodyEl, actions } = buildDialogShell(title);

      const formId = `modal-form-${Math.random().toString(36).slice(2, 9)}`;
      const form = document.createElement("form");
      form.id = formId;
      form.className = "stack";
      form.noValidate = true;
      form.innerHTML =
        (description ? `<p>${Session.escapeHtml(description)}</p>` : "") +
        fields.map(renderField).join("");
      bodyEl.appendChild(form);

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "secondary";
      cancelBtn.textContent = cancelText;

      const submitBtn = document.createElement("button");
      submitBtn.type = "submit";
      submitBtn.setAttribute("form", formId);
      submitBtn.className = danger ? "danger" : "";
      submitBtn.textContent = submitText;

      actions.appendChild(cancelBtn);
      actions.appendChild(submitBtn);

      function finish(result) {
        teardown(dialog, previouslyFocused);
        resolve(result);
      }

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const values = {};
        fields.forEach((field) => {
          if (field.type === "checkbox") {
            values[field.name] = form.querySelector(`[name="${field.name}"]`).checked;
          } else {
            values[field.name] = String(data.get(field.name) || "").trim();
          }
        });
        finish(values);
      });

      cancelBtn.addEventListener("click", () => finish(null));
      dialog.querySelector(".modal-close").addEventListener("click", () => finish(null));
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(null);
      });

      dialog.showModal();
      dialog.querySelector("input, textarea, select")?.focus();
    });
  }

  return { confirmModal, formModal };
})();
