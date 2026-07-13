// ==========================================
// NOTES INTERFACE SECTION
// This file controls the dashboard, editor,
// CRUD actions and PDF export for Noty.
// ==========================================

const notesList = document.querySelector("#notesList");
const noteTitle = document.querySelector("#noteTitle");
const noteEditor = document.querySelector("#noteEditor");
const messageElement = document.querySelector("#message");
const newNoteButton = document.querySelector("#newNoteButton");
const saveNoteButton = document.querySelector("#saveNoteButton");
const exportPdfButton = document.querySelector("#exportPdfButton");
const logoutButton = document.querySelector("#logoutButton");
const toolbar = document.querySelector(".toolbar");
const searchNotesInput = document.querySelector("#searchNotes");
const selectModeButton = document.querySelector("#selectModeButton");
const bulkDeleteButton = document.querySelector("#bulkDeleteButton");
const selectedCountEl = document.querySelector("#selectedCount");
const unsavedIndicator = document.querySelector("#unsavedIndicator");
const noteStatsEl = document.querySelector("#noteStats");
const noteTagsInput = document.querySelector("#noteTagsInput");
const noteCountEl = document.querySelector("#noteCount");
const themeToggleButton = document.querySelector("#themeToggleButton");
const undoToast = document.querySelector("#undoToast");
const undoToastText = document.querySelector("#undoToastText");
const undoButton = document.querySelector("#undoButton");

const AUTOSAVE_DELAY_MS = 2000;
const UNDO_WINDOW_MS = 6000;
const TOOLBAR_STATE_COMMANDS = ["bold", "italic", "insertUnorderedList", "insertOrderedList"];
const TAG_COLOR_PALETTE = [
  { bg: "#e8efff", text: "#1d4ed8" },
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#dcfce7", text: "#166534" },
  { bg: "#fce7f3", text: "#9d174d" },
  { bg: "#ede9fe", text: "#5b21b6" },
  { bg: "#e0f2fe", text: "#075985" }
];

let notes = [];
let selectedNoteId = null;
let searchTerm = "";
let selectionMode = false;
let selectedForDeletion = new Set();
let isDirty = false;
let isSaving = false;
let autosaveTimer = null;
let pendingDeletion = null;

const FAVORITES_KEY = "noty_favorite_notes";
const TAGS_KEY = "noty_note_tags";

function getAllTags() {
  try {
    return JSON.parse(localStorage.getItem(TAGS_KEY)) || {};
  } catch (error) {
    return {};
  }
}

function getTagsForNote(noteId) {
  return getAllTags()[noteId] || [];
}

function parseTagsInput(value) {
  const seen = new Set();
  const tags = [];

  value.split(",").forEach((rawTag) => {
    const tag = rawTag.trim();
    const key = tag.toLowerCase();

    if (tag && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  });

  return tags;
}

function setTagsForNote(noteId, tags) {
  const all = getAllTags();

  if (tags.length === 0) {
    delete all[noteId];
  } else {
    all[noteId] = tags;
  }

  localStorage.setItem(TAGS_KEY, JSON.stringify(all));
}

function removeTagsForNote(noteId) {
  const all = getAllTags();
  delete all[noteId];
  localStorage.setItem(TAGS_KEY, JSON.stringify(all));
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getTagColor(tag) {
  const index = hashString(tag.toLowerCase()) % TAG_COLOR_PALETTE.length;
  return TAG_COLOR_PALETTE[index];
}

function getFavoriteIds() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function isFavorite(noteId) {
  return getFavoriteIds().includes(noteId);
}

function toggleFavorite(noteId) {
  const favorites = getFavoriteIds();
  const index = favorites.indexOf(noteId);

  if (index === -1) {
    favorites.push(noteId);
  } else {
    favorites.splice(index, 1);
  }

  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  renderNotesList();
}

function getNotePreview(content) {
  const container = document.createElement("div");
  container.innerHTML = content || "";
  const text = container.textContent || container.innerText || "";
  const trimmed = text.trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 90)}...` : trimmed;
}

function getVisibleNotes() {
  const favorites = getFavoriteIds();
  const term = searchTerm.trim().toLowerCase();

  const filtered = term
    ? notes.filter((note) => note.title.toLowerCase().includes(term)
        || getNotePreview(note.content).toLowerCase().includes(term)
        || getTagsForNote(note.id).some((tag) => tag.toLowerCase().includes(term)))
    : notes;

  return [...filtered].sort((a, b) => {
    const aFav = favorites.includes(a.id) ? 1 : 0;
    const bFav = favorites.includes(b.id) ? 1 : 0;
    return bFav - aFav;
  });
}

window.NotyNotes = {
  saveNote: () => saveNote(),
  exportNoteToPdf: () => exportNoteToPdf()
};

function showMessage(text, type = "info") {
  messageElement.textContent = text;
  messageElement.className = `message ${type}`;
}

function protectDashboard() {
  if (!getToken()) {
    window.location.href = "login.html";
    return false;
  }

  return true;
}

function updateEditorPlaceholderState() {
  const isEmpty = noteEditor.textContent.trim() === "";
  noteEditor.classList.toggle("is-empty", isEmpty);
}

function setFieldValidity(field, isValid) {
  field.classList.toggle("invalid", !isValid);
}

function markDirty() {
  isDirty = true;
  unsavedIndicator.hidden = false;
}

function markClean() {
  isDirty = false;
  unsavedIndicator.hidden = true;
  clearTimeout(autosaveTimer);
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    performSave({ silent: true });
  }, AUTOSAVE_DELAY_MS);
}

function confirmDiscardIfDirty() {
  if (!isDirty) {
    return true;
  }

  return window.confirm("Tienes cambios sin guardar. Quieres continuar sin guardarlos?");
}

function generateDefaultTitle() {
  const now = new Date();
  const stamp = now.toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  return `Nota sin titulo — ${stamp}`;
}

function updateNoteStats() {
  const text = noteEditor.textContent.trim();
  const words = text.length ? text.split(/\s+/).filter(Boolean).length : 0;
  const chars = text.length;
  noteStatsEl.textContent = `${words} ${words === 1 ? "palabra" : "palabras"} · ${chars} ${chars === 1 ? "caracter" : "caracteres"}`;
}

function updateToolbarState() {
  toolbar.querySelectorAll("button").forEach((btn) => btn.classList.remove("active"));

  TOOLBAR_STATE_COMMANDS.forEach((command) => {
    if (document.queryCommandState(command)) {
      const btn = toolbar.querySelector(`button[data-command="${command}"]`);
      if (btn) {
        btn.classList.add("active");
      }
    }
  });

  const activeBlock = (document.queryCommandValue("formatBlock") || "p").toLowerCase();
  const blockButton = toolbar.querySelector(`button[data-command="formatBlock"][data-value="${activeBlock}"]`);

  if (blockButton) {
    blockButton.classList.add("active");
  }
}

function setEditor(note) {
  selectedNoteId = note ? note.id : null;
  noteTitle.value = note ? note.title : "";
  noteEditor.innerHTML = note ? note.content : "";
  noteTagsInput.value = note ? getTagsForNote(note.id).join(", ") : "";
  setFieldValidity(noteTitle, true);
  setFieldValidity(noteEditor, true);
  updateEditorPlaceholderState();
  updateNoteStats();
  markClean();
  renderNotesList();
}

function updateNoteCount() {
  noteCountEl.textContent = `(${notes.length})`;
}

function renderNotesList() {
  updateNoteCount();
  notesList.innerHTML = "";

  if (notes.length === 0) {
    notesList.innerHTML = '<p class="empty-state">No hay notas todavia.</p>';
    return;
  }

  const visibleNotes = getVisibleNotes();

  if (visibleNotes.length === 0) {
    notesList.innerHTML = '<p class="empty-state">No se encontraron notas.</p>';
    return;
  }

  visibleNotes.forEach((note) => {
    const button = document.createElement("button");
    const isSelected = selectedForDeletion.has(note.id);
    button.className = note.id === selectedNoteId ? "note-item active" : "note-item";
    if (selectionMode) {
      button.classList.add("selection-mode");
    }
    if (isSelected) {
      button.classList.add("selected");
    }
    button.type = "button";

    if (selectionMode) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "select-checkbox";
      checkbox.checked = isSelected;
      checkbox.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleNoteSelection(note.id);
      });
      button.appendChild(checkbox);
    }

    const header = document.createElement("div");
    header.className = "note-item-header";

    const title = document.createElement("strong");
    title.textContent = `📄 ${note.title}`;

    const favoriteButton = document.createElement("span");
    favoriteButton.className = isFavorite(note.id) ? "favoriteBtn active" : "favoriteBtn";
    favoriteButton.dataset.id = note.id;
    favoriteButton.textContent = "★";
    favoriteButton.title = "Marcar como favorita";
    favoriteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(note.id);
    });

    header.append(title, favoriteButton);

    const preview = document.createElement("p");
    preview.className = "note-preview";
    preview.textContent = getNotePreview(note.content) || "Sin contenido todavia.";

    const date = document.createElement("span");
    date.className = "note-date";
    date.textContent = new Date(note.updated_at).toLocaleString();

    const noteTags = getTagsForNote(note.id);
    button.append(header, preview);

    if (noteTags.length > 0) {
      const tagsRow = document.createElement("div");
      tagsRow.className = "note-tags";
      noteTags.forEach((tag) => {
        const tagChip = document.createElement("span");
        const color = getTagColor(tag);
        tagChip.className = "tag-chip";
        tagChip.textContent = tag;
        tagChip.style.background = color.bg;
        tagChip.style.color = color.text;
        tagsRow.appendChild(tagChip);
      });
      button.appendChild(tagsRow);
    }

    button.appendChild(date);
    button.addEventListener("click", () => {
      if (selectionMode) {
        toggleNoteSelection(note.id);
      } else if (note.id !== selectedNoteId && confirmDiscardIfDirty()) {
        setEditor(note);
      }
    });
    notesList.appendChild(button);
  });
}

function toggleSelectionMode() {
  selectionMode = !selectionMode;
  selectedForDeletion.clear();

  if (selectionMode) {
    selectModeButton.textContent = "✕ Cancelar";
  } else {
    selectModeButton.textContent = "☑️ Seleccionar";
  }

  updateBulkDeleteUI();
  renderNotesList();
}

function toggleNoteSelection(noteId) {
  if (selectedForDeletion.has(noteId)) {
    selectedForDeletion.delete(noteId);
  } else {
    selectedForDeletion.add(noteId);
  }

  updateBulkDeleteUI();
  renderNotesList();
}

function updateBulkDeleteUI() {
  const count = selectedForDeletion.size;
  selectedCountEl.textContent = count;
  bulkDeleteButton.hidden = !selectionMode || count === 0;
}

function hideUndoToast() {
  undoToast.hidden = true;
}

function showUndoToast(text) {
  undoToastText.textContent = text;
  undoToast.hidden = false;
}

function commitPendingDeletion() {
  if (!pendingDeletion) {
    return;
  }

  const { ids } = pendingDeletion;
  clearTimeout(pendingDeletion.timeoutId);
  pendingDeletion = null;
  hideUndoToast();

  Promise.all([...ids].map((id) => apiRequest(`/notes/${id}`, { method: "DELETE" })))
    .then(() => {
      ids.forEach((id) => removeTagsForNote(id));
    })
    .catch((error) => showMessage(error.message, "error"));
}

function undoPendingDeletion() {
  if (!pendingDeletion) {
    return;
  }

  clearTimeout(pendingDeletion.timeoutId);
  notes = pendingDeletion.previousNotes;
  const restoreId = pendingDeletion.previousSelectedNoteId;
  pendingDeletion = null;
  hideUndoToast();

  const noteToShow = notes.find((note) => note.id === restoreId) || notes[0] || null;
  setEditor(noteToShow);
  showMessage("Eliminación deshecha.", "success");
}

function bulkDeleteSelectedNotes() {
  const count = selectedForDeletion.size;

  if (count === 0) {
    return;
  }

  if (pendingDeletion) {
    commitPendingDeletion();
  }

  const ids = new Set(selectedForDeletion);
  const previousNotes = notes;
  const previousSelectedNoteId = selectedNoteId;

  notes = notes.filter((note) => !ids.has(note.id));

  if (ids.has(previousSelectedNoteId)) {
    setEditor(notes[0] || null);
  } else {
    renderNotesList();
  }

  toggleSelectionMode();

  const timeoutId = setTimeout(() => commitPendingDeletion(), UNDO_WINDOW_MS);
  pendingDeletion = { ids, previousNotes, previousSelectedNoteId, timeoutId };

  showUndoToast(count === 1 ? "1 nota eliminada." : `${count} notas eliminadas.`);
}

async function loadNotes({ preserveSelection = false } = {}) {
  try {
    notes = await apiRequest("/notes");

    if (preserveSelection && selectedNoteId && notes.some((note) => note.id === selectedNoteId)) {
      renderNotesList();
    } else {
      setEditor(notes[0] || null);
    }
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function performSave({ silent = false } = {}) {
  if (isSaving) {
    return;
  }

  let title = noteTitle.value.trim();
  const hasContent = noteEditor.textContent.trim().length > 0;

  if (!hasContent) {
    if (!silent) {
      setFieldValidity(noteEditor, false);
      showMessage("Escribe contenido antes de guardar.", "error");
      noteEditor.focus();
    }
    return;
  }

  if (!title) {
    title = generateDefaultTitle();
    noteTitle.value = title;
  }

  setFieldValidity(noteTitle, true);
  setFieldValidity(noteEditor, true);

  const content = noteEditor.innerHTML.trim();
  const wasCreating = !selectedNoteId;
  let originalLabel;

  isSaving = true;
  clearTimeout(autosaveTimer);

  if (!silent) {
    originalLabel = saveNoteButton.textContent;
    saveNoteButton.disabled = true;
    saveNoteButton.textContent = "⏳ Guardando...";
  }

  showMessage(silent ? "💾 Guardando automáticamente..." : "Guardando nota...");

  try {
    if (selectedNoteId) {
      await apiRequest(`/notes/${selectedNoteId}`, {
        method: "PUT",
        body: JSON.stringify({ title, content })
      });
    } else {
      const data = await apiRequest("/notes", {
        method: "POST",
        body: JSON.stringify({ title, content })
      });
      selectedNoteId = data.note.id;
    }

    setTagsForNote(selectedNoteId, parseTagsInput(noteTagsInput.value));

    showMessage(
      silent
        ? "💾 Guardado automáticamente."
        : wasCreating ? "✅ Nota creada correctamente." : "✅ Nota actualizada correctamente.",
      "success"
    );
    markClean();
    await loadNotes({ preserveSelection: true });
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    isSaving = false;
    if (!silent) {
      saveNoteButton.disabled = false;
      saveNoteButton.textContent = originalLabel;
    }
  }
}

function saveNote() {
  return performSave({ silent: false });
}

function applyFormat(command, value = null) {
  document.execCommand(command, false, value);
  noteEditor.focus();
  updateToolbarState();
}

// ==========================================
// PDF EXPORT SECTION
// This function converts the selected note
// into a downloadable PDF file.
// ==========================================

function exportNoteToPdf() {
  if (!noteTitle.value.trim()) {
    showMessage("Escribe un titulo antes de exportar.", "error");
    return;
  }

  const pdfContent = document.createElement("article");
  pdfContent.className = "pdf-note";

  const title = document.createElement("h1");
  title.textContent = noteTitle.value;

  const content = document.createElement("div");
  content.innerHTML = noteEditor.innerHTML;

  pdfContent.append(title, content);

  if (typeof html2pdf !== "function") {
    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      showMessage("El navegador bloqueo la ventana de impresion.", "error");
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>${noteTitle.value}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; margin: 32px; }
        </style>
      </head>
      <body>${pdfContent.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
    showMessage("Usa Guardar como PDF en la ventana de impresion.", "success");
    return;
  }

  html2pdf()
    .set({
      margin: 12,
      filename: `${noteTitle.value.trim() || "noty-note"}.pdf`,
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    })
    .from(pdfContent)
    .save()
    .then(() => showMessage("PDF exportado correctamente.", "success"))
    .catch(() => showMessage("No se pudo exportar el PDF.", "error"));
}

toolbar.addEventListener("click", (event) => {
  const button = event.target.closest("button");

  if (!button) {
    return;
  }

  applyFormat(button.dataset.command, button.dataset.value || null);
});

searchNotesInput.addEventListener("input", (event) => {
  searchTerm = event.target.value;
  renderNotesList();
});

selectModeButton.addEventListener("click", () => toggleSelectionMode());

bulkDeleteButton.addEventListener("click", () => bulkDeleteSelectedNotes());

undoButton.addEventListener("click", () => undoPendingDeletion());

function updateThemeToggleIcon() {
  themeToggleButton.textContent = getTheme() === "dark" ? "☀️" : "🌙";
}

themeToggleButton.addEventListener("click", () => {
  setTheme(getTheme() === "dark" ? "light" : "dark");
  updateThemeToggleIcon();
});

updateThemeToggleIcon();

newNoteButton.addEventListener("click", () => {
  if (!confirmDiscardIfDirty()) {
    return;
  }
  setEditor(null);
  noteTitle.focus();
});

logoutButton.addEventListener("click", () => {
  removeToken();
  window.location.href = "login.html";
});

noteTitle.addEventListener("input", () => {
  markDirty();
  scheduleAutosave();
  if (noteTitle.value.trim()) {
    setFieldValidity(noteTitle, true);
  }
});

noteEditor.addEventListener("input", () => {
  markDirty();
  scheduleAutosave();
  updateEditorPlaceholderState();
  updateNoteStats();
  if (noteEditor.textContent.trim()) {
    setFieldValidity(noteEditor, true);
  }
});

noteTagsInput.addEventListener("input", () => {
  markDirty();
  scheduleAutosave();
});

document.addEventListener("selectionchange", () => {
  if (document.activeElement === noteEditor) {
    updateToolbarState();
  }
});

document.addEventListener("keydown", (event) => {
  const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";

  if (isSaveShortcut) {
    event.preventDefault();
    saveNote();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (isDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

if (protectDashboard()) {
  showMessage("Editor listo.", "success");
  loadNotes();
}
